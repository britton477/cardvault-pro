// =============================================================================
// POST /api/images/reorder — batch-update card_photos.position
//
// Body: { updates: Array<{ id: string; position: number }> }
//
// All photo IDs must belong to cards owned by the authenticated org.
// Positions are updated sequentially (Supabase lacks multi-row UPDATE … CASE).
// Max 20 photos per call (reasonable upper limit for a card listing).
//
// Only updates position metadata — no storage changes required.
// =============================================================================
import { type NextRequest } from 'next/server'
import { createClient }     from '@/lib/supabase/server'
import { requireAuth, ok, badRequest, serverError } from '@/lib/api'

interface PositionUpdate { id: string; position: number }

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()

    const body = await request.json() as { updates?: PositionUpdate[] }
    const updates = body.updates

    if (!Array.isArray(updates) || updates.length === 0) {
      return badRequest('updates must be a non-empty array of { id, position }')
    }
    if (updates.length > 20) {
      return badRequest('Too many updates — max 20 at a time')
    }
    if (updates.some(u => typeof u.id !== 'string' || typeof u.position !== 'number' || u.position < 0)) {
      return badRequest('Each update must have a string id and a non-negative integer position')
    }

    const supabase = await createClient()
    const ids      = updates.map(u => u.id)

    // Verify all photos belong to this org (via card join)
    const { data: photos, error: fetchErr } = await supabase
      .from('card_photos')
      .select('id, cards!inner(org_id)')
      .in('id', ids)

    if (fetchErr) return serverError(fetchErr)

    // All IDs must exist and belong to this org
    if (photos.length !== ids.length) {
      return badRequest('One or more photo IDs not found')
    }
    const wrongOrg = photos.find(
      p => (p.cards as unknown as { org_id: string }).org_id !== orgId,
    )
    if (wrongOrg) return badRequest('One or more photos do not belong to this organisation')

    // Batch update — sequential is fine for ≤20 rows
    const updatePromises = updates.map(({ id, position }) =>
      supabase
        .from('card_photos')
        .update({ position })
        .eq('id', id),
    )
    const results = await Promise.all(updatePromises)
    const firstErr = results.find(r => r.error)?.error
    if (firstErr) return serverError(firstErr)

    return ok({ updated: updates.length })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
