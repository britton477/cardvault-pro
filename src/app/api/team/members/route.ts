// =============================================================================
// GET  /api/team/members  — list all users in the org (owner-only)
// =============================================================================
import { requireAuth, ok, serverError } from '@/lib/api'
import { createAdminClient }            from '@/lib/supabase/server'

export async function GET() {
  try {
    // Team management requires growth+ plan AND owner role
    const { orgId } = await requireAuth({ feature: 'team_management', role: 'owner' })

    const db = createAdminClient()
    const { data, error } = await db
      .from('users')
      .select('id, name, avatar, role, created_at, updated_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })

    if (error) throw error

    return ok(data ?? [])
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
