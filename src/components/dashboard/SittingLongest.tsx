'use client'
// =============================================================================
// SittingLongest — shows the 5 active cards that have been in stock longest.
// Helps identify dead inventory that should be repriced or promoted.
// =============================================================================
import Link                     from 'next/link'
import { Clock }                from 'lucide-react'
import { useDashboardInsights } from '@/hooks/useDashboard'
import { formatGBP }            from '@/lib/utils'

function pluralDays(n: number) {
  return `${n} day${n !== 1 ? 's' : ''}`
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5 animate-pulse">
      <div className="h-9 w-6 rounded bg-secondary/40 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-3/4 rounded bg-secondary/50" />
        <div className="h-2 w-1/2 rounded bg-secondary/30" />
      </div>
      <div className="h-4 w-14 rounded bg-secondary/40" />
    </div>
  )
}

export function SittingLongest() {
  const { data, isLoading } = useDashboardInsights()
  const items = data?.sitting_longest ?? []

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Sitting Longest
        </p>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
          : items.length === 0
            ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No active stock found.
              </p>
            )
            : items.map(item => (
              <Link
                key={item.id}
                href="/stock"
                className="flex items-center gap-3 py-2.5 group hover:bg-secondary/20 -mx-2 px-2 rounded transition-colors"
              >
                {/* Thumb */}
                <div className="h-9 w-6 rounded overflow-hidden bg-secondary shrink-0">
                  {item.thumb_url
                    ? <img src={item.thumb_url} alt={item.card_name} className="object-cover w-full h-full" loading="lazy" />
                    : <span className="flex items-center justify-center h-full text-[10px]">🃏</span>
                  }
                </div>

                {/* Name + set */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate leading-tight group-hover:text-primary transition-colors">
                    {item.card_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[item.set_code, item.condition].filter(Boolean).join(' · ')}
                  </p>
                </div>

                {/* Days badge */}
                <div className="text-right shrink-0">
                  <span className={`text-xs font-semibold tabular-nums ${
                    item.days_in_stock > 60 ? 'text-red-400' :
                    item.days_in_stock > 30 ? 'text-yellow-400' :
                    'text-muted-foreground'
                  }`}>
                    {pluralDays(item.days_in_stock)}
                  </span>
                  <p className="text-[11px] text-muted-foreground">{formatGBP(item.purchase_price)}</p>
                </div>
              </Link>
            ))
        }
      </div>
    </div>
  )
}
