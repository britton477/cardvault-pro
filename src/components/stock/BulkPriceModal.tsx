'use client'
// =============================================================================
// BulkPriceModal — set listed_price across selected cards.
// Two modes: Fixed (£X for all) or Markup (purchase_price × (1 + N%)).
// =============================================================================
import { useState }      from 'react'
import { X }             from 'lucide-react'
import { cn, formatGBP } from '@/lib/utils'
import type { Card }     from '@/types'

type PriceMode = 'fixed' | 'markup'

interface BulkPriceModalProps {
  open:       boolean
  onClose:    () => void
  cards:      Card[]           // the currently selected cards (for markup preview)
  onApply:    (mode: PriceMode, value: number) => void
  isPending:  boolean
}

export function BulkPriceModal({ open, onClose, cards, onApply, isPending }: BulkPriceModalProps) {
  const [mode,       setMode]       = useState<PriceMode>('fixed')
  const [fixedValue, setFixedValue] = useState('')
  const [markupPct,  setMarkupPct]  = useState('30')

  if (!open) return null

  // ── Preview calculations ──────────────────────────────────────────────────

  const avgCost = cards.length === 0
    ? 0
    : cards.reduce((sum, c) => sum + c.purchase_price, 0) / cards.length

  const markupNum    = parseFloat(markupPct) || 0
  const avgListed    = avgCost * (1 + markupNum / 100)
  const fixedNum     = parseFloat(fixedValue) || 0
  const isFixedValid = fixedNum > 0
  const isMarkupValid = markupNum >= 0 && markupNum <= 500

  function handleApply() {
    if (mode === 'fixed' && isFixedValid) {
      onApply('fixed', fixedNum)
    } else if (mode === 'markup' && isMarkupValid) {
      onApply('markup', markupNum)
    }
  }

  const canApply = !isPending && (
    (mode === 'fixed'  && isFixedValid) ||
    (mode === 'markup' && isMarkupValid)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm">
            Set Price — {cards.length} card{cards.length !== 1 ? 's' : ''}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Mode toggle */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {(['fixed', 'markup'] as PriceMode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 py-2 font-medium transition-colors',
                  mode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                )}
              >
                {m === 'fixed' ? 'Fixed Price' : 'Markup %'}
              </button>
            ))}
          </div>

          {/* Fixed price input */}
          {mode === 'fixed' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Listed price for all selected cards
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={fixedValue}
                  onChange={e => setFixedValue(e.target.value)}
                  autoFocus
                  className="w-full pl-7 pr-3 py-2 rounded-md border border-border bg-secondary/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {isFixedValid && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  All {cards.length} cards will be listed at {formatGBP(fixedNum)}
                </p>
              )}
            </div>
          )}

          {/* Markup input */}
          {mode === 'markup' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Markup above purchase price
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="500"
                  step="1"
                  placeholder="30"
                  value={markupPct}
                  onChange={e => setMarkupPct(e.target.value)}
                  autoFocus
                  className="w-full pr-8 pl-3 py-2 rounded-md border border-border bg-secondary/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>

              {/* Preview */}
              {isMarkupValid && avgCost > 0 && (
                <div className="mt-2.5 rounded-md bg-secondary/40 px-3 py-2 text-xs space-y-0.5">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Avg purchase price</span>
                    <span className="tabular-nums">{formatGBP(avgCost)}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Avg listed price at {markupPct}%</span>
                    <span className="tabular-nums text-green-400">{formatGBP(avgListed)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-md border border-border py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!canApply}
              className="flex-1 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? 'Applying…' : `Apply to ${cards.length} card${cards.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
