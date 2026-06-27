// =============================================================================
// PATCH  /api/events/[id]  — update an event
// DELETE /api/events/[id]  — soft-delete an event
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                          from '@/lib/supabase/server'
import { requireAuth, ok, noContent, notFound, forbidden, serverError, validationError } from '@/lib/api'
import { writeAuditLog }                                              from '@/lib/audit'
import { UpdateEventSchema }                                          from '@/types/validation'

interface RouteParams {
  params: Promise<{ id: string }>
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id }          = await params
    const { orgId, user } = await requireAuth()
    const db              = createAdminClient()

    // Verify ownership
    const { data: existing, error: fetchErr } = await db
      .from('calendar_events')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (fetchErr || !existing) return notFound('Event not found')
    if ((existing as { org_id: string }).org_id !== orgId) return forbidden()

    const body  = await request.json() as unknown
    const input = UpdateEventSchema.parse(body)

    // If switching to all_day, clear times
    const all_day    = input.all_day ?? (existing as { all_day: boolean }).all_day
    const start_time = all_day ? null : (input.start_time ?? (existing as { start_time: string | null }).start_time)
    const end_time   = all_day ? null : (input.end_time   ?? (existing as { end_time:   string | null }).end_time)

    const updates: Record<string, unknown> = {
      ...input,
      start_time,
      end_time,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await db
      .from('calendar_events')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'event.update',
      entityType: 'calendar_events',
      entityId:   id,
      before:     existing as Record<string, unknown>,
      after:      data as Record<string, unknown>,
    })

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError)   return validationError(err)
    if (err instanceof Response)   return err
    return serverError(err)
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id }          = await params
    const { orgId, user } = await requireAuth()
    const db              = createAdminClient()

    // Verify ownership
    const { data: existing, error: fetchErr } = await db
      .from('calendar_events')
      .select('org_id, title')
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (fetchErr || !existing) return notFound('Event not found')
    if ((existing as { org_id: string }).org_id !== orgId) return forbidden()

    const { error } = await db
      .from('calendar_events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'event.delete',
      entityType: 'calendar_events',
      entityId:   id,
    })

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
