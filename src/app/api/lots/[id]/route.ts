// =============================================================================
// GET    /api/lots/[id]  — fetch a single lot with computed stats
// PATCH  /api/lots/[id]  — update a purchase lot
// DELETE /api/lots/[id]  — soft-delete (does NOT unlink cards)
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                                   from '@/lib/supabase/server'
import { requireAuth, ok, noContent, notFound, serverError, validationError }  from '@/lib/api'
import { UpdateLotSchema }                                                     from '@/types/validation'
import { writeAuditLog }                                                       from '@/lib/audit'

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { orgId } = await requireAuth()
    const { id }    = await params

    const db = createAdminClient()
    const { data, error } = await db
      .from('purchase_lots')
      .select('*, cards(purchase_price)')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (error || !data) return notFound()

    const cards          = (data.cards ?? []) as Array<{ purchase_price: number }>
    const card_count     = cards.length
    const allocated_cost = cards.reduce((sum, c) => sum + (c.purchase_price ?? 0), 0)
    const { cards: _cards, ...rest } = data

    return ok({ ...rest, card_count, allocated_cost })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = UpdateLotSchema.parse(body)

    const db = createAdminClient()
    const { data, error } = await db
      .from('purchase_lots')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .select()
      .single()

    if (error || !data) return notFound()

    void writeAuditLog({
      orgId, userId: user.id,
      action: 'lot.update', entityType: 'purchase_lot', entityId: id,
      after: input as Record<string, unknown>,
    })

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params

    const db = createAdminClient()
    const { error } = await db
      .from('purchase_lots')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action: 'lot.delete', entityType: 'purchase_lot', entityId: id,
    })

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
