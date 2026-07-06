// =============================================================================
// POST /api/team/accept
//
// Accepts a team invitation and creates/joins the user to the org.
//
// Two flows:
//   A. Existing Supabase user (email matches an auth.users row)
//      → Update their users.org_id to the inviting org.
//      → Reject if they already belong to another org (no multi-org support yet).
//
//   B. New user (email not in auth.users)
//      → Create auth user + users profile row for the new org.
//      → User receives a Supabase "magic link" to set their password.
//
// This endpoint is unauthenticated — invitees are not yet signed in.
// Uses the admin client (service role) throughout.
//
// Body: { token: string, name?: string, password?: string }
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }       from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, badRequest, conflict, notFound, serverError, validationError } from '@/lib/api'
import { assertUserLimit }   from '@/lib/permissions.server'
import { PLANS }             from '@/lib/stripe'
import { writeAuditLog }     from '@/lib/audit'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

const AcceptSchema = z.object({
  token:    z.string().min(32),
  name:     z.string().min(1).max(100).optional(),
  password: z.string().min(8).max(128).optional(),
})

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
    // Rate limit: 10 accept attempts per 15 minutes per IP
    const limit = await rateLimit(request, 'team-accept', { max: 10, window: '15m' })
    if (!limit.success) return tooManyRequests(900)

    const body  = await request.json() as unknown
    const input = AcceptSchema.parse(body)

    const db = createAdminClient()

    // ── 1. Look up invitation ─────────────────────────────────────────────────
    const { data: invitation, error: inviteErr } = await db
      .from('org_invitations')
      .select(`
        id, org_id, email, role, expires_at, accepted_at,
        organizations(plan, name, card_limit)
      `)
      .eq('token', input.token)
      .is('accepted_at', null)
      .single()

    if (inviteErr || !invitation) return notFound('Invitation not found or already used.')

    const now = new Date()
    if (new Date(invitation.expires_at as string) < now) {
      return badRequest('This invitation has expired. Ask your team owner to send a new one.')
    }

    const org      = invitation.organizations as { plan: string; name: string; card_limit: number } | null
    const plan     = (org?.plan ?? 'free') as keyof typeof PLANS
    const planConfig  = PLANS[plan]
    const userLimit   = planConfig?.userLimit ?? 1

    // ── 2. Check user limit ───────────────────────────────────────────────────
    if (userLimit > 0) {
      const { count } = await db
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', invitation.org_id as string)

      assertUserLimit(count ?? 0, userLimit, plan)
    }

    // ── 3. Resolve the invitee's auth user ────────────────────────────────────
    const authUsers      = await getAllAuthUsers(db)
    const existingAuthUser = authUsers.find(u => u.email === (invitation.email as string))

    let userId: string

    if (existingAuthUser) {
      // ── Flow A: user already has an account ────────────────────────────────
      const { data: existingProfile } = await db
        .from('users')
        .select('id, org_id')
        .eq('id', existingAuthUser.id)
        .maybeSingle()

      if (existingProfile && existingProfile.org_id !== invitation.org_id) {
        return conflict(
          'You already belong to another CardVault organisation. ' +
          'Contact support to transfer your account.'
        )
      }

      userId = existingAuthUser.id

      if (!existingProfile) {
        // Auth user exists but no profile row (edge case) — create one
        await db.from('users').insert({
          id:     userId,
          org_id: invitation.org_id as string,
          name:   input.name ?? existingAuthUser.email?.split('@')[0] ?? 'Team Member',
          role:   invitation.role as string,
        })
      } else {
        // Update their role to match invitation
        await db.from('users').update({ role: invitation.role }).eq('id', userId)
      }

    } else {
      // ── Flow B: new user — create account ──────────────────────────────────
      if (!input.name) {
        return badRequest('Your name is required to create an account.')
      }

      const { data: authData, error: authErr } = await db.auth.admin.createUser({
        email:         invitation.email as string,
        password:      input.password ?? undefined,
        email_confirm: true,  // pre-confirmed via invitation
      })

      if (authErr || !authData.user) {
        return serverError(authErr ?? new Error('Failed to create account'))
      }

      userId = authData.user.id

      await db.from('users').insert({
        id:     userId,
        org_id: invitation.org_id as string,
        name:   input.name,
        role:   invitation.role as string,
      })
    }

    // ── 4. Mark invitation as accepted ────────────────────────────────────────
    await db
      .from('org_invitations')
      .update({ accepted_at: now.toISOString() })
      .eq('id', invitation.id as string)

    void writeAuditLog({
      orgId:      invitation.org_id as string,
      userId,
      action:     'team.accept_invite',
      entityType: 'org_invitation',
      entityId:   invitation.id as string,
      after:      { email: invitation.email, role: invitation.role },
    })

    return ok({
      message:  'Welcome to the team! Sign in to get started.',
      redirect: '/login',
    })

  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

// ── GET — public token preview (no auth required) ─────────────────────────────

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return badRequest('Missing token')

  const db = createAdminClient()
  const { data: invitation, error } = await db
    .from('org_invitations')
    .select('id, email, role, expires_at, accepted_at, organizations(name)')
    .eq('token', token)
    .is('accepted_at', null)
    .single()

  if (error || !invitation) {
    return notFound('Invitation not found or already used.')
  }

  if (new Date(invitation.expires_at as string) < new Date()) {
    return badRequest('This invitation has expired.')
  }

  return ok({
    email:    invitation.email,
    role:     invitation.role,
    org_name: (invitation.organizations as { name: string } | null)?.name ?? '',
  })
}
