'use client'
// =============================================================================
// PriceOpportunities — cards where eBay avg sold > your listed price.
// Ranked by gap (biggest underpricing first) so the user knows where
// raising the price would have the most impact.
// =============================================================================
import Link                     from 'next/link'
import { TrendingUp }           from 'lucide-react'
import { useDashboardInsights } from '@/hooks/useDashboard'
import { formatGBP }            from '@/lib/utils'

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5 animate-pulse">
      <div className="h-9 w-6 rounded bg-secondary/40 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-3/4 rounded bg-secondary/50" />
        <div className="h-2 w-1/2 rounded bg-secondary/30" />
      </div>
      <div className="h-4 w-16 rounded bg-secondary/40" />
    </div>
  )
}

export function PriceOpportunities() {
  const { data, isLoading } = useDashboardInsights()
  const items = data?.price_opportunities ?? []

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-green-400 shrink-0" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Price Opportunities
        </p>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
          : items.length === 0
            ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No underpriced listings found. Nice work!
              </p>
            )
            : items.map(item => (
              <Link
                key={item.id}
                href={`/stock?search=${encodeURIComponent(item.card_name)}`}
                className="flex items-center gap-3 py-2.5 group hover:bg-secondary/20 -mx-2 px-2 rounded transition-colors"
              >
                {/* Thumb */}
                <div className="h-9 w-6 rounded overflow-hidden bg-secondary shrink-0">
                  {item.thumb_url
                    ? <img src={item.thumb_url} alt={item.card_name} className="object-cover w-full h-full" loading="lazy" />
                    : <span className="flex items-center justify-center h-full text-[10px]">🃏</span>
                  }
                </div>

                {/* Name + prices */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate leading-tight group-hover:text-primary transition-colors">
                    {item.card_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Listed {formatGBP(item.listed_price)}
                    <span className="mx-1">·</span>
                    eBay avg {formatGBP(item.ebay_avg_sold)}
                  </p>
                </div>

                {/* Gap badge */}
                <div className="shrink-0 text-right">
                  <span className="text-xs font-semibold text-green-400 tabular-nums">
                    +{formatGBP(item.gap)}
                  </span>
                  <p className="text-[11px] text-muted-foreground">gap</p>
                </div>
              </Link>
            ))
        }
      </div>
    </div>
  )
}
