// =============================================================================
// CardVault Pro — Central Permissions Module
//
// THIS IS THE SINGLE SOURCE OF TRUTH for all access control decisions.
//
// Two orthogonal axes:
//
//   1. PLAN FEATURES  — what an org can do based on their subscription tier.
//                       Enforced server-side in requireAuth({ feature }) and
//                       mirrored client-side in usePermissions().
//
//   2. ROLE ACTIONS   — what a user can do based on their role within the org.
//                       'owner' has full control; 'member' has operational access
//                       but cannot touch financial records, settings, or billing.
//
// Import order matters for server vs. client:
//   - API route guards: import from '@/lib/permissions.server' (throws NextResponse, server-only)
//   - Shared types/helpers: import from '@/lib/permissions' (safe anywhere)
//   - React components: import from '@/hooks/usePermissions' (client wrapper)
//
// =============================================================================

import type { OrgPlan, UserRole } from '@/types'

// ── Feature registry ─────────────────────────────────────────────────────────

/**
 * Every gatable feature in the app. Use string literals so they're easy to
 * grep for across the codebase.
 *
 * Naming convention: `<domain>.<capability>`
 */
export type Feature =
  // Available on all paid plans (basic+)
  | 'ebay.bulk_list'          // eBay bulk listing tool
  | 'bulk_wizard'             // AI card scan + bulk import
  | 'reports'                 // P&L reports and analytics
  | 'csv_export'              // CSV data export
  | 'wishlist_alerts'         // Wishlist eBay price alerts
  // Growth+ only
  | 'team_management'         // Invite + manage team members
  | 'buyers_crm'              // Buyer profiles + CRM
  | 'purchase_lots'           // Purchase lot tracking

/**
 * Every gatable action in the app. Checked against the user's role.
 *
 * Naming convention: `<entity>.<verb>`
 */
export type Action =
  // Cards
  | 'cards.delete'
  // Sales
  | 'sales.delete'
  // Settings & billing
  | 'settings.view'
  | 'settings.edit'
  | 'billing.view'
  | 'billing.manage'
  // Team
  | 'team.invite'
  | 'team.manage'             // Update role, remove members
  // Export (financial data — owner only)
  | 'export.csv'

// ── Plan → Feature mapping ────────────────────────────────────────────────────

/**
 * Which features are available on each plan.
 * This is additive — higher plans include all lower-plan features.
 */
const FREE_FEATURES    = new Set<Feature>([])
const BASIC_FEATURES   = new Set<Feature>([
  'ebay.bulk_list',
  'bulk_wizard',
  'reports',
  'csv_export',
  'wishlist_alerts',
])
const GROWTH_FEATURES  = new Set<Feature>([
  ...BASIC_FEATURES,
  'team_management',
  'buyers_crm',
  'purchase_lots',
])
const PRO_FEATURES     = new Set<Feature>([...GROWTH_FEATURES])

export const PLAN_FEATURES: Record<OrgPlan, ReadonlySet<Feature>> = {
  free:     FREE_FEATURES,
  basic:    BASIC_FEATURES,
  growth:   GROWTH_FEATURES,
  pro:      PRO_FEATURES,
  // Legacy enum values — map to free (should not appear in production)
  business: PRO_FEATURES,
}

// ── Role → Action mapping ─────────────────────────────────────────────────────

/**
 * Which actions each role is permitted to perform.
 *
 * Design rationale:
 *   - owner: full control of everything
 *   - member: operational access — can view and create, but cannot delete
 *             financial records, access settings/billing, or manage the team
 */
const OWNER_ACTIONS = new Set<Action>([
  'cards.delete',
  'sales.delete',
  'settings.view',
  'settings.edit',
  'billing.view',
  'billing.manage',
  'team.invite',
  'team.manage',
  'export.csv',
])

// NOTE: 'settings.view' is in OWNER_ACTIONS but NOT in MEMBER_ACTIONS.
// All Actions in this module are owner-only. Members have no Action permissions.

// Members have no extra action permissions beyond basic org access.
// All actions in the Action union are owner-only.
const MEMBER_ACTIONS = new Set<Action>([])

export const ROLE_ACTIONS: Record<UserRole, ReadonlySet<Action>> = {
  owner:  OWNER_ACTIONS,
  member: MEMBER_ACTIONS,
}

// ── Pure check helpers (no side effects, safe to use anywhere) ────────────────

/**
 * Returns true if the given plan includes the requested feature.
 */
export function hasPlanFeature(plan: OrgPlan, feature: Feature): boolean {
  return PLAN_FEATURES[plan]?.has(feature) ?? false
}

/**
 * Returns true if the given role is permitted to perform the action.
 */
export function roleCanDo(role: UserRole, action: Action): boolean {
  return ROLE_ACTIONS[role]?.has(action) ?? false
}

// ── Plan ordering (for "at least" checks) ────────────────────────────────────

const PLAN_RANK: Record<OrgPlan, number> = {
  free:     0,
  basic:    1,
  growth:   2,
  pro:      3,
  business: 3,
}

/**
 * Returns true if the given plan meets or exceeds the required minimum plan.
 */
export function meetsMinPlan(plan: OrgPlan, minPlan: OrgPlan): boolean {
  return (PLAN_RANK[plan] ?? 0) >= (PLAN_RANK[minPlan] ?? 0)
}

// Server-side guards (assertFeature, assertRole, assertUserLimit) live in
// '@/lib/permissions.server' — they import from 'next/server' and must not
// be imported by client components or hooks.
