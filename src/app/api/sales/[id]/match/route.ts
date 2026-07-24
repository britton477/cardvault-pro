// =============================================================================
// POST /api/sales/:id/match — resolve a needs-review sale
//
// An eBay order that couldn't be matched to a card is imported with card_id
// null, purchase_price 0, and needs_review true, so the revenue is captured but
// the cost basis is unknown. This links it to the right card.
//
// Two outcomes:
//   { card_id }             — link to a card: pull its cost basis, draw down its
//                             stock, push the new quantity to eBay, clear review
//   { dismiss: true }       — the item genuinely isn't from tracked stock (a
//                             one-off, a bundle extra); just clear the flag
//
// Cost basis is filled only when it's still zero — a figure the user already
// entered is never overwritten.
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, notFound, badRequest, serverError, validationError } from '@/lib/api'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { pushQuantitiesWithRecovery, pushSingleListingQuantity } from '@/lib/ebay-sync'

interface RouteParams { params: Promise<{ id: string }> }

const MatchSchema = z.union([
  z.object({ card_id: z.string().uuid() }),
  z.object({ dismiss: z.literal(true) }),
])

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = MatchSchema.parse(body)

    const supabase = await createClient()
    const admin    = createAdminClient()

    const { data: sale } = await supabase
      .from('sales')
      .select('id, org_id, card_id, needs_review, qty_sold, purchase_price')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!sale) return notFound('Sale not found')

    // ── Dismiss: not from tracked stock, just clear the flag ─────────────────
    if ('dismiss' in input) {
      await admin
        .from('sales')
        .update({ needs_review: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('org_id', orgId)

      void writeAuditLog({
        orgId, userId: user.id,
        action:     'sale.review_dismissed',
        entityType: 'sale',
        entityId:   id,
      })
      return ok({ dismissed: true })
    }

    // ── Link to a card ────────────────────────────────────────────────────────
    if (sale['card_id']) {
      return badRequest('This sale is already linked to a card.')
    }

    const { data: card } = await supabase
      .from('cards')
      .select('id, qty, purchase_price, status, listing_type, ebay_listing_id, ebay_set_listing_id')
      .eq('id', input.card_id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!card) return notFound('Card not found')

    // Link the sale, and fill the cost basis only if it's still zero. A value
    // the user typed is theirs to keep.
    const salePatch: Record<string, unknown> = {
      card_id:      card['id'],
      needs_review: false,
      updated_at:   new Date().toISOString(),
    }
    if (!Number(sale['purchase_price'])) {
      salePatch['purchase_price'] = card['purchase_price']
    }

    await admin.from('sales').update(salePatch).eq('id', id).eq('org_id', orgId)

    // Draw the card's stock down by what this sale moved — the sale happened,
    // the stock left, it just wasn't attributed until now.
    const qtyBefore = (card['qty'] as number | null) ?? 0
    const qtySold   = (sale['qty_sold'] as number | null) ?? 1
    const qtyAfter  = Math.max(0, qtyBefore - qtySold)

    await admin
      .from('cards')
      .update({
        qty: qtyAfter,
        ...(qtyAfter === 0 ? { status: 'Sold' as const } : {}),
        last_edited_by: user.id,
      })
      .eq('id', card['id'])
      .eq('org_id', orgId)

    // Keep eBay's advertised count in step with the reduced stock
    if (card['listing_type'] === 'variation' && card['ebay_set_listing_id']) {
      void pushQuantitiesWithRecovery(
        orgId,
        card['ebay_set_listing_id'] as string,
        [{ sku: card['id'] as string, quantity: qtyAfter }],
      )
    } else if (card['ebay_listing_id']) {
      void pushSingleListingQuantity(orgId, card['ebay_listing_id'] as string, qtyAfter)
    }

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'sale.matched',
      entityType: 'sale',
      entityId:   id,
      after: { card_id: card['id'], qty_drawn: qtySold } as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)
    void admin.rpc('refresh_dashboard_cache', { p_org_id: orgId })

    return ok({ matched: true, card_id: card['id'], stock_remaining: qtyAfter })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
