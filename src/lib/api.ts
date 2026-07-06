// =============================================================================
// CardVault Pro — API response helpers (used in Route Handlers)
// =============================================================================
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

export function created<T>(data: T) {
  return ok(data, 201)
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function badRequest(message: string, code?: string) {
  return NextResponse.json({ error: message, code }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 })
}

export function serverError(err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal server error'
  console.error('[CardVault API Error]', err)
  return NextResponse.json({ error: message }, { status: 500 })
}

export function validationError(err: ZodError) {
  const message = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
  return badRequest(message, 'VALIDATION_ERROR')
}

// ── Auth guard (use at top of every Route Handler) ────────────────────────────

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { features } from '@/lib/env'
import type { AuthUser, UserRole } from '@/types'

interface GuardResult {
  user:  AuthUser
  orgId: string
}

// ── Redis profile cache ───────────────────────────────────────────────────────
//
// Problem: requireAuth() made 2 DB round-trips on every API call:
//   1. supabase.auth.getUser()  → validates JWT via Supabase Auth server
//   2. admin query              → fetches users + organizations + org_settings
//
// Fix: after step 1 succeeds we cache the profile in Redis for 60 seconds.
// Subsequent requests only pay the cost of JWT validation (step 1) — the admin
// DB query is skipped entirely on cache hit.
//
// Cache key: `auth:profile:{userId}` (user-scoped, never cross-contaminates)
// TTL:       60 seconds (stale profile for up to 1 minute after settings change)
// Invalidation: invalidateAuthCache(userId) called from settings.update route
//
// Fallback: if Redis is not configured, falls through to DB query as before.

let _redis: import('@upstash/redis').Redis | null = null

async function getRedis(): Promise<import('@upstash/redis').Redis | null> {
  if (!features.redisEnabled) return null
  if (_redis) return _redis
  const { Redis } = await import('@upstash/redis')
  _redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
  return _redis
}

async function getProfileFromCache(userId: string): Promise<AuthUser | null> {
  const redis = await getRedis()
  if (!redis) return null
  try {
    return await redis.get<AuthUser>(`auth:profile:${userId}`)
  } catch {
    return null
  }
}

async function setProfileInCache(userId: string, profile: AuthUser): Promise<void> {
  const redis = await getRedis()
  if (!redis) return
  try {
    await redis.setex(`auth:profile:${userId}`, 60, JSON.stringify(profile))
  } catch {
    // Cache write failures are silent — the app still works without the cache
  }
}

/**
 * Call this after mutating user/org/settings data to invalidate the
 * 60-second profile cache so the next request sees fresh data.
 */
export async function invalidateAuthCache(userId: string): Promise<void> {
  const redis = await getRedis()
  if (!redis) return
  try {
    await redis.del(`auth:profile:${userId}`)
  } catch {
    // Silent — cache miss on next request is safe
  }
}

// ── requireAuth ───────────────────────────────────────────────────────────────

import { assertFeature, assertRole } from '@/lib/permissions.server'
import type { Feature }             from '@/lib/permissions'

export interface RequireAuthOptions {
  /**
   * Require the user's role to be one of these values.
   * Throws 403 if the condition is not met.
   *
   * @example
   *   await requireAuth({ role: 'owner' })
   */
  role?: UserRole | UserRole[]

  /**
   * Require the org's plan to include this feature.
   * Throws 403 with a PLAN_LIMIT code if the condition is not met.
   *
   * @example
   *   await requireAuth({ feature: 'bulk_wizard' })
   */
  feature?: Feature
}

/**
 * Authenticate the request, load the user's profile and org.
 * Returns { user, orgId } or throws a 401/403 NextResponse.
 *
 * Options (all optional — bare requireAuth() still works):
 *   role    — require the user's role (throws 403 if not satisfied)
 *   feature — require a plan feature  (throws 403 with PLAN_LIMIT if not satisfied)
 *
 * Performance:
 *   - JWT validation always runs (Supabase validates the token locally from the cookie)
 *   - Profile DB query is skipped on Redis cache hit (60s TTL)
 *   - Falls back to DB query transparently if Redis is unavailable
 *
 * Usage:
 *   const { user, orgId } = await requireAuth()
 *   const { user, orgId } = await requireAuth({ role: 'owner' })
 *   const { user, orgId } = await requireAuth({ feature: 'bulk_wizard' })
 *   const { user, orgId } = await requireAuth({ role: 'owner', feature: 'team_management' })
 */
export async function requireAuth(opts?: RequireAuthOptions): Promise<GuardResult> {
  const supabase = await createClient()
  const { data: { user: authUser }, error } = await supabase.auth.getUser()

  if (error || !authUser) throw unauthorized()

  // ── 1. Try Redis cache first ─────────────────────────────────────────────
  const cached = await getProfileFromCache(authUser.id)
  if (cached) {
    // Still apply option gates even on cache hit
    if (opts?.feature) assertFeature(cached, opts.feature)
    if (opts?.role) {
      const roles = Array.isArray(opts.role) ? opts.role : [opts.role]
      assertRole(cached, ...roles)
    }
    return { orgId: cached.profile.org_id, user: cached }
  }

  // ── 2. Cache miss — load from DB ────────────────────────────────────────
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('*, organizations(*, org_settings(*))')
    .eq('id', authUser.id)
    .single()

  if (!profile) throw unauthorized('User profile not found')

  const org = profile['organizations'] as (AuthUser['org'] & { org_settings?: AuthUser['settings'] }) | null

  const authUserObj: AuthUser = {
    id:       authUser.id,
    email:    authUser.email ?? '',
    profile:  profile as AuthUser['profile'],
    org:      org as AuthUser['org'],
    settings: (org?.['org_settings'] ?? null) as AuthUser['settings'],
  }

  // ── 3. Populate cache for next request ───────────────────────────────────
  void setProfileInCache(authUser.id, authUserObj)

  // ── 4. Optional role + feature gates ────────────────────────────────────
  // assertFeature / assertRole throw NextResponse(403) on failure.
  if (opts?.feature) {
    assertFeature(authUserObj, opts.feature)
  }
  if (opts?.role) {
    const roles = Array.isArray(opts.role) ? opts.role : [opts.role]
    assertRole(authUserObj, ...roles)
  }

  return {
    orgId: profile.org_id as string,
    user:  authUserObj,
  }
}
