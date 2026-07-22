'use client'
// =============================================================================
// BulkPriceModal — set listed_price across the selected cards.
//
// Three modes, matching PricingStrategy in lib/pricing.ts exactly:
//
//   market — % applied to the eBay median (negative undercuts)
//   markup — % over what you paid
//   fixed  — flat £ per card
//
// The preview calls the same derivePrice() the server will use, so what is
// shown here is what gets written. No parallel implementation.
// =============================================================================
import { useState }      from 'react'
import { X, TrendingUp, Coins, Tag } from 'lucide-react'
import { cn, formatGBP } from '@/lib/utils'
import { derivePrice, describeStrategy, type PricingStrategy } from '@/lib/pricing'
import type { Card }     from '@/types'

type PriceMode = 'fixed' | 'markup' | 'market'

interface BulkPriceModalProps {
  open:       boolean
  onClose:    () => void
  cards:      Card[]           // the currently selected cards (for preview)
  onApply:    (mode: PriceMode, value: number) => void
  isPending:  boolean
  /** Org default markup, used as the fallback when a card has no eBay data */
  orgMarkup?: number
}

const MODES: Array<{ id: PriceMode; label: string; icon: React.ReactNode; hint: string }> = [
  { id: 'market', label: 'vs eBay price', icon: <TrendingUp className="h-3.5 w-3.5" />, hint: '% of the going rate' },
  { id: 'markup', label: 'Over cost',     icon: <Coins className="h-3.5 w-3.5" />,     hint: '% margin on what you paid' },
  { id: 'fixed',  label: 'Flat price',    icon: <Tag className="h-3.5 w-3.5" />,       hint: 'same £ for every card' },
]

export function BulkPriceModal({
  open, onClose, cards, onApply, isPending, orgMarkup = 40,
}: BulkPriceModalProps) {
  const [mode,       setMode]       = useState<PriceMode>('market')
  const [fixedValue, setFixedValue] = useState('')
  const [pctValue,   setPctValue]   = useState('0')

  if (!open) return null

  const pctNum   = parseFloat(pctValue)   || 0
  const fixedNum = parseFloat(fixedValue) || 0

  const strategy: PricingStrategy =
    mode === 'fixed'  ? { mode: 'fixed',  price: fixedNum } :
    mode === 'market' ? { mode: 'market', adjustmentPct: pctNum } :
                        { mode: 'cost',   markupPct: pctNum }

  // ── Preview — same function the server runs ───────────────────────────────
  const previews = cards.map(c => ({
    card:   c,
    result: derivePrice(
      { purchase_price: c.purchase_price, ebay_avg_sold: c.ebay_avg_sold },
      strategy,
      orgMarkup,
    ),
  }))

  const priceable   = previews.filter(p => p.result.price != null)
  const unpriceable = previews.length - priceable.length
  const totalValue  = priceable.reduce((s, p) => s + (p.result.price ?? 0), 0)
  const fromCost    = priceable.filter(p => p.result.basis === 'cost' && mode === 'market').length

  const isValid =
    mode === 'fixed' ? fixedNum > 0 :
    mode === 'market' ? pctNum >= -50 && pctNum <= 200 :
                        pctNum >= 0 && pctNum <= 500

  const canApply = !isPending && isValid && priceable.length > 0

  function handleApply() {
    if (!canApply) return
    onApply(mode, mode === 'fixed' ? fixedNum : pctNum)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-base">Set price</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cards.length} card{cards.length !== 1 ? 's' : ''} selected
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Mode picker */}
          <div className="grid grid-cols-3 gap-2">
            {MODES.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id)
                  if (m.id === 'market') setPctValue('0')
                  if (m.id === 'markup') setPctValue(String(orgMarkup))
                }}
                aria-pressed={mode === m.id}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 transition-colors text-center',
                  mode === m.id
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {m.icon}
                <span className="text-xs font-medium">{m.label}</span>
              </button>
            ))}
          </div>

          {/* Value input */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              {mode === 'fixed' ? 'Price per card' : 'Percentage'}
            </label>
            <div className="relative flex items-center">
              {mode === 'fixed' && (
                <span className="absolute left-3 text-muted-foreground text-sm">£</span>
              )}
              <input
                type="number"
                step={mode === 'fixed' ? '0.01' : '1'}
                min={mode === 'fixed' ? '0.01' : mode === 'market' ? '-50' : '0'}
                max={mode === 'fixed' ? '999999' : mode === 'market' ? '200' : '500'}
                value={mode === 'fixed' ? fixedValue : pctValue}
                onChange={e => mode === 'fixed' ? setFixedValue(e.target.value) : setPctValue(e.target.value)}
                placeholder={mode === 'fixed' ? '0.00' : '0'}
                autoFocus
                className={cn(
                  'w-full rounded-lg border border-border bg-secondary py-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-primary',
                  mode === 'fixed' ? 'pl-7 pr-3' : 'px-3 pr-8',
                )}
              />
              {mode !== 'fixed' && (
                <span className="absolute right-3 text-muted-foreground text-sm">%</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{describeStrategy(strategy)}</p>
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border bg-secondary/40 overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <span>Card</span>
              <span className="text-right">eBay avg</span>
              <span className="text-right">New price</span>
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-border/50">
              {previews.slice(0, 60).map(({ card, result }) => (
                <div key={card.id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5 text-xs items-center">
                  <span className="text-foreground truncate">{card.card_name}</span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {card.ebay_avg_sold ? formatGBP(card.ebay_avg_sold) : '—'}
                  </span>
                  <span className="text-right tabular-nums font-medium">
                    {result.price != null ? (
                      <span className={result.basis === 'cost' && mode === 'market' ? 'text-amber-400' : 'text-foreground'}>
                        {formatGBP(result.price)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {previews.length > 60 && (
              <div className="px-3 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
                Showing 60 of {previews.length}
              </div>
            )}
          </div>

          {/* Explanations */}
          {fromCost > 0 && (
            <p className="text-[11px] text-amber-400/90 leading-relaxed">
              {fromCost} card{fromCost !== 1 ? 's have' : ' has'} no eBay comparables, so
              {fromCost !== 1 ? ' they fall' : ' it falls'} back to {orgMarkup}% over cost
              (your default markup, shown in amber).
            </p>
          )}
          {unpriceable > 0 && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {unpriceable} card{unpriceable !== 1 ? 's' : ''} can&apos;t be priced — no cost
              and no eBay data to work from. {unpriceable !== 1 ? 'They' : 'It'} will be left unchanged.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          <div className="text-xs text-muted-foreground">
            Total <span className="font-semibold text-foreground tabular-nums">{formatGBP(totalValue)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!canApply}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Applying…' : `Price ${priceable.length} card${priceable.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
