// =============================================================================
// Dashboard page — server component.
//
// Rendering strategy:
//   1. Stat cards are rendered server-side (SSR) via the Redis-cached
//      org_dashboard_stats view. Fast first paint, no client JS.
//   2. Charts (ProfitChart, PlatformChart, ActivityFeed) are a client
//      component that hydrates after HTML is delivered and fetches its own
//      data. Each chart renders its own skeleton so they load independently.
//
// Quick actions sit in the page header as lightweight link-buttons, giving
// the user one-click access to the most common tasks without taking up
// a dedicated section of the dashboard.
// =============================================================================
import Link from 'next/link'
import { Plus, ReceiptText, Package, Layers, ShoppingCart, Tag, Banknote, TrendingUp, Truck, PackageCheck, Percent } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { getServerSession }  from '@/lib/auth'
import { withCache }         from '@/lib/cache'
import { formatGBP, formatNumber } from '@/lib/utils'
import { DashboardCharts }   from '@/components/dashboard/DashboardCharts'
import { DashboardHeader }   from '@/components/dashboard/DashboardHeader'
import type { DashboardStats } from '@/types'

export const metadata = { title: 'Dashboard' }

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getStats(orgId: string): Promise<DashboardStats | null> {
  return withCache(
    `dashboard:${orgId}`,
    60,   // 60-second Redis TTL — invalidated on every card/sale mutation
    async () => {
      const db = createAdminClient()
      const { data } = await db
        .from('org_dashboard_stats')
        .select('*')
        .eq('org_id', orgId)
        .single()
      return data as DashboardStats | null
    },
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:   string
  value:   string
  sub?:    string
  colour?: 'green' | 'red' | 'primary' | 'default'
  icon?:   React.ReactNode
}

function StatCard({ label, value, sub, colour = 'default', icon }: StatCardProps) {
  const valueClass = {
    green:   'text-green-400',
    red:     'text-red-400',
    primary: 'text-primary',
    default: 'text-foreground',
  }[colour]

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider leading-none">
          {label}
        </p>
        {icon && (
          <span className="text-muted-foreground/35" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <p className={`text-3xl font-bold tabular-nums leading-none ${valueClass}`}>
        {value}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-2">{sub}</p>
      )}
    </div>
  )
}

// ── Quick action link-button ──────────────────────────────────────────────────

interface QuickActionProps {
  href:     string
  icon:     React.ReactNode
  label:    string
  variant?: 'primary' | 'secondary'
}

function QuickAction({ href, icon, label, variant = 'secondary' }: QuickActionProps) {
  const base = [
    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ].join(' ')

  const styles = variant === 'primary'
    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : 'bg-secondary text-foreground hover:bg-secondary/80'

  return (
    <Link href={href} className={`${base} ${styles}`}>
      {icon}
      {label}
    </Link>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  // Cookie-local session check — zero network calls. See lib/auth.ts for rationale.
  const session = await getServerSession()
  if (!session?.user) return null

  const db = createAdminClient()
  const { data: profile } = await db
    .from('users')
    .select('org_id')
    .eq('id', session.user.id)
    .single()

  const stats = profile ? await getStats(profile.org_id as string) : null

  return (
    <div className="space-y-6">

      {/* Sets TopBar title (client-side, no SSR needed) */}
      <DashboardHeader />

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <QuickAction
          href="/stock"
          icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
          label="Add card"
          variant="secondary"
        />
        <QuickAction
          href="/sales"
          icon={<ReceiptText className="h-3.5 w-3.5" aria-hidden />}
          label="Record sale"
          variant="secondary"
        />
        <QuickAction
          href="/sealed"
          icon={<Package className="h-3.5 w-3.5" aria-hidden />}
          label="Add sealed"
          variant="primary"
        />
      </div>

      {/* ── Stat cards (SSR, Redis-cached) ──────────────────────────────── */}
      {stats ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="In stock"
            value={formatNumber(stats.active_card_count)}
            sub={`${formatNumber(stats.listed_count)} listed`}
            colour="primary"
            icon={<Layers className="h-4 w-4" />}
          />
          <StatCard
            label="Inventory cost"
            value={formatGBP(stats.inventory_cost)}
            sub="Purchase basis"
            icon={<ShoppingCart className="h-4 w-4" />}
          />
          <StatCard
            label="Listed value"
            value={formatGBP(stats.listed_value)}
            sub="Combined list prices"
            icon={<Tag className="h-4 w-4" />}
          />
          <StatCard
            label="Total revenue"
            value={formatGBP(stats.total_revenue)}
            icon={<Banknote className="h-4 w-4" />}
          />
          <StatCard
            label="Total profit"
            value={formatGBP(stats.total_profit, { showSign: true })}
            colour={stats.total_profit > 0 ? 'green' : stats.total_profit < 0 ? 'red' : 'default'}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            label="Pending dispatch"
            value={formatNumber(stats.to_ship)}
            sub={stats.to_ship === 1 ? 'order to ship' : 'orders to ship'}
            icon={<Truck className="h-4 w-4" />}
          />
          <StatCard
            label="Pending delivery"
            value={formatNumber(stats.to_deliver)}
            sub={stats.to_deliver === 1 ? 'order in transit' : 'orders in transit'}
            icon={<PackageCheck className="h-4 w-4" />}
          />
          {(() => {
            const margin = stats.total_revenue > 0
              ? (stats.total_profit / stats.total_revenue) * 100
              : null
            return (
              <StatCard
                label="Net margin"
                value={margin !== null ? `${margin.toFixed(1)}%` : '—'}
                sub="Profit ÷ revenue"
                colour={margin === null ? 'default' : margin >= 20 ? 'green' : margin < 0 ? 'red' : 'default'}
                icon={<Percent className="h-4 w-4" />}
              />
            )
          })()}
        </div>
      ) : (
        /* Stat skeleton — matches the 3-col grid so layout doesn't shift */
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card px-5 py-5 animate-pulse"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="h-2.5 w-20 rounded bg-secondary/60" />
                <div className="h-4 w-4 rounded bg-secondary/40" />
              </div>
              <div className="h-8 w-28 rounded bg-secondary/60" />
            </div>
          ))}
        </div>
      )}

      {/* ── Charts + activity (client component) ────────────────────────── */}
      <DashboardCharts />
    </div>
  )
}
