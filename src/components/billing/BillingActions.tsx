'use client'
// =============================================================================
// BillingActions — client component for Stripe redirect buttons
//
// Handles: Upgrade (→ Checkout), Manage subscription (→ Portal)
// Both flows redirect the user to Stripe's hosted pages and return to /billing.
// =============================================================================
import { useState } from 'react'
import type { PlanId } from '@/lib/stripe'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface Props {
  hasStripe:  boolean
  mode:       'upgrade' | 'portal-only'
  planId?:    PlanId
  planName?:  string
}

export function BillingActions({ hasStripe, mode, planId, planName }: Props) {
  const [loading, setLoading] = useState<'checkout' | 'portal' | null>(null)

  // ── Checkout (upgrade to a paid plan) ────────────────────────────────────
  async function handleUpgrade() {
    if (!planId || loading) return
    setLoading('checkout')
    try {
      const res  = await fetch('/api/billing/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan_id: planId }),
      })
      const data = await res.json() as { url?: string; error?: string }

      if (!res.ok || !data.url) {
        alert(data.error ?? 'Could not start checkout. Please try again.')
        return
      }
      window.location.href = data.url
    } catch {
      alert('Network error — please check your connection and try again.')
    } finally {
      setLoading(null)
    }
  }

  // ── Portal (manage existing subscription) ────────────────────────────────
  async function handlePortal() {
    if (loading) return
    setLoading('portal')
    try {
      const res  = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json() as { url?: string; error?: string }

      if (!res.ok || !data.url) {
        alert(data.error ?? 'Could not open billing portal. Please try again.')
        return
      }
      window.location.href = data.url
    } catch {
      alert('Network error — please check your connection and try again.')
    } finally {
      setLoading(null)
    }
  }

  // ── Portal-only mode (shown in status banners + current plan card) ────────
  if (mode === 'portal-only') {
    return (
      <button
        onClick={() => void handlePortal()}
        disabled={!!loading}
        className={cn(
          'text-xs font-medium px-3 py-1.5 rounded-md border border-border',
          'bg-secondary hover:bg-secondary/80 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'flex items-center gap-1.5',
        )}
      >
        {loading === 'portal' && <Loader2 className="h-3 w-3 animate-spin" />}
        Manage subscription
      </button>
    )
  }

  // ── Upgrade mode (shown in plan cards) ───────────────────────────────────
  return (
    <button
      onClick={() => void handleUpgrade()}
      disabled={!!loading}
      className={cn(
        'w-full py-2 px-3 rounded-md text-sm font-semibold transition-colors',
        'bg-primary text-primary-foreground hover:bg-primary/90',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'flex items-center justify-center gap-1.5',
      )}
    >
      {loading === 'checkout' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {loading === 'checkout' ? 'Opening checkout…' : `Upgrade to ${planName ?? 'this plan'}`}
    </button>
  )
}
