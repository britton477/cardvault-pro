'use client'
// =============================================================================
// StockBySet — horizontal bar chart of inventory cost by set (top 10).
// Each bar is proportional to the highest-value set so comparisons are easy.
// =============================================================================
import { useDashboardInsights } from '@/hooks/useDashboard'
import { formatGBP }            from '@/lib/utils'

function BarSkeleton() {
  return (
    <div className="flex items-center gap-3 animate-pulse">
      <div className="w-16 h-2.5 rounded bg-secondary/40 shrink-0" />
      <div className="flex-1 h-5 rounded bg-secondary/30" />
      <div className="w-12 h-2.5 rounded bg-secondary/40 shrink-0" />
    </div>
  )
}

export function StockBySet() {
  const { data, isLoading } = useDashboardInsights()
  const items = data?.stock_by_set ?? []

  const maxValue = items[0]?.total_value ?? 1 // items already sorted desc

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      {/* Header */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Stock Value by Set
      </p>

      {/* Bars */}
      <div className="space-y-2.5">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <BarSkeleton key={i} />)
          : items.length === 0
            ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No stock data yet.
              </p>
            )
            : items.map(item => {
              const pct = Math.max(4, (item.total_value / maxValue) * 100)
              return (
                <div key={item.set_code} className="flex items-center gap-3">
                  {/* Set code label */}
                  <p
                    className="text-xs text-muted-foreground font-mono w-16 truncate shrink-0 text-right"
                    title={item.set_code}
                  >
                    {item.set_code}
                  </p>

                  {/* Bar track */}
                  <div className="flex-1 h-5 bg-secondary/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-primary/70 rounded transition-all duration-500 flex items-center px-2"
                      style={{ width: `${pct}%` }}
                    >
                      {pct > 25 && (
                        <span className="text-[10px] font-medium text-primary-foreground tabular-nums truncate">
                          {item.card_count}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Value */}
                  <p className="text-xs font-semibold tabular-nums text-foreground w-14 text-right shrink-0">
                    {formatGBP(item.total_value)}
                  </p>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}
