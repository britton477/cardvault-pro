// =============================================================================
// DELETE /api/team/invitations/:id  — revoke a pending invitation (owner-only)
// =============================================================================
import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAuth, noContent, notFound, serverError } from '@/lib/api'
import { writeAuditLog } from '@/lib/audit'

interface RouteParams { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'team_management', role: 'owner' })
    const { id }          = await params

    const db = createAdminClient()

    const { data: invitation, error: fetchErr } = await db
      .from('org_invitations')
      .select('id, org_id, email')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('accepted_at', null)
      .single()

    if (fetchErr || !invitation) return notFound('Invitation not found')

    const { error } = await db
      .from('org_invitations')
      .delete()
      .eq('id', id)

    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'team.revoke_invite',
      entityType: 'org_invitation',
      entityId:   id,
      before:     { email: invitation.email },
    })

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
