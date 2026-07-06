// =============================================================================
// CardVault Pro — Stripe client + plan configuration
//
// Single source of truth for plan definitions, price IDs, and feature gates.
// Import `stripe` for API calls and `PLANS` for plan metadata in the UI.
// =============================================================================

import Stripe from 'stripe'

// Lazy singleton — instantiated on first use, not at module load time.
// This prevents the Stripe SDK from initialising during builds when
// STRIPE_SECRET_KEY is not yet available in the environment.
let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('[CardVault] STRIPE_SECRET_KEY is not configured')
  // apiVersion is cast to avoid type errors across different Stripe SDK versions.
  // The installed SDK version's default is used when Stripe receives this string.
  // Upgrade this to match your installed stripe package's latest version string.
  _stripe = new Stripe(key, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion })
  return _stripe
}

// ── Plan definitions ──────────────────────────────────────────────────────────

export type PlanId = 'free' | 'basic' | 'growth' | 'pro'

export interface PlanConfig {
  id:           PlanId
  name:         string
  tagline:      string
  priceMonthly: number       // GBP pence (0 = free)
  cardLimit:    number       // 0 = unlimited
  userLimit:    number       // 0 = unlimited
  stripePriceId: string | null
  features:     string[]
  highlight:    boolean      // show "Most popular" badge
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id:            'free',
    name:          'Free',
    tagline:       'Try before you buy',
    priceMonthly:  0,
    cardLimit:     100,
    userLimit:     1,
    stripePriceId: null,
    highlight:     false,
    features: [
      '100 cards',
      '1 user',
      'Inventory management',
      'eBay price lookup',
      'Sales tracking',
      'Show Mode',
    ],
  },
  basic: {
    id:            'basic',
    name:          'Basic',
    tagline:       'For solo eBay sellers',
    priceMonthly:  1500,   // £15.00
    cardLimit:     2000,
    userLimit:     1,
    stripePriceId: process.env.STRIPE_PRICE_BASIC ?? null,
    highlight:     false,
    features: [
      '2,000 cards',
      '1 user',
      'All Free features',
      'eBay bulk listing',
      'Bulk Wizard (AI scan)',
      'Reports & CSV export',
      'Wishlist price alerts',
    ],
  },
  growth: {
    id:            'growth',
    name:          'Growth',
    tagline:       'For small shops & growing operations',
    priceMonthly:  3500,   // £35.00
    cardLimit:     0,
    userLimit:     5,
    stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null,
    highlight:     true,
    features: [
      'Unlimited cards',
      'Up to 5 users',
      'All Basic features',
      'Team management',
      'Buyer tracking (CRM)',
      'Purchase lots',
      'Priority support',
    ],
  },
  pro: {
    id:            'pro',
    name:          'Pro',
    tagline:       'For serious retailers',
    priceMonthly:  8500,   // £85.00
    cardLimit:     0,
    userLimit:     20,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    highlight:     false,
    features: [
      'Unlimited cards',
      'Up to 20 users',
      'All Growth features',
      'API access',
      'Custom domain',
      'Dedicated support',
    ],
  },
}

export const PLAN_ORDER: PlanId[] = ['free', 'basic', 'growth', 'pro']

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** Map a Stripe price ID → plan ID. Returns null if unknown. */
export function getPlanByPriceId(priceId: string): PlanId | null {
  for (const [id, plan] of Object.entries(PLANS)) {
    if (plan.stripePriceId === priceId) return id as PlanId
  }
  return null
}

/** Get plan config, falling back to 'free' for unrecognised plan IDs. */
export function getPlan(planId: string): PlanConfig {
  return PLANS[planId as PlanId] ?? PLANS.free
}

/**
 * card_limit values per plan — used by the webhook to update organizations
 * when a subscription is created/changed.
 */
export const PLAN_CARD_LIMITS: Record<PlanId, number> = {
  free:   100,
  basic:  2000,
  growth: 0,
  pro:    0,
}
