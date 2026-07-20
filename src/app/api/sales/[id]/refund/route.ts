// =============================================================================
// POST /api/sales/:id/refund — record a full or partial refund against a sale
//
// The sale row is preserved: sold_price always records what the buyer paid and
// refund_amount accumulates what was given back, so "a £50 sale refunded £10"
// stays distinguishable from "a £40 sale". Profit nets the two automatically
// via the generated column.
//
// Optionally returns the card to sellable stock, and — for cards inside a
// multi-variation set listing — pushes the restored quantity to eBay so the
// listing starts advertising it again.
//
// Body:    { amount, reason?, restock? }
// Returns: { sale, restocked }
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, notFound, badRequest, serverError, validationError } from '@/lib/api'
import { RefundSaleSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { pushQuantitiesWithRecovery } from '@/lib/ebay-sync'

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Refunds move money and inventory — owner only, consistent with delete.
    const { orgId, user } = await requireAuth({ role: 'owner' })
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = RefundSaleSchema.parse(body)

    const supabase = await createClient()
    const admin    = createAdminClient()

    const { data: sale } = await supabase
      .from('sales')
      .select('id, org_id, card_id, card_name, sold_price, refund_amount, qty_sold, refund_restocked')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!sale) return notFound('Sale not found')

    const soldPrice      = Number(sale['sold_price'])
    const alreadyRefunded = Number(sale['refund_amount'] ?? 0)
    const newTotal        = Math.round((alreadyRefunded + input.amount) * 100) / 100

    // A refund can never exceed what the buyer paid. Checked here for a clear
    // message; the DB constraint is the backstop.
    if (newTotal > soldPrice) {
      const remaining = Math.round((soldPrice - alreadyRefunded) * 100) / 100
      return badRequest(
        remaining <= 0
          ? 'This sale has already been refunded in full.'
          : `Refund exceeds the sale. At most £${remaining.toFixed(2)} can still be refunded.`,
        'refund_exceeds_sale',
      )
    }

    const isFullRefund = newTotal >= soldPrice

    // ── Record the refund ─────────────────────────────────────────────────────
    const { data: updated, error: updateErr } = await admin
      .from('sales')
      .update({
        refund_amount:    newTotal,
        refunded_at:      new Date().toISOString(),
        refund_reason:    input.reason || null,
        // Sticky: once stock has been returned for this sale, a later partial
        // refund must not clear the flag and imply it never happened.
        refund_restocked: (sale['refund_restocked'] as boolean) || input.restock,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (updateErr) return serverError(updateErr)

    // ── Optionally return the card to stock ──────────────────────────────────
    let restocked = false

    if (input.restock && sale['card_id']) {
      // Guard against double-restocking across two partial refunds
      if (sale['refund_restocked']) {
        console.warn(`[sales refund] card for sale ${id} was already restocked — skipping`)
      } else {
        const { data: card } = await admin
          .from('cards')
          .select('id, qty, ebay_listing_id, listing_type, ebay_set_listing_id')
          .eq('id', sale['card_id'])
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .single()

        if (card) {
          const qtyAfter = (card['qty'] as number) + (sale['qty_sold'] as number)

          // A card that still has a live eBay listing goes back to Listed;
          // anything else returns to plain stock.
          const stillListed =
            !!card['ebay_listing_id'] || !!card['ebay_set_listing_id']

          await admin
            .from('cards')
            .update({
              qty:            qtyAfter,
              status:         stillListed ? 'Listed' : 'In Stock',
              last_edited_by: user.id,
            })
            .eq('id', card['id'])
            .eq('org_id', orgId)

          restocked = true

          // Set-listing variation — tell eBay the card is available again
          if (card['listing_type'] === 'variation' && card['ebay_set_listing_id']) {
            void pushQuantitiesWithRecovery(
              orgId,
              card['ebay_set_listing_id'] as string,
              [{ sku: card['id'] as string, quantity: qtyAfter }],
            )
          }
        }
      }
    }

    void writeAuditLog({
      orgId, userId: user.id,
      action:     isFullRefund ? 'sale.refund_full' : 'sale.refund_partial',
      entityType: 'sale',
      entityId:   id,
      before:     { refund_amount: alreadyRefunded } as Record<string, unknown>,
      after:      {
        refund_amount: newTotal,
        amount:        input.amount,
        reason:        input.reason,
        restocked,
      } as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)
    void admin.rpc('refresh_dashboard_cache', { p_org_id: orgId })

    return ok({ sale: updated, restocked, is_full_refund: isFullRefund })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
