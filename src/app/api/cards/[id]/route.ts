// =============================================================================
// GET    /api/cards/:id  — fetch single card with photos
// PATCH  /api/cards/:id  — update card fields
// DELETE /api/cards/:id  — soft-delete card
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, ok, noContent, notFound, forbidden, serverError, validationError } from '@/lib/api'
import { UpdateCardSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { pushQuantitiesWithRecovery, pushSingleListingQuantity } from '@/lib/ebay-sync'

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { orgId }  = await requireAuth()
    const { id }     = await params
    const supabase   = await createClient()

    const { data, error } = await supabase
      .from('cards')
      .select('*, photos:card_photos(*)')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (error || !data) return notFound('Card not found')

    return ok(data)
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = UpdateCardSchema.parse(body)

    const supabase = await createClient()

    // Verify ownership before update — also load variation fields for qty push
    const { data: existing } = await supabase
      .from('cards')
      .select('id, org_id, qty, listing_type, ebay_listing_id, ebay_set_listing_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!existing) return notFound('Card not found')

    const { data, error } = await supabase
      .from('cards')
      .update({ ...input, last_edited_by: user.id })
      .eq('id', id)
      .select('*, photos:card_photos(*)')
      .single()

    if (error) return serverError(error)

    // ── Auto-push qty to eBay for variation cards ─────────────────────────────
    // When qty changes on a card that's part of a multi-variation listing,
    // push the new quantity to eBay. Fire-and-forget so the card update never
    // blocks on eBay API latency.
    const qtyChanged = input.qty != null && input.qty !== (existing['qty'] as number)

    if (qtyChanged && existing['listing_type'] === 'variation' && existing['ebay_set_listing_id']) {
      // A failed push flags the set listing sync_pending so the drift is visible
      // in the Set Listings tab instead of vanishing into the server log.
      void pushQuantitiesWithRecovery(
        orgId,
        existing['ebay_set_listing_id'] as string,
        [{ sku: id, quantity: input.qty! }],
      )
    } else if (qtyChanged && existing['ebay_listing_id']) {
      // Single listing — keep eBay's available count in step with stock.
      // Without this, restocking a card left eBay advertising the old number.
      void pushSingleListingQuantity(
        orgId,
        existing['ebay_listing_id'] as string,
        input.qty!,
      )
    }

    void writeAuditLog({
      orgId: orgId, userId: user.id,
      action: 'card.update', entityType: 'card', entityId: id,
      before: existing as Record<string, unknown>,
      after:  input as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    // Card deletion is owner-only — prevents staff from accidentally destroying inventory
    const { orgId, user } = await requireAuth({ role: 'owner' })
    const { id }          = await params
    const supabase  = await createClient()

    const { data: existing } = await supabase
      .from('cards')
      .select('id, org_id, status')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!existing) return notFound('Card not found')

    // Soft delete
    const { error } = await supabase
      .from('cards')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return serverError(error)

    void writeAuditLog({
      orgId: orgId, userId: user.id,
      action: 'card.delete', entityType: 'card', entityId: id,
      before: existing as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
