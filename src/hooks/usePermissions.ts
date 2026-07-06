'use client'
// =============================================================================
// usePermissions — Client-side mirror of lib/permissions.ts
//
// Provides the same feature + role checks as the server, but for React
// components that need to show/hide UI based on the current user's access.
//
// IMPORTANT: This is UI sugar only. Real enforcement happens server-side in
// requireAuth(). Never skip server guards because this hook says "allowed".
//
// Usage:
//   const { can, hasPlan, isOwner, plan, role } = usePermissions()
//
//   can('cards.delete')        → true if user is owner
//   hasPlan('bulk_wizard')     → true if org is on basic+ plan
//   isOwner                    → true if user.role === 'owner'
//   plan                       → 'free' | 'basic' | 'growth' | 'pro'
// =============================================================================

import { useQuery } from '@tanstack/react-query'
import { hasPlanFeature, roleCanDo } from '@/lib/permissions'
import type { Feature, Action }      from '@/lib/permissions'
import type { OrgPlan, UserRole }    from '@/types'

// ── Auth profile shape returned by /api/auth/me ───────────────────────────────

interface AuthProfile {
  id:    string
  email: string
  profile: {
    role:   UserRole
    org_id: string
    name:   string
    avatar: string
  }
  org: {
    id:                  string
    name:                string
    plan:                OrgPlan
    card_limit:          number
    subscription_status: string
    trial_ends_at:       string | null
  }
}

// ── Fetch current user (thin wrapper around /api/auth/me) ────────────────────

function useAuthProfile() {
  return useQuery<AuthProfile | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      if (res.status === 401) return null
      if (!res.ok) throw new Error('Failed to load auth profile')
      return res.json() as Promise<AuthProfile>
    },
    staleTime: 60_000,   // matches the server-side Redis TTL
    retry:     false,
  })
}

// ── Main hook ────────────────────────────────────────────────────────────────

export interface PermissionsResult {
  /** true while the profile is loading */
  loading:  boolean
  /** true if the user is authenticated */
  isAuthed: boolean
  /** The org's current plan */
  plan:     OrgPlan
  /** The user's role in the org */
  role:     UserRole
  /** true if the user is an owner */
  isOwner:  boolean
  /**
   * Returns true if the user's role permits the given action.
   * Mirrors roleCanDo() from lib/permissions.ts.
   */
  can: (action: Action) => boolean
  /**
   * Returns true if the org's plan includes the given feature.
   * Mirrors hasPlanFeature() from lib/permissions.ts.
   */
  hasPlan: (feature: Feature) => boolean
  /**
   * Returns true if the user has both the plan feature AND the role permission
   * to perform an action. Useful for gating buttons that require both.
   *
   * @example
   *   hasAccess('csv_export', 'export.csv') // basic+ AND owner
   */
  hasAccess: (feature: Feature, action: Action) => boolean
  /** The raw auth profile, or null if loading / unauthenticated */
  profile: AuthProfile | null
}

export function usePermissions(): PermissionsResult {
  const { data: profile, isLoading } = useAuthProfile()

  const plan: OrgPlan   = profile?.org?.plan   ?? 'free'
  const role: UserRole  = profile?.profile?.role ?? 'member'

  return {
    loading:  isLoading,
    isAuthed: !!profile,
    plan,
    role,
    isOwner:  role === 'owner',
    can:      (action)          => roleCanDo(role, action),
    hasPlan:  (feature)         => hasPlanFeature(plan, feature),
    hasAccess:(feature, action) => hasPlanFeature(plan, feature) && roleCanDo(role, action),
    profile:  profile ?? null,
  }
}
