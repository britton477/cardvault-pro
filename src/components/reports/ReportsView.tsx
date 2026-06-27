'use client'
// =============================================================================
// ReportsView — P&L dashboard with date range picker, metrics, and CSV export
// =============================================================================
import { useState }                         from 'react'
import { Download, TrendingUp, Package, BarChart3, Layers } from 'lucide-react'
import { useReportSummary, downloadCSV }    from '@/hooks/useReports'
import { formatGBP }                        from '@/lib/utils'
import { cn }                               from '@/lib/utils'

// ── Date range presets ────────────────────────────────────────────────────────

type PresetKey = 'this_month' | 'last_month' | 'last_3m' | 'ytd' | 'this_year' | 'custom'

function getPresetDates(key: PresetKey): { from: string; to: string } {
  const now   = new Date()
  const y     = now.getFullYear()
  const m     = now.getMonth() + 1
  const today = toISO(now)

  function toISO(d: Date): string {
    return d.toISOString().split('T')[0]!
  }

  function pad(n: number) { return String(n).padStart(2, '0') }

  switch (key) {
    case 'this_month':
      return { from: `${y}-${pad(m)}-01`, to: today }
    case 'last_month': {
      const lm = new Date(y, m - 2, 1)
      const le = new Date(y, m - 1, 0)
      return { from: toISO(lm), to: toISO(le) }
    }
    case 'last_3m': {
      const start = new Date(y, m - 4, 1)
      return { from: toISO(start), to: today }
    }
    case 'ytd':
      return { from: `${y}-01-01`, to: today }
    case 'this_year':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    default:
      return { from: `${y}-${pad(m)}-01`, to: today }
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'this_month',  label: 'This Month'   },
  { key: 'last_month',  label: 'Last Month'   },
  { key: 'last_3m',     label: 'Last 3 Months'},
  { key: 'ytd',         label: 'Year to Date' },
  { key: 'this_year',   label: 'This Year'    },
  { key: 'custom',      label: 'Custom'       },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, accent = false
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={cn(
      'rounded-xl border p-5 space-y-1',
      accent
        ? 'border-green-500/40 bg-green-500/5'
        : 'border-border bg-card',
    )}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums', accent && 'text-green-400')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">{message}</p>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ReportsView() {
  const [preset, setPreset]     = useState<PresetKey>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  const dates = preset === 'custom'
    ? { from: customFrom, to: customTo }
    : getPresetDates(preset)

  const { data, isLoading, error } = useReportSummary(dates.from, dates.to)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-border bg-card/50">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold text-base">Reports</h1>
        </div>

        {/* Export buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCSV('cards')}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Download className="h-3.5 w-3.5" />Stock CSV
          </button>
          <button
            onClick={() => downloadCSV('sealed')}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Download className="h-3.5 w-3.5" />Sealed CSV
          </button>
          <button
            onClick={() => downloadCSV('sales', dates.from, dates.to)}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />Sales CSV
          </button>
        </div>
      </div>

      {/* ── Date range bar ───────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 flex-wrap px-6 py-3 border-b border-border bg-card/30">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={cn(
              'rounded-md px-3 py-1 text-xs transition-colors',
              preset === p.key
                ? 'bg-primary text-primary-foreground font-medium'
                : 'border border-border text-muted-foreground hover:text-foreground hover:bg-secondary',
            )}
          >
            {p.label}
          </button>
        ))}

        {preset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={e => setCustomTo(e.target.value)}
              className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 space-y-8 min-h-0">

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            Failed to load report: {error.message}
          </div>
        )}

        {/* No data prompt for custom with empty dates */}
        {preset === 'custom' && (!customFrom || !customTo) && !isLoading && (
          <p className="py-20 text-center text-sm text-muted-foreground">
            Select a date range above to generate your report.
          </p>
        )}

        {data && (
          <>
            {/* ── P&L Metric Cards ────────────────────────────────────── */}
            <section>
              <SectionHeader icon={TrendingUp} title="Profit & Loss" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Revenue"
                  value={formatGBP(data.total_revenue)}
                  sub={`${data.units_sold} unit${data.units_sold === 1 ? '' : 's'} sold`}
                />
                <MetricCard
                  label="Cost of Goods"
                  value={formatGBP(data.total_cost)}
                  sub={`Fees ${formatGBP(data.total_fees)} · Shipping ${formatGBP(data.total_shipping)}`}
                />
                <MetricCard
                  label="Gross Profit"
                  value={formatGBP(data.total_profit)}
                  sub={`Avg ${formatGBP(data.avg_profit)} / sale`}
                  accent={data.total_profit > 0}
                />
                <MetricCard
                  label="Margin"
                  value={`${data.margin_pct.toFixed(1)}%`}
                  sub={`Avg sale price ${formatGBP(data.avg_sale_price)}`}
                  accent={data.margin_pct > 0}
                />
              </div>
            </section>

            {/* ── Platform Breakdown ───────────────────────────────────── */}
            <section>
              <SectionHeader icon={Layers} title="By Platform" />
              {data.by_platform.length === 0 ? (
                <EmptyState message="No sales in this period." />
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary/30 text-muted-foreground text-xs">
                        <th className="px-4 py-2.5 text-left font-medium">Platform</th>
                        <th className="px-4 py-2.5 text-right font-medium">Units</th>
                        <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                        <th className="px-4 py-2.5 text-right font-medium">Fees</th>
                        <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                        <th className="px-4 py-2.5 text-right font-medium">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.by_platform.map(p => (
                        <tr key={p.platform} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 font-medium">{p.platform}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{p.count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatGBP(p.revenue)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatGBP(p.fees)}</td>
                          <td className={cn('px-4 py-3 text-right tabular-nums font-medium', p.profit >= 0 ? 'text-green-400' : 'text-red-400')}>
                            {formatGBP(p.profit, { showSign: true })}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {p.margin_pct.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── Top Cards ───────────────────────────────────────────── */}
            <section>
              <SectionHeader icon={TrendingUp} title="Top Cards by Profit" />
              {data.top_cards.length === 0 ? (
                <EmptyState message="No sales in this period." />
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary/30 text-muted-foreground text-xs">
                        <th className="px-4 py-2.5 text-left font-medium">#</th>
                        <th className="px-4 py-2.5 text-left font-medium">Card</th>
                        <th className="px-4 py-2.5 text-right font-medium">Units</th>
                        <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                        <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                        <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.top_cards.map((c, i) => (
                        <tr key={i} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">{i + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium leading-tight">{c.card_name}</p>
                            <p className="text-xs text-muted-foreground">{[c.set_code, c.condition].filter(Boolean).join(' · ')}</p>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{c.units_sold}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatGBP(c.revenue)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatGBP(c.cost)}</td>
                          <td className={cn('px-4 py-3 text-right tabular-nums font-medium', c.profit >= 0 ? 'text-green-400' : 'text-red-400')}>
                            {formatGBP(c.profit, { showSign: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── Inventory Snapshot ───────────────────────────────────── */}
            <section>
              <SectionHeader icon={Package} title="Inventory (Current)" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Total Cards"
                  value={String(data.inventory.total_cards)}
                  sub={`${data.inventory.in_stock} in stock · ${data.inventory.listed} listed`}
                />
                <MetricCard
                  label="Inventory Cost"
                  value={formatGBP(data.inventory.total_cost)}
                  sub="Total purchase price of active stock"
                />
                <MetricCard
                  label="Listed Value"
                  value={formatGBP(data.inventory.listed_value)}
                  sub={`${data.inventory.listed} cards currently listed`}
                />
                <MetricCard
                  label="Potential Profit"
                  value={formatGBP(data.inventory.potential_profit)}
                  sub="Listed value minus cost (Listed cards only)"
                  accent={data.inventory.potential_profit > 0}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
