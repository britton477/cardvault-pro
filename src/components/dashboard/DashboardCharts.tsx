'use client'
// =============================================================================
// DashboardCharts — client boundary and layout container for all charts.
//
// Range state lives here so ProfitChart (renders the line) and ProfitSnapshot
// (shows derived stats) always reflect the same period. TanStack Query
// deduplicates fetches — components sharing a query key get cached data.
//
// Layout:
//   Row 1: ProfitChart (2/3) | ActivityFeed (1/3)
//   Row 2: PlatformChart (2/5) | ProfitSnapshot (3/5)
//   Row 3: SittingLongest (1/3) | PriceOpportunities (1/3) | StockBySet (1/3)
// =============================================================================
import { useState }              from 'react'
import { ProfitChart }           from '@/components/dashboard/ProfitChart'
import { ProfitSnapshot }        from '@/components/dashboard/ProfitSnapshot'
import { PlatformChart }         from '@/components/dashboard/PlatformChart'
import { ActivityFeed }          from '@/components/dashboard/ActivityFeed'
import { SittingLongest }        from '@/components/dashboard/SittingLongest'
import { PriceOpportunities }    from '@/components/dashboard/PriceOpportunities'
import { StockBySet }            from '@/components/dashboard/StockBySet'
import type { Range }            from '@/components/dashboard/ProfitChart'

export function DashboardCharts() {
  const [range, setRange] = useState<Range>(30)

  return (
    <div className="space-y-4">

      {/* ── Profit chart (2/3) + recent activity (1/3) ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2">
          <ProfitChart range={range} onRangeChange={setRange} />
        </div>
        <ActivityFeed />
      </div>

      {/* ── Platform donut (2/5) + period summary (3/5) ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-2"><PlatformChart /></div>
        <div className="lg:col-span-3"><ProfitSnapshot range={range} /></div>
      </div>

      {/* ── Insight widgets (3 equal columns) ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <SittingLongest />
        <PriceOpportunities />
        <StockBySet />
      </div>

    </div>
  )
}
