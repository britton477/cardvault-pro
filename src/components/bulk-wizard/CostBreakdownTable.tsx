'use client'
// =============================================================================
// CostBreakdownTable — Phase 2: cost analysis
//
// User enters the total they paid for all cards (e.g. a lot purchase).
// The table shows, per card:
//   - eBay market value
//   - % of total market value (weight)
//   - Proportional cost (their share of the spend)
//   - Profit potential (eBay avg − cost)
//   - ROI %
//
// Row colour coding:
//   green  = ROI >= 20%
//   amber  = ROI 0–20%
//   red    = ROI < 0 (loss)
//   grey   = no eBay price (can't compute)
// =============================================================================
import { useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react'
import { cn, formatGBP } from '@/lib/utils'
import type { BulkWizardCard } from '@/types'

interface CostBreakdownTableProps {
  cards:         BulkWizardCard[]  // already have proportional_cost computed
  totalSpend:    number
  onSpendChange: (n: number) => void
}

function roiColour(roi: number | null): string {
  if (roi === null) return 'text-muted-foreground'
  if (roi >= 20)   return 'text-green-400'
  if (roi >= 0)    return 'text-amber-400'
  return 'text-red-400'
}

function roiRowBg(roi: number | null): string {
  if (roi === null) return ''
  if (roi >= 20)   return 'bg-green-500/3'
  if (roi >= 0)    return 'bg-amber-500/3'
  return 'bg-red-500/3'
}

function RoiIcon({ roi }: { roi: number | null }) {
  if (roi === null) return <Minus className="h-3 w-3 text-muted-foreground/40" />
  if (roi >= 0)     return <TrendingUp   className="h-3 w-3 text-green-400" />
  return               <TrendingDown className="h-3 w-3 text-red-400" />
}

export function CostBreakdownTable({ cards, totalSpend, onSpendChange }: CostBreakdownTableProps) {
  const readyCards = useMemo(() => cards.filter(c => c.status === 'ready'), [cards])
  const pricedCards = useMemo(() => readyCards.filter(c => (c.ebay_avg_sold ?? 0) > 0), [readyCards])

  const totalMarketValue = useMemo(
    () => pricedCards.reduce((s, c) => s + (c.ebay_avg_sold ?? 0), 0),
    [pricedCards],
  )

  const totalProfitPotential = useMemo(
    () => readyCards.reduce((s, c) => s + (c.profit_potential ?? 0), 0),
    [readyCards],
  )

  const pricedCount   = pricedCards.length
  const unpricedCount = readyCards.length - pricedCount

  return (
    <div className="space-y-5">

      {/* ── Spend input ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <label className="block text-sm font-semibold text-foreground mb-1">
          Total spend
        </label>
        <p className="text-xs text-muted-foreground mb-3">
          What did you pay for all {readyCards.length} cards? We'll split it proportionally by eBay market value.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={totalSpend || ''}
              onChange={e => onSpendChange(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              className={cn(
                'w-full rounded-lg border border-border bg-secondary pl-7 pr-3 py-2.5',
                'text-lg font-semibold text-foreground tabular-nums',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
                'placeholder:text-muted-foreground/40',
              )}
            />
          </div>
          {totalSpend > 0 && totalMarketValue > 0 && (
            <div className="text-xs text-muted-foreground">
              vs{' '}
              <span className="text-foreground font-medium">{formatGBP(totalMarketValue)}</span>
              {' '}market value
            </div>
          )}
        </div>
      </div>

      {/* ── Summary bar ───────────────────────────────────────────────── */}
      {totalSpend > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: 'Total invested',
              value: formatGBP(totalSpend),
              colour: 'text-foreground',
            },
            {
              label: 'Market value',
              value: formatGBP(totalMarketValue),
              colour: 'text-foreground',
            },
            {
              label: 'Profit potential',
              value: formatGBP(totalProfitPotential),
              colour: totalProfitPotential >= 0 ? 'text-green-400' : 'text-red-400',
            },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                {s.label}
              </p>
              <p className={cn('text-xl font-bold tabular-nums', s.colour)}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Unpriced warning */}
      {unpricedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-400">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {unpricedCount} card{unpricedCount !== 1 ? 's' : ''} without eBay prices{' '}
          — excluded from cost allocation. Their proportional cost will show as £0.
        </div>
      )}

      {/* ── Per-card breakdown table ───────────────────────────────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label="Cost breakdown">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Card</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">eBay avg</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Weight</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Your cost</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Profit</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">ROI</th>
              </tr>
            </thead>
            <tbody>
              {readyCards.map(card => {
                const name      = card.overrides.card_name   ?? card.card_name
                const setCode   = card.overrides.set_code    ?? card.set_code
                const weight    = totalMarketValue > 0 && card.ebay_avg_sold
                  ? (card.ebay_avg_sold / totalMarketValue) * 100
                  : null

                return (
                  <tr
                    key={card.uid}
                    className={cn(
                      'border-b border-border last:border-0 transition-colors',
                      roiRowBg(card.roi_pct),
                    )}
                  >
                    <td className="px-4 py-2.5 max-w-[200px]">
                      <div className="font-medium text-foreground truncate">{name || '—'}</div>
                      {setCode && (
                        <div className="text-muted-foreground/60 font-mono text-[10px]">{setCode}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      {card.ebay_avg_sold ? formatGBP(card.ebay_avg_sold) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {weight !== null ? `${weight.toFixed(1)}%` : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">
                      {card.proportional_cost !== null
                        ? formatGBP(card.proportional_cost)
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums font-medium', roiColour(card.roi_pct))}>
                      {card.profit_potential !== null
                        ? formatGBP(card.profit_potential)
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className={cn('flex items-center justify-end gap-1', roiColour(card.roi_pct))}>
                        <RoiIcon roi={card.roi_pct} />
                        <span className="tabular-nums font-semibold">
                          {card.roi_pct !== null ? `${card.roi_pct > 0 ? '+' : ''}${card.roi_pct.toFixed(0)}%` : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totals */}
            {totalSpend > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-secondary/30 font-semibold text-xs">
                  <td className="px-4 py-2.5 text-muted-foreground">{readyCards.length} cards</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatGBP(totalMarketValue)}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">100%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatGBP(totalSpend)}</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', totalProfitPotential >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {formatGBP(totalProfitPotential)}
                  </td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
