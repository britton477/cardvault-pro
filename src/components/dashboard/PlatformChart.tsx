'use client'
// =============================================================================
// PlatformChart — SVG donut chart showing all-time sales split by platform.
//
// Design decisions:
//   - Pure SVG arc paths (no library). Gaps between segments via a small
//     angular offset rather than stroke tricks — cleaner on HiDPI screens.
//   - Colors map directly to Tailwind / CSS-var tokens so they work in both
//     light and dark mode without extra configuration.
//   - Center of the donut shows total revenue, not count — more meaningful
//     for a business dashboard.
//   - Hover state: segment lifts slightly (scale) and legend row highlights.
//   - Empty state: ghost donut ring + friendly copy.
// =============================================================================
import { useState } from 'react'
import { useDashboardCharts } from '@/hooks/useDashboard'
import { formatGBP, formatNumber, cn } from '@/lib/utils'
import type { PlatformSplit, SalePlatform } from '@/types'

/** Compact GBP for tight spaces (£1.2k, £250) */
function compactGBP(v: number): string {
  if (v >= 1000) return `£${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return `£${v.toFixed(0)}`
}

// ── Platform colour palette ───────────────────────────────────────────────────

const PLATFORM_COLORS: Record<SalePlatform, { stroke: string; bg: string; text: string }> = {
  'eBay':         { stroke: 'hsl(var(--primary))',  bg: 'bg-primary/15',    text: 'text-primary'       },
  'Facebook':     { stroke: '#3b82f6',              bg: 'bg-blue-500/15',   text: 'text-blue-400'      },
  'Face to Face': { stroke: '#22c55e',              bg: 'bg-green-500/15',  text: 'text-green-400'     },
  'Other':        { stroke: '#f59e0b',              bg: 'bg-amber-500/15',  text: 'text-amber-400'     },
}

const ALL_PLATFORMS: SalePlatform[] = ['eBay', 'Facebook', 'Face to Face', 'Other']

// ── SVG donut math ────────────────────────────────────────────────────────────

const CX = 80   // centre x
const CY = 80   // centre y
const R  = 66   // outer radius
const r  = 42   // inner radius (hole)
const GAP_RAD = 0.035  // angular gap between segments (radians)

function polarXY(angle: number, radius: number) {
  // 0 = top, clockwise
  return {
    x: CX + radius * Math.sin(angle),
    y: CY - radius * Math.cos(angle),
  }
}

function segmentPath(startAngle: number, endAngle: number): string {
  // Shrink each segment by GAP_RAD on each side
  const s = startAngle + GAP_RAD
  const e = endAngle   - GAP_RAD
  if (e <= s) return ''

  const large = (e - s) > Math.PI ? 1 : 0

  const o1 = polarXY(s, R)
  const o2 = polarXY(e, R)
  const i1 = polarXY(e, r)
  const i2 = polarXY(s, r)

  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${R} ${R} 0 ${large} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${r} ${r} 0 ${large} 0 ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

interface Segment {
  platform:   SalePlatform
  startAngle: number
  endAngle:   number
  revenue:    number
  profit:     number
  count:      number
  pct:        number
}

function buildSegments(splits: PlatformSplit[]): Segment[] {
  const total = splits.reduce((s, p) => s + p.revenue, 0)
  if (total === 0) return []

  let angle = 0
  return splits.map(p => {
    const arc   = (p.revenue / total) * 2 * Math.PI
    const start = angle
    angle       += arc
    return {
      platform:   p.platform,
      startAngle: start,
      endAngle:   angle,
      revenue:    p.revenue,
      profit:     p.profit,
      count:      p.count,
      pct:        Math.round((p.revenue / total) * 100),
    }
  })
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-3 w-32 rounded bg-secondary/60" />
      <div className="flex items-center gap-6">
        <div className="h-[160px] w-[160px] rounded-full bg-secondary/40 shrink-0" />
        <div className="space-y-2 flex-1">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-4 rounded bg-secondary/40" style={{ width: `${60 + i * 8}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlatformChart() {
  const [hovered, setHovered] = useState<SalePlatform | null>(null)

  // Always use default 30d range — platform split comes from all-time data in the API
  // (days param only affects profit_trend; platform_split is always all-time)
  const { data, isLoading } = useDashboardCharts(30)

  if (isLoading) return <ChartSkeleton />

  const splits   = data?.platform_split ?? []
  const segments = buildSegments(splits)
  const totalRev = splits.reduce((s, p) => s + p.revenue, 0)
  const totalSales = splits.reduce((s, p) => s + p.count, 0)
  const hasData  = totalSales > 0

  // Only show platforms with actual sales — 0% rows add visual noise
  const legendRows = ALL_PLATFORMS.map(platform => {
    const found = splits.find(s => s.platform === platform)
    return {
      platform,
      revenue: found?.revenue ?? 0,
      count:   found?.count   ?? 0,
      pct:     found ? Math.round((found.revenue / (totalRev || 1)) * 100) : 0,
    }
  }).filter(r => !hasData || r.count > 0)  // show all in empty state; prune zeros when live

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">

      {/* Header */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Sales by platform
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          All time · {totalSales} sale{totalSales !== 1 ? 's' : ''}
        </p>
      </div>

      {!hasData ? (
        /* Empty state */
        <div className="flex items-center gap-6 py-4">
          <svg viewBox="0 0 160 160" className="h-[120px] w-[120px] shrink-0" aria-hidden>
            <circle
              cx={CX} cy={CY} r={(R + r) / 2}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={R - r}
              strokeDasharray="4 3"
            />
          </svg>
          <p className="text-sm text-muted-foreground">
            No sales recorded yet. Revenue will appear here once you start selling.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-5">

          {/* Donut SVG */}
          <div className="relative shrink-0">
            <svg
              viewBox="0 0 160 160"
              className="h-[140px] w-[140px]"
              aria-label="Sales platform breakdown"
              role="img"
            >
              {segments.map(seg => {
                const colors  = PLATFORM_COLORS[seg.platform]
                const isHover = hovered === seg.platform
                return (
                  <path
                    key={seg.platform}
                    d={segmentPath(seg.startAngle, seg.endAngle)}
                    fill={colors.stroke}
                    fillOpacity={isHover ? 1 : 0.75}
                    style={{
                      transform:       isHover ? `scale(1.06)` : 'scale(1)',
                      transformOrigin: `${CX}px ${CY}px`,
                      transition:      'transform 150ms ease, fill-opacity 150ms ease',
                    }}
                    onMouseEnter={() => setHovered(seg.platform)}
                    onMouseLeave={() => setHovered(null)}
                    aria-label={`${seg.platform}: ${seg.pct}%`}
                  />
                )
              })}

              {/* Centre text */}
              <text
                x={CX} y={CY - 6}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="hsl(var(--foreground))"
              >
                {compactGBP(totalRev)}
              </text>
              <text
                x={CX} y={CY + 9}
                textAnchor="middle"
                fontSize="9"
                fill="hsl(var(--muted-foreground))"
              >
                revenue
              </text>
            </svg>
          </div>

          {/* Legend — with mini revenue bars for instant visual proportion */}
          <ul className="flex-1 space-y-2 min-w-0">
            {legendRows.map(row => {
              const colors  = PLATFORM_COLORS[row.platform]
              const isHover = hovered === row.platform
              return (
                <li
                  key={row.platform}
                  className={cn(
                    'rounded-md px-2 py-1.5 transition-colors cursor-default',
                    isHover ? 'bg-secondary/60' : 'hover:bg-secondary/30',
                  )}
                  onMouseEnter={() => setHovered(row.platform)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {/* Name + revenue + count */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: colors.stroke }}
                      aria-hidden
                    />
                    <span className="text-xs text-foreground flex-1 min-w-0 truncate">
                      {row.platform}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-foreground shrink-0">
                      {compactGBP(row.revenue)}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground/60 shrink-0 w-5 text-right">
                      {row.count}
                    </span>
                  </div>
                  {/* Proportional fill bar */}
                  <div className="h-1 w-full rounded-full bg-border/50 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width:      `${row.pct}%`,
                        background: colors.stroke,
                        opacity:    isHover ? 1 : 0.65,
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
