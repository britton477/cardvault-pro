// =============================================================================
// GET /api/lots/[id]/cards — list cards assigned to a specific lot
//
// Returns cards with photos, ordered by created_at desc.
// Used by LotDetailSlideOver to show the lot's card inventory.
// =============================================================================
import { type NextRequest } from 'next/server'
import { createAdminClient }                               from '@/lib/supabase/server'
import { requireAuth, ok, notFound, serverError }          from '@/lib/api'

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { orgId } = await requireAuth()
    const { id }    = await params

    const db = createAdminClient()

    // Verify the lot belongs to this org before returning its cards
    const { data: lot, error: lotErr } = await db
      .from('purchase_lots')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (lotErr || !lot) return notFound()

    const { data, error } = await db
      .from('cards')
      .select('*, photos:card_photos(*)')
      .eq('org_id', orgId)
      .eq('lot_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) throw error

    return ok({ data: data ?? [], count: (data ?? []).length })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
