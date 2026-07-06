// =============================================================================
// /billing — Plan management page
//
// Server component: fetches current plan + card count.
// Client components handle the Checkout / Portal button interactions.
// =============================================================================
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { getServerSession } from '@/lib/auth'
import { PLANS, PLAN_ORDER, getPlan } from '@/lib/stripe'
import { BillingActions } from '@/components/billing/BillingActions'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Billing' }

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getBillingData() {
  const session = await getServerSession()
  if (!session?.user) return null

  const admin = createAdminClient()

  // Load org with billing fields
  const { data: profile } = await admin
    .from('users')
    .select('org_id')
    .eq('id', session.user.id)
    .single()

  if (!profile) return null

  const { data: org } = await admin
    .from('organizations')
    .select('id, plan, card_limit, stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at')
    .eq('id', profile.org_id)
    .single()

  if (!org) return null

  // Card usage count
  const { count: cardCount } = await admin
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.id)
    .is('deleted_at', null)

  return {
    org,
    cardCount: cardCount ?? 0,
  }
}

// ── Status helpers ────────────────────────────────────────────────────────────

function getTrialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const [data, params] = await Promise.all([getBillingData(), searchParams])

  if (!data) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Unable to load billing information.
      </div>
    )
  }

  const { org, cardCount } = data
  const currentPlan  = getPlan(org.plan as string)
  const status       = (org.subscription_status as string | null) ?? 'trial'
  const trialDaysLeft = status === 'trial' ? getTrialDaysLeft(org.trial_ends_at as string | null) : null
  const hasStripe    = !!(org.stripe_customer_id)
  const cardLimit    = (org.card_limit as number) ?? 100
  const usagePct     = cardLimit > 0 ? Math.min(100, (cardCount / cardLimit) * 100) : 0
  const showSuccess  = params['success'] === '1'
  const showCancelled = params['cancelled'] === '1'

  return (
    <div className="max-w-4xl space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Billing & Plan</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your CardVault Pro subscription
        </p>
      </div>

      {/* Stripe return banners */}
      {showSuccess && (
        <div className="flex items-center gap-2.5 rounded-lg border border-green-500/30 bg-green-500/8 px-4 py-3 text-sm text-green-400">
          <span className="text-base">✓</span>
          <span>Subscription activated — welcome to {currentPlan.name}!</span>
        </div>
      )}
      {showCancelled && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          <span>Checkout cancelled — no changes were made.</span>
        </div>
      )}

      {/* Status banners */}
      {status === 'past_due' && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-medium text-destructive">
            Payment failed — your subscription is past due.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Update your payment method to avoid losing access to paid features.
          </p>
          <BillingActions hasStripe={hasStripe} mode="portal-only" />
        </div>
      )}

      {status === 'trial' && trialDaysLeft !== null && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {trialDaysLeft > 0
              ? `Free trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} remaining`
              : 'Your free trial has ended'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upgrade to a paid plan to unlock more cards and eBay bulk listing.
          </p>
        </div>
      )}

      {/* Current plan card */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Current plan
            </p>
            <div className="flex items-center gap-2 mt-1">
              <h2 className="text-xl font-bold">{currentPlan.name}</h2>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{currentPlan.tagline}</p>
          </div>
          {hasStripe && (
            <BillingActions hasStripe={hasStripe} mode="portal-only" />
          )}
        </div>

        {/* Card usage meter */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Cards used</span>
            <span>
              {cardCount.toLocaleString()}
              {' / '}
              {cardLimit === 0 ? 'Unlimited' : cardLimit.toLocaleString()}
            </span>
          </div>
          {cardLimit > 0 && (
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  usagePct >= 90 ? 'bg-destructive' : usagePct >= 70 ? 'bg-amber-500' : 'bg-primary',
                )}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Plan cards */}
      <div>
        <h3 className="text-base font-semibold mb-4">Plans</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLAN_ORDER.map(planId => {
            const plan      = PLANS[planId]
            const isCurrent = planId === (org.plan as string)

            return (
              <div
                key={planId}
                className={cn(
                  'relative rounded-lg border p-5 flex flex-col',
                  isCurrent
                    ? 'border-primary bg-primary/5'
                    : plan.highlight
                      ? 'border-primary/40 bg-card'
                      : 'border-border bg-card',
                )}
              >
                {/* Most popular badge */}
                {plan.highlight && !isCurrent && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                      Most popular
                    </span>
                  </div>
                )}

                {/* Current badge */}
                {isCurrent && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                      Current plan
                    </span>
                  </div>
                )}

                <div className="mb-4">
                  <h4 className="font-semibold text-sm">{plan.name}</h4>
                  <p className="text-muted-foreground text-xs mt-0.5">{plan.tagline}</p>
                  <div className="mt-3">
                    {plan.priceMonthly === 0 ? (
                      <span className="text-2xl font-bold">Free</span>
                    ) : (
                      <>
                        <span className="text-2xl font-bold">
                          £{(plan.priceMonthly / 100).toFixed(0)}
                        </span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </>
                    )}
                  </div>
                </div>

                <ul className="space-y-1.5 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-px" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isCurrent ? (
                  <div className="text-center text-xs font-medium text-primary py-1.5">
                    ✓ Your current plan
                  </div>
                ) : planId === 'free' ? (
                  <div className="text-center text-xs text-muted-foreground py-1.5">
                    Downgrade via Manage subscription
                  </div>
                ) : (
                  <BillingActions
                    hasStripe={hasStripe}
                    mode="upgrade"
                    planId={planId}
                    planName={plan.name}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Fine print */}
      <p className="text-xs text-muted-foreground">
        All plans billed monthly in GBP. Cancel anytime via Manage subscription —
        access continues until the end of your billing period. Prices exclude VAT
        where applicable.
      </p>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    trial:     { label: 'Trial',     className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
    active:    { label: 'Active',    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
    past_due:  { label: 'Past due',  className: 'bg-destructive/10 text-destructive' },
    cancelled: { label: 'Cancelled', className: 'bg-secondary text-muted-foreground' },
  }
  const { label, className } = config[status] ?? config.trial
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full', className)}>
      {label}
    </span>
  )
}
