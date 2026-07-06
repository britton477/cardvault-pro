// =============================================================================
// CardVault Pro — Client-safe plan display constants
//
// Contains ONLY the data needed for UI rendering (names, prices).
// No Stripe SDK import — safe to use in client components and hooks.
//
// For full plan configuration (stripePriceId, features list, etc.) use
// '@/lib/stripe' — but only in server-side code.
// =============================================================================

export type PlanId = 'free' | 'basic' | 'growth' | 'pro'

/** Display name for each plan */
export const PLAN_NAMES: Record<PlanId, string> = {
  free:   'Free',
  basic:  'Basic',
  growth: 'Growth',
  pro:    'Pro',
}

/** Monthly price in GBP pence (0 = free) */
export const PLAN_PRICES: Record<PlanId, number> = {
  free:   0,
  basic:  1500,  // £15.00
  growth: 3500,  // £35.00
  pro:    8500,  // £85.00
}

/** Format a plan price for display, e.g. "£15/mo" or "Free" */
export function formatPlanPrice(planId: PlanId): string {
  const pence = PLAN_PRICES[planId]
  if (pence === 0) return 'Free'
  return `£${pence / 100}/mo`
}
