// =============================================================================
// CardVault Pro — Server-side permission guard helpers
//
// Throws a NextResponse (403) on failure so API routes can write:
//
//   const { user, orgId } = await requireAuth({ feature: 'bulk_wizard' })
//
// rather than an explicit if-block after every check.
//
// IMPORTANT: This file imports from 'next/server' and 'server-only'.
// It must NEVER be imported by client components or hooks.
// Client-side permission checking is done via '@/hooks/usePermissions'.
// =============================================================================
import 'server-only'
import { NextResponse } from 'next/server'
import type { AuthUser, UserRole } from '@/types'
import { hasPlanFeature } from '@/lib/permissions'
import type { Feature } from '@/lib/permissions'

/**
 * Throws a 403 NextResponse if the user's org plan does not include the feature.
 */
export function assertFeature(user: AuthUser, feature: Feature): void {
  const plan = user.org?.plan ?? 'free'
  if (!hasPlanFeature(plan, feature)) {
    throw NextResponse.json(
      {
        error:   'This feature requires a higher plan.',
        feature,
        plan,
        code:    'PLAN_LIMIT',
      },
      { status: 403 },
    )
  }
}

/**
 * Throws a 403 NextResponse if the user's role is not in the allowed list.
 */
export function assertRole(user: AuthUser, ...roles: UserRole[]): void {
  const role = user.profile?.role ?? 'member'
  if (!roles.includes(role)) {
    throw NextResponse.json(
      {
        error: 'You do not have permission to perform this action.',
        code:  'FORBIDDEN',
      },
      { status: 403 },
    )
  }
}

/**
 * Throws a 403 if the org has reached its user limit for the current plan.
 *
 * @param currentCount  Number of active members already in the org (from DB).
 * @param limit         The plan's user limit (0 = unlimited).
 * @param planName      Plan name used in the error message (e.g. 'growth').
 */
export function assertUserLimit(
  currentCount: number,
  limit: number,
  planName = 'current',
): void {
  if (limit > 0 && currentCount >= limit) {
    throw NextResponse.json(
      {
        error: `Your ${planName} plan supports up to ${limit} user${limit === 1 ? '' : 's'}. Upgrade to add more team members.`,
        code:  'USER_LIMIT',
      },
      { status: 403 },
    )
  }
}
