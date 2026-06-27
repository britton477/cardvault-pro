// =============================================================================
// POST /api/auth/register
//
// Creates a new CardVault Pro account in a single request:
//   1. Validate inputs
//   2. Create Supabase Auth user (email + password)
//   3. Create organization row
//   4. Create users profile row
//   5. Create org_settings row
//   6. Return the new user's session
//
// All DB writes use the admin client (service role) because the RLS INSERT
// policies require org_id = current_org_id() — which only works for existing
// users who already have a profile. New users can't satisfy that on their first
// request, so we bypass RLS here (admin writes are always safe server-side).
//
// Rate limited: 5 registrations per IP per hour to prevent mass account creation.
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { badRequest, serverError, validationError, conflict } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

const RegisterSchema = z.object({
  email:     z.string().email('Valid email required'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  name:      z.string().min(1, 'Your name is required').max(100),
  shop_name: z.string().min(1, 'Shop name is required').max(100),
  org_name:  z.string().optional(), // defaults to shop_name if omitted
})

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

function makeUniqueSlug(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 7)
  return `${base}-${suffix}`
}

export async function POST(request: NextRequest) {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────────
    const limit = await rateLimit(request, 'register', { max: 5, window: '1h' })
    if (!limit.success) return tooManyRequests(3600)

    // ── Validate input ────────────────────────────────────────────────────────
    const body  = await request.json() as unknown
    const input = RegisterSchema.parse(body)

    const admin = createAdminClient()

    // ── 1. Check email not already in use ─────────────────────────────────────
    // (Supabase signUp will also catch this, but we want a clear error message)
    const { data: existing } = await admin.auth.admin.listUsers()
    const emailTaken = existing?.users?.some(u => u.email === input.email.toLowerCase())
    if (emailTaken) {
      return conflict('An account with this email already exists.')
    }

    // ── 2. Create Supabase Auth user ──────────────────────────────────────────
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email:          input.email.toLowerCase(),
      password:       input.password,
      email_confirm:  false, // require email verification before first login
    })

    if (authError || !authData.user) {
      if (authError?.message?.includes('already registered')) {
        return conflict('An account with this email already exists.')
      }
      return serverError(authError ?? new Error('Failed to create auth user'))
    }

    const userId = authData.user.id

    // ── 3. Create organization ────────────────────────────────────────────────
    const orgName = (input.org_name ?? input.shop_name).trim()
    const baseSlug = slugify(orgName)

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .insert({
        name:       orgName,
        slug:       makeUniqueSlug(baseSlug),
        plan:       'free',
        card_limit: 100,
      })
      .select()
      .single()

    if (orgError || !org) {
      // Roll back the auth user we just created
      await admin.auth.admin.deleteUser(userId)
      return serverError(orgError ?? new Error('Failed to create organization'))
    }

    // ── 4. Create user profile ────────────────────────────────────────────────
    const { error: profileError } = await admin
      .from('users')
      .insert({
        id:     userId,
        org_id: org.id,
        name:   input.name.trim(),
        role:   'owner',
      })

    if (profileError) {
      await admin.auth.admin.deleteUser(userId)
      await admin.from('organizations').delete().eq('id', org.id)
      return serverError(profileError)
    }

    // ── 5. Create org settings ────────────────────────────────────────────────
    await admin
      .from('org_settings')
      .insert({
        org_id:     org.id,
        shop_name:  input.shop_name.trim(),
        markup_pct: 40,
      })
    // Non-fatal if settings insert fails — user can configure later

    // ── 6. Account created — user must verify their email before signing in ───
    // Supabase automatically sends a confirmation email when email_confirm: false.
    // The link in that email points to /auth/callback?code=...&type=signup
    // which exchanges the code for a session and redirects to /dashboard?welcome=1.
    return NextResponse.json({
      message:  'Account created. Check your email to verify your address.',
      redirect: '/register/check-email',
      email:    input.email.toLowerCase(),
    }, { status: 201 })

  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    return serverError(err)
  }
}
