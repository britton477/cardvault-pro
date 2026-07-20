// =============================================================================
// PATCH  /api/sales/:id  — update sale (status, tracking, etc.)
// DELETE /api/sales/:id  — soft-delete sale
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, noContent, notFound, serverError, validationError } from '@/lib/api'
import { UpdateSaleSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { pushQuantitiesWithRecovery } from '@/lib/ebay-sync'

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = UpdateSaleSchema.parse(body)

    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('sales')
      .select('id, org_id, sale_status')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!existing) return notFound('Sale not found')

    const { data, error } = await supabase
      .from('sales')
      .update(input)
      .eq('id', id)
      .select()
      .single()

    if (error) return serverError(error)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'sale.update',
      entityType: 'sale',
      entityId:   id,
      before:     existing as Record<string, unknown>,
      after:      input    as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

/**
 * DELETE /api/sales/:id?restock=true
 *
 * Soft-deletes the sale. The optional restock flag returns the sold units to
 * inventory.
 *
 * Restocking is opt-in rather than automatic because "delete this sale" covers
 * two opposite situations: a sale that never happened (stock should come back)
 * and a duplicate row (stock is already correct, and restoring it would invent
 * inventory that does not exist). The caller must say which.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Sales deletion is owner-only — financial records must not be removed by staff
    const { orgId, user } = await requireAuth({ role: 'owner' })
    const { id }          = await params
    const supabase        = await createClient()

    const restock = request.nextUrl.searchParams.get('restock') === 'true'

    const { data: existing } = await supabase
      .from('sales')
      .select('id, org_id, card_id, qty_sold, card_name')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!existing) return notFound('Sale not found')

    const { error } = await supabase
      .from('sales')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return serverError(error)

    // ── Optionally return the units to stock ────────────────────────────────
    let restocked = false

    if (restock && existing['card_id']) {
      const admin = createAdminClient()

      const { data: card } = await admin
        .from('cards')
        .select('id, qty, ebay_listing_id, listing_type, ebay_set_listing_id')
        .eq('id', existing['card_id'])
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .single()

      if (card) {
        const qtyAfter    = (card['qty'] as number) + (existing['qty_sold'] as number)
        const stillListed = !!card['ebay_listing_id'] || !!card['ebay_set_listing_id']

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

        if (card['listing_type'] === 'variation' && card['ebay_set_listing_id']) {
          void pushQuantitiesWithRecovery(
            orgId,
            card['ebay_set_listing_id'] as string,
            [{ sku: card['id'] as string, quantity: qtyAfter }],
          )
        }
      }
    }

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'sale.delete',
      entityType: 'sale',
      entityId:   id,
      before:     existing as Record<string, unknown>,
      after:      { restocked } as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
