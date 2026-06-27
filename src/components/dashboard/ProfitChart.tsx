'use client'
// =============================================================================
// ProfitChart v2 — Production redesign.
//
// Key improvements over v1:
//   • Monotone cubic bezier interpolation — smooth curves through all data
//     points, no angular spikes, no overshooting. Same algorithm as d3-shape
//     curveMonotoneX: computes tangents from adjacent secants and scales them
//     down to preserve local monotonicity.
//   • Nice-number Y axis — ticks at clean intervals (£0, £5, £10, £15) derived
//     via a proper niceStep() function rather than dividing raw range by 4.
//   • SVG glow filter — feGaussianBlur merged back with source for a subtle
//     bloom on the line stroke.
//   • Three-stop gradient fill — 22% → 4% → 0% so the fill reads in dark mode
//     without dominating the chart.
//   • Sale-day dot markers — small circles on days with actual sales for
//     at-a-glance activity density.
//   • Props-based range — controlled by DashboardCharts so ProfitSnapshot
//     always mirrors the same period. TanStack deduplicates the fetch.
// =============================================================================
import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useDashboardCharts } from '@/hooks/useDashboard'
import { formatGBP, cn }      from '@/lib/utils'
import type { ProfitTrendPoint } from '@/types'

// ── Exported type (consumed by DashboardCharts + ProfitSnapshot) ──────────────
export type Range = 30 | 60 | 90

// ── Geometry constants ────────────────────────────────────────────────────────
const VW  = 560
const VH  = 180
const PAD = { top: 16, right: 16, bottom: 36, left: 60 } as const
const IW  = VW - PAD.left - PAD.right   // 484
const IH  = VH - PAD.top  - PAD.bottom  // 128

// ── Axis label formatter ──────────────────────────────────────────────────────
function axisLabel(v: number): string {
  const sign = v < 0 ? '-' : ''
  const abs  = Math.abs(v)
  if (abs >= 1000) return `${sign}£${(abs / 1000).toFixed(1)}k`
  return `${sign}£${Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(1)}`
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function tooltipDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

// ── Nice-number Y-axis ticks ──────────────────────────────────────────────────
// Produces clean intervals like 0, 5, 10, 15 instead of 0, 3.75, 7.5, 11.25.
function niceStep(range: number): number {
  if (range <= 0) return 1
  const rough = range / 4
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)))
  const f     = rough / mag
  if (f < 1.5) return mag
  if (f < 3.5) return 2 * mag
  if (f < 7.5) return 5 * mag
  return 10 * mag
}

function niceTicks(minV: number, maxV: number): number[] {
  const step = niceStep(maxV - minV || 1)
  const lo   = Math.floor(minV / step) * step
  const hi   = Math.ceil(maxV  / step) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step * 0.001; v += step) {
    out.push(Math.round(v * 1e6) / 1e6)  // eliminate float drift
  }
  return out
}

// ── Monotone cubic bezier interpolation ──────────────────────────────────────
// Mirrors the d3-shape curveMonotoneX algorithm.
// Steps:
//  1. Compute secant slopes between consecutive points.
//  2. Initialise tangents as averages of adjacent secants (Catmull-Rom style).
//  3. Scale down any tangent pair that would overshoot a flat segment.
//  4. Emit C (cubic bezier) commands using tangents as control-point guides.
function monotonePath(pts: [number, number][]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`

  const dxA: number[]  = []
  const sec: number[]  = []

  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0]
    dxA.push(dx)
    sec.push((pts[i + 1][1] - pts[i][1]) / dx)
  }

  // Tangents: average adjacent secants (Fritsch–Carlson)
  const tan: number[] = [sec[0]]
  for (let i = 1; i < n - 1; i++) tan.push((sec[i - 1] + sec[i]) / 2)
  tan.push(sec[n - 2])

  // Monotonicity guard: scale back tangents that would cause overshoot
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(sec[i]) < 1e-10) {
      tan[i] = 0; tan[i + 1] = 0
    } else {
      const a = tan[i]     / sec[i]
      const b = tan[i + 1] / sec[i]
      const h = Math.sqrt(a * a + b * b)
      if (h > 3) {
        const t = 3 / h
        tan[i]     = t * a * sec[i]
        tan[i + 1] = t * b * sec[i]
      }
    }
  }

  let path = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const cp1x = pts[i][0]     + dxA[i] / 3
    const cp1y = pts[i][1]     + tan[i]     * dxA[i] / 3
    const cp2x = pts[i + 1][0] - dxA[i] / 3
    const cp2y = pts[i + 1][1] - tan[i + 1] * dxA[i] / 3
    path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`
  }
  return path
}

// ── Chart geometry builder ────────────────────────────────────────────────────
interface ChartGeo {
  linePath: string
  areaPath: string
  zeroY:    number
  ticks:    { v: number; y: number }[]
  xLabels:  { date: string; x: number }[]
  xAt:      (i: number) => number
  yAt:      (v: number) => number
}

function buildGeo(data: ProfitTrendPoint[]): ChartGeo | null {
  if (data.length === 0) return null

  const profits  = data.map(d => d.profit)
  const rawMin   = Math.min(...profits)
  const rawMax   = Math.max(...profits)
  const tickNums = niceTicks(Math.min(0, rawMin), Math.max(0, rawMax))
  const domMin   = tickNums[0]
  const domMax   = tickNums[tickNums.length - 1]
  const yRange   = domMax - domMin || 1

  const xAt = (i: number) =>
    PAD.left + (data.length <= 1 ? IW / 2 : (i / (data.length - 1)) * IW)
  const yAt = (v: number) =>
    PAD.top + IH - ((v - domMin) / yRange) * IH

  const zeroY = yAt(0)
  const pts   = data.map((d, i): [number, number] => [xAt(i), yAt(d.profit)])

  const linePath = monotonePath(pts)
  const areaPath = pts.length > 0
    ? `${linePath} L ${pts[pts.length - 1][0].toFixed(1)},${zeroY.toFixed(1)} L ${pts[0][0].toFixed(1)},${zeroY.toFixed(1)} Z`
    : ''

  const ticks = tickNums.map(v => ({ v, y: yAt(v) }))

  // X labels: ≤6 evenly spaced, always include first + last
  const maxLabels = Math.min(6, data.length)
  const step      = Math.max(1, Math.round((data.length - 1) / (maxLabels - 1)))
  const xLabels   = data
    .map((d, i) => ({ date: d.date, i }))
    .filter(({ i }) => i % step === 0 || i === data.length - 1)
    .map(({ date, i }) => ({ date, x: xAt(i) }))

  return { linePath, areaPath, zeroY, ticks, xLabels, xAt, yAt }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-3 w-28 rounded bg-secondary/60" />
          <div className="h-6 w-20 rounded bg-secondary/60" />
        </div>
        <div className="h-8 w-32 rounded-md bg-secondary/60" />
      </div>
      <div className="rounded-lg bg-secondary/40" style={{ height: 'clamp(160px, 16vw, 220px)' }} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface ProfitChartProps {
  range:         Range
  onRangeChange: (r: Range) => void
}

export function ProfitChart({ range, onRangeChange }: ProfitChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef                  = useRef<SVGSVGElement>(null)

  const { data, isLoading } = useDashboardCharts(range)

  const geo         = data ? buildGeo(data.profit_trend) : null
  const trend       = data?.profit_trend ?? []
  const totalProfit = trend.reduce((s, d) => s + d.profit, 0)
  const totalSales  = trend.reduce((s, d) => s + d.count,  0)
  const hasSales    = trend.some(d => d.count > 0)

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!geo || !svgRef.current || trend.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * VW
    const relX = svgX - PAD.left
    const raw  = (relX / IW) * (trend.length - 1)
    setHoverIdx(Math.max(0, Math.min(trend.length - 1, Math.round(raw))))
  }, [geo, trend])

  const hoverPt = hoverIdx !== null ? trend[hoverIdx] ?? null : null

  if (isLoading) return <ChartSkeleton />

  const profitColour = totalProfit > 0 ? 'text-green-400'
    : totalProfit < 0 ? 'text-red-400'
    : 'text-foreground'
  const TrendIcon = totalProfit > 0 ? TrendingUp : totalProfit < 0 ? TrendingDown : Minus

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Profit over time
          </p>
          <div className="flex items-center gap-2 mt-1">
            <TrendIcon className={cn('h-4 w-4 shrink-0', profitColour)} aria-hidden />
            <span className={cn('text-2xl font-bold tabular-nums', profitColour)}>
              {formatGBP(totalProfit, { showSign: true })}
            </span>
            <span className="text-xs text-muted-foreground self-end mb-0.5">
              {totalSales} sale{totalSales !== 1 ? 's' : ''} · last {range}d
            </span>
          </div>
        </div>

        {/* Range toggle */}
        <div
          className="flex rounded-md border border-border overflow-hidden text-xs font-medium"
          role="group"
          aria-label="Date range"
        >
          {([30, 60, 90] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => { onRangeChange(r); setHoverIdx(null) }}
              className={cn(
                'px-3 py-1.5 transition-colors',
                r === range
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
              )}
              aria-pressed={r === range}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* ── Chart area ──────────────────────────────────────────────────── */}
      {!hasSales ? (
        <div
          className="flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
          style={{ height: 'clamp(160px, 16vw, 220px)' }}
        >
          <p>No sales in this period.</p>
          <Link href="/sales" className="text-primary hover:underline text-xs">
            Record your first sale →
          </Link>
        </div>
      ) : (
        <div
          className="relative select-none w-full"
          style={{ height: 'clamp(160px, 16vw, 220px)' }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIdx(null)}
            aria-label="Profit trend chart"
            role="img"
          >
            <defs>
              {/* Three-stop fill gradient — visible but not heavy */}
              <linearGradient id="cvp-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity="0.22" />
                <stop offset="70%"  stopColor="hsl(var(--primary))" stopOpacity="0.05" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0"    />
              </linearGradient>

              {/* Glow filter — blur merged back with source for bloom effect */}
              <filter id="cvp-glow" x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Clip: keep line + area within the plot box */}
              <clipPath id="cvp-clip">
                <rect x={PAD.left} y={PAD.top} width={IW} height={IH} />
              </clipPath>
            </defs>

            {geo && (
              <>
                {/* Grid lines only — NO SVG text (text goes in HTML layer below) */}
                {geo.ticks.map(({ v, y }, i) => (
                  <line
                    key={i}
                    x1={PAD.left} y1={y.toFixed(1)}
                    x2={VW - PAD.right} y2={y.toFixed(1)}
                    stroke="hsl(var(--border))"
                    strokeOpacity={v === 0 ? 0.7 : 0.35}
                    strokeWidth={v === 0 ? 1 : 0.75}
                  />
                ))}

                {/* Filled area under the curve */}
                <path
                  d={geo.areaPath}
                  fill="url(#cvp-fill)"
                  clipPath="url(#cvp-clip)"
                />

                {/* Smooth line with glow */}
                <path
                  d={geo.linePath}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  clipPath="url(#cvp-clip)"
                  filter="url(#cvp-glow)"
                />

                {/* Sale-day dot markers */}
                {trend.map((d, i) => d.count > 0 && (
                  <circle
                    key={i}
                    cx={geo.xAt(i).toFixed(1)}
                    cy={geo.yAt(d.profit).toFixed(1)}
                    r="3"
                    fill="hsl(var(--primary))"
                    stroke="hsl(var(--card))"
                    strokeWidth="1.5"
                    clipPath="url(#cvp-clip)"
                  />
                ))}

                {/* Hover: vertical rule + active dot */}
                {hoverIdx !== null && hoverPt && (
                  <>
                    <line
                      x1={geo.xAt(hoverIdx).toFixed(1)} y1={PAD.top}
                      x2={geo.xAt(hoverIdx).toFixed(1)} y2={PAD.top + IH}
                      stroke="hsl(var(--border))"
                      strokeWidth="1"
                      strokeDasharray="3 2"
                    />
                    <circle
                      cx={geo.xAt(hoverIdx).toFixed(1)}
                      cy={geo.yAt(hoverPt.profit).toFixed(1)}
                      r="5"
                      fill="hsl(var(--primary))"
                      stroke="hsl(var(--card))"
                      strokeWidth="2.5"
                    />
                  </>
                )}
              </>
            )}
          </svg>

          {/* ── HTML axis labels — immune to SVG scaling ────────────────
               SVG percentages: left = (svgX / VW) * 100, top = (svgY / VH) * 100.
               This maps exactly onto the scaled SVG because preserveAspectRatio="none"
               stretches the coordinate space linearly to fill the container. ── */}
          {geo && (
            <>
              {/* Y-axis labels — right-aligned in the left padding column */}
              {geo.ticks.map(({ v, y }) => (
                <div
                  key={v}
                  className="absolute pointer-events-none tabular-nums text-[11px] leading-none text-muted-foreground/70"
                  style={{
                    top:       `${((y / VH) * 100).toFixed(2)}%`,
                    left:      0,
                    width:     `${((PAD.left - 6) / VW * 100).toFixed(2)}%`,
                    transform: 'translateY(-50%)',
                    textAlign: 'right',
                  }}
                >
                  {axisLabel(v)}
                </div>
              ))}

              {/* X-axis labels — centred on their data point, edge-pinned at ends */}
              {geo.xLabels.map(({ date, x }, i, arr) => {
                const isFirst  = i === 0
                const isLast   = i === arr.length - 1
                const translate = isFirst ? '0%' : isLast ? '-100%' : '-50%'
                return (
                  <div
                    key={date}
                    className="absolute pointer-events-none text-[11px] leading-none text-muted-foreground/70 whitespace-nowrap"
                    style={{
                      bottom:    0,
                      left:      `${((x / VW) * 100).toFixed(2)}%`,
                      height:    `${((PAD.bottom) / VH * 100).toFixed(2)}%`,
                      transform: `translateX(${translate})`,
                      display:   'flex',
                      alignItems: 'flex-end',
                      paddingBottom: '3px',
                    }}
                  >
                    {shortDate(date)}
                  </div>
                )
              })}
            </>
          )}

          {/* ── Tooltip ─────────────────────────────────────────────────── */}
          {hoverPt && geo && hoverIdx !== null && (
            <div
              className="pointer-events-none absolute z-10 min-w-[144px] rounded-lg border border-border bg-card/95 backdrop-blur-sm shadow-xl px-3 py-2.5 text-xs space-y-1"
              style={{
                left:      `${((geo.xAt(hoverIdx) / VW) * 100).toFixed(2)}%`,
                top:       `${((geo.yAt(hoverPt.profit) / VH) * 100).toFixed(2)}%`,
                transform: 'translate(-50%, calc(-100% - 12px))',
              }}
              role="tooltip"
            >
              <p className="font-medium text-foreground leading-none mb-1.5">
                {tooltipDate(hoverPt.date)}
              </p>
              <p className={cn(
                'font-bold tabular-nums text-sm leading-none',
                hoverPt.profit > 0 ? 'text-green-400'
                  : hoverPt.profit < 0 ? 'text-red-400'
                  : 'text-muted-foreground',
              )}>
                {formatGBP(hoverPt.profit, { showSign: true })}
              </p>
              {hoverPt.count > 0 ? (
                <p className="text-muted-foreground leading-none mt-1">
                  {hoverPt.count} sale{hoverPt.count !== 1 ? 's' : ''}
                  {' · '}{formatGBP(hoverPt.revenue)} rev
                </p>
              ) : (
                <p className="text-muted-foreground/50 leading-none mt-1">No sales</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
