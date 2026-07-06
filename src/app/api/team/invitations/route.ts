// =============================================================================
// GET  /api/team/invitations  — list pending invitations (owner-only)
// POST /api/team/invitations  — create + send an invitation (owner-only)
//
// Enforces:
//   - team_management plan feature (growth+)
//   - owner role
//   - User limit for the org's plan (active members + pending invitations)
// =============================================================================
import { type NextRequest }     from 'next/server'
import { z, ZodError }          from 'zod'
import { createAdminClient }    from '@/lib/supabase/server'
import { requireAuth, ok, created, conflict, serverError, validationError } from '@/lib/api'
import { assertUserLimit }      from '@/lib/permissions.server'
import { PLANS }                from '@/lib/stripe'
import { writeAuditLog }        from '@/lib/audit'
import { randomBytes }          from 'crypto'

const CreateInvitationSchema = z.object({
  email: z.string().email('Valid email required'),
  role:  z.enum(['owner', 'member']).default('member'),
})

// ── GET — list pending invitations ────────────────────────────────────────────

export async function GET() {
  try {
    const { orgId } = await requireAuth({ feature: 'team_management', role: 'owner' })

    const db = createAdminClient()
    const { data, error } = await db
      .from('org_invitations')
      .select('id, email, role, expires_at, accepted_at, created_at, invited_by')
      .eq('org_id', orgId)
      .is('accepted_at', null)       // pending only
      .gt('expires_at', new Date().toISOString()) // not expired
      .order('created_at', { ascending: false })

    if (error) throw error

    return ok(data ?? [])
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}

// ── POST — create invitation ───────────────────────────────────────────────────

/**
 * Paginated fetch of all auth users. Supabase listUsers() returns at most 1000
 * per page; we loop until we have them all to avoid missing users at large scale.
 */
async function getAllAuthUsers(db: ReturnType<typeof createAdminClient>) {
  const pageSize = 1000
  let page = 1
  const all: { id: string; email?: string }[] = []
  while (true) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: pageSize })
    const users = data?.users ?? []
    all.push(...users)
    if (users.length < pageSize) break
    page++
  }
  return all
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'team_management', role: 'owner' })

    const body  = await request.json() as unknown
    const input = CreateInvitationSchema.parse(body)

    const db = createAdminClient()

    // ── 1. Check user limit for the plan ──────────────────────────────────────
    const plan       = user.org?.plan ?? 'free'
    const planConfig = PLANS[plan as keyof typeof PLANS]
    const userLimit  = planConfig?.userLimit ?? 1

    if (userLimit > 0) {
      // Count active members
      const { count: memberCount } = await db
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)

      // Count pending (non-expired, non-accepted) invitations
      const { count: pendingCount } = await db
        .from('org_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())

      const totalClaimed = (memberCount ?? 0) + (pendingCount ?? 0)
      assertUserLimit(totalClaimed, userLimit, plan)
    }

    // ── 2. Check for duplicate pending invite ──────────────────────────────────
    const { data: existing } = await db
      .from('org_invitations')
      .select('id')
      .eq('org_id', orgId)
      .eq('email', input.email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existing) {
      return conflict('An active invitation for this email already exists.')
    }

    // ── 3. Check if the user is already a member ───────────────────────────────
    const authUsers    = await getAllAuthUsers(db)
    const existingUser = authUsers.find(u => u.email === input.email.toLowerCase())
    if (existingUser) {
      const { data: memberRow } = await db
        .from('users')
        .select('id')
        .eq('id', existingUser.id)
        .eq('org_id', orgId)
        .maybeSingle()

      if (memberRow) {
        return conflict('This person is already a member of your team.')
      }
    }

    // ── 4. Create invitation ────────────────────────────────────────────────────
    const token = randomBytes(32).toString('hex')

    const { data: invitation, error } = await db
      .from('org_invitations')
      .insert({
        org_id:     orgId,
        email:      input.email.toLowerCase(),
        role:       input.role,
        token,
        invited_by: user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()

    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'team.invite',
      entityType: 'org_invitation',
      entityId:   invitation.id,
      after:      { email: input.email, role: input.role },
    })

    // TODO: Send invitation email via your email provider (Resend, SES, etc.)
    // The invite URL should be: `${APP_URL}/join?token=${token}`

    return created({
      id:         invitation.id,
      email:      invitation.email,
      role:       invitation.role,
      expires_at: invitation.expires_at,
      token,      // returned so the owner can copy the link if email is not configured
    })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
