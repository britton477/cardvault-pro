'use client'
// =============================================================================
// ProfitSnapshot — period summary panel shown to the right of ProfitChart.
//
// Consumes the same useDashboardCharts(range) call as ProfitChart — TanStack
// Query deduplicates the fetch so there is no extra network request.
//
// Shows four derived stats from the profit_trend array:
//   - Avg profit per sale
//   - Best single day (highest profit day with date)
//   - Total revenue in period
//   - Sales count in period
// =============================================================================
import { useDashboardCharts }  from '@/hooks/useDashboard'
import { formatGBP, cn }       from '@/lib/utils'
import type { ProfitTrendPoint } from '@/types'
import type { Range }            from './ProfitChart'

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function bestDay(trend: ProfitTrendPoint[]): ProfitTrendPoint | null {
  const active = trend.filter(d => d.count > 0)
  if (!active.length) return null
  return active.reduce((best, d) => d.profit > best.profit ? d : best, active[0])
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SnapshotSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4 animate-pulse">
      <div className="h-2.5 w-24 rounded bg-secondary/60" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-md bg-secondary/30 px-3 py-3 space-y-2">
            <div className="h-2 w-14 rounded bg-secondary/50" />
            <div className="h-5 w-20 rounded bg-secondary/60" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProfitSnapshot({ range }: { range: Range }) {
  // Same query key as ProfitChart — TanStack returns cached data, no second fetch
  const { data, isLoading } = useDashboardCharts(range)

  if (isLoading) return <SnapshotSkeleton />

  const trend        = data?.profit_trend ?? []
  const totalProfit  = trend.reduce((s, d) => s + d.profit,  0)
  const totalRevenue = trend.reduce((s, d) => s + d.revenue, 0)
  const totalSales   = trend.reduce((s, d) => s + d.count,   0)
  const avgProfit    = totalSales > 0 ? totalProfit / totalSales : 0
  const best         = bestDay(trend)

  const avgColour = avgProfit > 0 ? 'text-green-400' : avgProfit < 0 ? 'text-red-400' : 'text-foreground'

  const tiles: { label: string; value: string; sub?: string; valueClass?: string }[] = [
    {
      label:      'Avg per sale',
      value:      totalSales > 0 ? formatGBP(avgProfit, { showSign: true }) : '—',
      valueClass: avgColour,
    },
    {
      label:      'Best day',
      value:      best ? formatGBP(best.profit, { showSign: true }) : '—',
      sub:        best ? shortDate(best.date) : undefined,
      valueClass: best && best.profit > 0 ? 'text-green-400' : 'text-foreground',
    },
    {
      label:      'Revenue',
      value:      totalRevenue > 0 ? formatGBP(totalRevenue) : '—',
      valueClass: 'text-foreground',
    },
    {
      label:      'Sales',
      value:      String(totalSales),
      valueClass: 'text-primary',
    },
  ]

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">

      {/* Header */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {range}d summary
      </p>

      {/* 2×2 stat grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map(tile => (
          <div
            key={tile.label}
            className="rounded-md bg-secondary/30 px-3 py-3 space-y-1"
          >
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">
              {tile.label}
            </p>
            <p className={cn('text-xl font-bold tabular-nums leading-tight', tile.valueClass)}>
              {tile.value}
            </p>
            {tile.sub && (
              <p className="text-[11px] text-muted-foreground">{tile.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* Empty nudge */}
      {totalSales === 0 && (
        <p className="text-xs text-muted-foreground text-center pt-1">
          Stats appear once sales are recorded in this period.
        </p>
      )}
    </div>
  )
}
