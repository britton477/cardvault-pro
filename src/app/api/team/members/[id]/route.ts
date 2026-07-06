// =============================================================================
// PATCH  /api/team/members/:id  — update a member's role (owner-only)
// DELETE /api/team/members/:id  — remove a member from the org (owner-only)
//
// Self-action protection: owners cannot change their own role or remove
// themselves — the org must always have at least one owner.
//
// Last-owner guard: demoting the last owner to 'member' is blocked.
// =============================================================================
import { type NextRequest }     from 'next/server'
import { z, ZodError }          from 'zod'
import { createAdminClient }    from '@/lib/supabase/server'
import { requireAuth, ok, noContent, notFound, badRequest, conflict, serverError, validationError, invalidateAuthCache } from '@/lib/api'
import { writeAuditLog }        from '@/lib/audit'

interface RouteParams { params: Promise<{ id: string }> }

const UpdateMemberSchema = z.object({
  role: z.enum(['owner', 'member']),
})

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'team_management', role: 'owner' })
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = UpdateMemberSchema.parse(body)

    // Owners cannot change their own role (prevents self-lockout)
    if (id === user.id) {
      return badRequest('You cannot change your own role.')
    }

    const db = createAdminClient()

    // Verify the target user is in the same org
    const { data: target, error: fetchErr } = await db
      .from('users')
      .select('id, org_id, role, name')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (fetchErr || !target) return notFound('Team member not found')

    // ── Last-owner guard ──────────────────────────────────────────────────────
    // If we're demoting an owner to member, ensure at least one other owner remains.
    if (target.role === 'owner' && input.role === 'member') {
      const { count: ownerCount } = await db
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('role', 'owner')

      if ((ownerCount ?? 0) <= 1) {
        return conflict(
          'Cannot demote the last owner. Promote another member to owner first.'
        )
      }
    }

    const { data, error } = await db
      .from('users')
      .update({ role: input.role })
      .eq('id', id)
      .select('id, name, avatar, role, created_at, updated_at')
      .single()

    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'team.role_change',
      entityType: 'user',
      entityId:   id,
      before:     { role: target.role },
      after:      { role: input.role },
    })

    // Invalidate the target user's auth cache so their next request sees the new role
    void invalidateAuthCache(id)

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'team_management', role: 'owner' })
    const { id }          = await params

    // Owners cannot remove themselves
    if (id === user.id) {
      return badRequest('You cannot remove yourself from the team.')
    }

    const db = createAdminClient()

    // Verify target is in the same org
    const { data: target, error: fetchErr } = await db
      .from('users')
      .select('id, org_id, role')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (fetchErr || !target) return notFound('Team member not found')

    // Prevent removing the last owner via DELETE
    if (target.role === 'owner') {
      const { count: ownerCount } = await db
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('role', 'owner')

      if ((ownerCount ?? 0) <= 1) {
        return conflict(
          'Cannot remove the last owner. Transfer ownership first.'
        )
      }
    }

    // Delete auth user (cascades to users row via FK)
    const { error } = await db.auth.admin.deleteUser(id)
    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'team.remove_member',
      entityType: 'user',
      entityId:   id,
    })

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
