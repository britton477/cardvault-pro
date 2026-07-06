'use client'
// =============================================================================
// FeatureGate — Render-time permission gate for plan features and role actions
//
// Renders children when the user has access; renders an upgrade/permission
// prompt otherwise.
//
// Usage:
//   // Gate by plan feature
//   <FeatureGate feature="bulk_wizard">
//     <BulkWizardButton />
//   </FeatureGate>
//
//   // Gate by role action
//   <FeatureGate action="cards.delete">
//     <DeleteButton />
//   </FeatureGate>
//
//   // Gate by both (must satisfy both conditions)
//   <FeatureGate feature="csv_export" action="export.csv">
//     <ExportButton />
//   </FeatureGate>
//
//   // Inline mode — renders the child as disabled/blurred instead of replacing it
//   <FeatureGate feature="bulk_wizard" inline>
//     <BulkWizardButton />
//   </FeatureGate>
//
//   // Custom fallback
//   <FeatureGate feature="buyers_crm" fallback={<p>Upgrade to Growth</p>}>
//     <BuyersView />
//   </FeatureGate>
//
// =============================================================================

import { type ReactNode } from 'react'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import type { Feature, Action } from '@/lib/permissions'
import { PLAN_PRICES, formatPlanPrice } from '@/lib/plans'

// ── Plan labels for upgrade prompts ──────────────────────────────────────────

const FEATURE_PLAN_LABELS: Record<Feature, string> = {
  'ebay.bulk_list':  'Basic',
  'bulk_wizard':     'Basic',
  'reports':         'Basic',
  'csv_export':      'Basic',
  'wishlist_alerts': 'Basic',
  'team_management': 'Growth',
  'buyers_crm':      'Growth',
  'purchase_lots':   'Growth',
}

const FEATURE_LABELS: Record<Feature, string> = {
  'ebay.bulk_list':  'eBay Bulk Listing',
  'bulk_wizard':     'Bulk Wizard (AI Scan)',
  'reports':         'Reports & Analytics',
  'csv_export':      'CSV Export',
  'wishlist_alerts': 'Wishlist Price Alerts',
  'team_management': 'Team Management',
  'buyers_crm':      'Buyer Tracking (CRM)',
  'purchase_lots':   'Purchase Lots',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface FeatureGateProps {
  /** Gate by plan feature — user's org must include this feature */
  feature?: Feature
  /** Gate by role action — user's role must permit this action */
  action?:  Action
  children: ReactNode
  /**
   * Custom fallback when access is denied.
   * If not provided, renders the default upgrade/permission card.
   */
  fallback?: ReactNode
  /**
   * Inline mode — wraps children with opacity + pointer-events-none rather
   * than replacing them. Good for disabling individual buttons.
   */
  inline?: boolean
  /**
   * Loading state — render a skeleton instead of the gate while permissions load.
   * Defaults to null (nothing shown during load).
   */
  loadingFallback?: ReactNode
}

// ── Default upgrade prompt ────────────────────────────────────────────────────

function UpgradePrompt({ feature, isRoleBlock }: { feature?: Feature; isRoleBlock: boolean }) {
  if (isRoleBlock) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-6 text-center">
        <p className="text-sm font-medium text-foreground">Owner access required</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only owners can perform this action. Contact your team owner.
        </p>
      </div>
    )
  }

  const planLabel    = feature ? FEATURE_PLAN_LABELS[feature] : 'a higher'
  const featureLabel = feature ? FEATURE_LABELS[feature] : 'this feature'
  const planId       = planLabel?.toLowerCase() as keyof typeof PLAN_PRICES | undefined
  const priceStr     = planId && PLAN_PRICES[planId] ? formatPlanPrice(planId) : ''

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-6 text-center space-y-3">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        {planLabel} plan
      </div>
      <p className="text-sm font-medium text-foreground">
        {featureLabel} is available on the {planLabel} plan
        {priceStr ? ` (from ${priceStr})` : ''}
      </p>
      <p className="text-xs text-muted-foreground">
        Upgrade your subscription to unlock this feature.
      </p>
      <Link
        href="/billing"
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        View plans →
      </Link>
    </div>
  )
}

// ── Gate component ────────────────────────────────────────────────────────────

export function FeatureGate({
  feature,
  action,
  children,
  fallback,
  inline = false,
  loadingFallback = null,
}: FeatureGateProps) {
  const { loading, hasPlan, can, isAuthed } = usePermissions()

  if (loading) return <>{loadingFallback}</>
  if (!isAuthed) return null

  // Evaluate access
  const planOk = !feature || hasPlan(feature)
  const roleOk = !action  || can(action)
  const hasAccess = planOk && roleOk

  if (hasAccess) return <>{children}</>

  // Denied — determine the reason for the best prompt
  const isRoleBlock = planOk && !roleOk

  if (inline) {
    return (
      <div
        className="relative select-none"
        title={isRoleBlock ? 'Owner access required' : `Upgrade to ${feature ? FEATURE_PLAN_LABELS[feature] : 'a higher plan'} to unlock`}
      >
        <div className="pointer-events-none opacity-40">
          {children}
        </div>
      </div>
    )
  }

  return (
    <>
      {fallback ?? (
        <UpgradePrompt feature={feature} isRoleBlock={isRoleBlock} />
      )}
    </>
  )
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/** Gate that only renders children for org owners */
export function OwnerOnly({
  children,
  fallback,
  inline,
}: {
  children: ReactNode
  fallback?: ReactNode
  inline?: boolean
}) {
  return (
    <FeatureGate action="settings.edit" fallback={fallback} inline={inline}>
      {children}
    </FeatureGate>
  )
}

/** Gate that renders children only when org has the given plan feature */
export function PlanGate({
  feature,
  children,
  fallback,
  inline,
}: {
  feature: Feature
  children: ReactNode
  fallback?: ReactNode
  inline?: boolean
}) {
  return (
    <FeatureGate feature={feature} fallback={fallback} inline={inline}>
      {children}
    </FeatureGate>
  )
}
