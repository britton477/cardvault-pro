// =============================================================================
// PATCH  /api/objectives/[id]  — update title, is_personal, or is_complete
// DELETE /api/objectives/[id]  — soft-delete
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                              from '@/lib/supabase/server'
import { requireAuth, ok, notFound, serverError, validationError }       from '@/lib/api'
import { writeAuditLog }                                                  from '@/lib/audit'
import { UpdateObjectiveSchema }                                          from '@/types/validation'

// ── Shared ownership guard ────────────────────────────────────────────────────

async function getOwned(id: string, orgId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('objectives')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()
  if (error || !data) return null
  return data
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }  = await params
    const existing = await getOwned(id, orgId)
    if (!existing) return notFound('Objective not found')

    const body  = await request.json() as unknown
    const input = UpdateObjectiveSchema.parse(body)

    // Build update payload
    const update: Record<string, unknown> = {}
    if (input.title       !== undefined) update.title       = input.title
    if (input.is_personal !== undefined) update.is_personal = input.is_personal

    if (input.is_complete !== undefined) {
      update.is_complete  = input.is_complete
      update.completed_at = input.is_complete ? new Date().toISOString() : null
      update.completed_by = input.is_complete ? user.id : null
    }

    const db = createAdminClient()
    const { data, error } = await db
      .from('objectives')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    if (input.is_complete !== undefined) {
      void writeAuditLog({
        orgId,
        userId:     user.id,
        action:     'objective.complete',
        entityType: 'objectives',
        entityId:   id,
        before:     { is_complete: existing.is_complete as boolean },
        after:      { is_complete: input.is_complete },
      })
    }

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId, user } = await requireAuth()
    const { id } = await params
    const existing = await getOwned(id, orgId)
    if (!existing) return notFound('Objective not found')

    const db = createAdminClient()
    const { error } = await db
      .from('objectives')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'objective.delete',
      entityType: 'objectives',
      entityId:   id,
      before:     existing as Record<string, unknown>,
    })

    return ok({ deleted: true })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
