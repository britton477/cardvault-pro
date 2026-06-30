'use client'
// =============================================================================
// EbayListModal — single-card eBay listing flow.
//
// Flow:
//   1. User sets price → sees fee breakdown (you receive / buyer pays)
//   2. Preview auto-generated title + description (editable)
//   3. Confirm → POST /api/ebay/list → success / error
//
// eBay UK Buyer Protection fee ≈ 5.26% on top of item price (approximate).
// The "buyer pays" figure is shown for reference — actual fee varies.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { X, ExternalLink, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertTriangle, Truck } from 'lucide-react'
import { cn }           from '@/lib/utils'
import { formatGBP }    from '@/lib/utils'
import type { Card }    from '@/types'
import { buildListingTitle, buildListingDescription } from '@/lib/ebay-client'

// ── eBay Buyer Protection fee (UK, from 17 July 2025) ────────────────────────
// Tiered structure added ON TOP of the item price — seller receives 100%.
//   7% on first £20
//   4% on £20–£300
//   2% on £300–£4,000
//   £0.10 flat per item
// https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees

function calcBuyerProtectionFee(price: number): number {
  if (price <= 0) return 0
  let fee = 0.10 // flat per item
  if (price <= 20) {
    fee += price * 0.07
  } else if (price <= 300) {
    fee += 20 * 0.07 + (price - 20) * 0.04
  } else if (price <= 4000) {
    fee += 20 * 0.07 + 280 * 0.04 + (price - 300) * 0.02
  } else {
    fee += 20 * 0.07 + 280 * 0.04 + 3700 * 0.02
  }
  return Math.round(fee * 100) / 100
}

function effectiveBpfRate(price: number): string {
  if (price <= 0) return '7%'
  const fee = calcBuyerProtectionFee(price) - 0.10
  const pct  = (fee / price) * 100
  return `${pct.toFixed(1)}%`
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open:    boolean
  onClose: () => void
  card:    Card | null
  onSuccess?: (cardId: string, listingId: string) => void
  shopName?: string
}

type Phase = 'price' | 'preview' | 'listing' | 'done' | 'error'

// ── Component ─────────────────────────────────────────────────────────────────

export function EbayListModal({ open, onClose, card, onSuccess, shopName = 'VaultHunters TCG' }: Props) {
  const [phase,       setPhase]       = useState<Phase>('price')
  const [priceInput,  setPriceInput]  = useState('')
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [showDesc,    setShowDesc]    = useState(false)
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null)
  const [listingId,   setListingId]   = useState<string | null>(null)
  const priceRef = useRef<HTMLInputElement>(null)

  // Initialise when card or modal opens
  useEffect(() => {
    if (!open || !card) return
    setPhase('price')
    setErrorMsg(null)
    setListingId(null)
    setShowDesc(false)

    // Pre-fill price from card's existing listed_price or market price
    const initPrice = card.listed_price ?? card.market_price ?? ''
    setPriceInput(initPrice ? String(initPrice) : '')

    // Generate title + description immediately so preview is ready
    const cardData = {
      card_name:   card.card_name,
      set_code:    card.set_code,
      card_number: card.card_number ?? null,
      condition:   card.condition,
      foil_type:   card.foil_type ?? null,
      is_graded:   card.is_graded ?? false,
      grader:      card.grader    ?? null,
      grade:       card.grade     ?? null,
      notes:       card.notes     ?? null,
    }
    const price = Number(initPrice) || 0
    setTitle(buildListingTitle(cardData))
    setDescription(buildListingDescription(cardData, price, shopName))

    setTimeout(() => priceRef.current?.focus(), 100)
  }, [open, card, shopName])

  // Regenerate description when price changes (postage tier can change)
  useEffect(() => {
    if (!card) return
    const price = Number(priceInput) || 0
    const cardData = {
      card_name:   card.card_name,
      set_code:    card.set_code,
      card_number: card.card_number ?? null,
      condition:   card.condition,
      foil_type:   card.foil_type ?? null,
      is_graded:   card.is_graded ?? false,
      grader:      card.grader    ?? null,
      grade:       card.grade     ?? null,
      notes:       card.notes     ?? null,
    }
    setDescription(buildListingDescription(cardData, price, shopName))
  }, [priceInput, card, shopName])

  if (!open || !card) return null

  const price       = Number(priceInput) || 0
  const bpFee       = calcBuyerProtectionFee(price)
  const buyerPays   = Math.round((price + bpFee) * 100) / 100
  const isHighValue = price >= 20
  const priceValid  = price > 0
  const hasNoPhotos = Array.isArray(card.photos) && card.photos.length === 0

  async function handleList() {
    if (!priceValid) return
    setPhase('listing')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/ebay/list', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ listings: [{ card_id: card!.id, list_price: price }] }),
      })

      const json = await res.json() as { results?: Array<{ success: boolean; listing_id?: string; error?: string }> }
      const result = json.results?.[0]

      if (!res.ok || !result?.success) {
        throw new Error(result?.error ?? 'Listing failed')
      }

      setListingId(result.listing_id ?? null)
      setPhase('done')
      onSuccess?.(card!.id, result.listing_id ?? '')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase === 'listing' ? undefined : onClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">List on eBay</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
              {card.card_name} · {card.set_code}{card.card_number ? ` ${card.card_number}` : ''} · {card.condition}
            </p>
          </div>
          {phase !== 'listing' && (
            <button
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">

          {/* ── PRICE phase ──────────────────────────────────────────────────── */}
          {(phase === 'price' || phase === 'preview') && (
            <>
              {/* Price input */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Item price (what you charge)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">£</span>
                  <input
                    ref={priceRef}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={priceInput}
                    onChange={e => setPriceInput(e.target.value)}
                    className="w-full pl-8 pr-3 py-2.5 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Fee breakdown */}
              {priceValid && (
                <div className="rounded-lg border border-border bg-secondary/40 divide-y divide-border text-sm">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">You receive (item price)</span>
                    <span className="font-semibold text-foreground">{formatGBP(price)}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">
                      eBay Buyer Protection fee{' '}
                      <span className="text-xs">(~{effectiveBpfRate(price)} + £0.10 flat)</span>
                    </span>
                    <span className="text-muted-foreground">+{formatGBP(bpFee)}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/60 rounded-b-lg">
                    <span className="font-medium text-foreground">Buyer will pay</span>
                    <span className="font-bold text-foreground">{formatGBP(buyerPays)}</span>
                  </div>
                </div>
              )}

              {/* Postage tier indicator */}
              {priceValid && (
                <div className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
                  isHighValue
                    ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                    : 'border-border bg-secondary/40 text-muted-foreground',
                )}>
                  <Truck className="h-4 w-4 flex-shrink-0" />
                  <div>
                    <span className="font-medium">
                      {isHighValue ? 'Royal Mail Tracked 48 (£2.85)' : 'Royal Mail 2nd Class (£1.00)'}
                    </span>
                    <span className="ml-1.5 text-xs opacity-70">
                      {isHighValue ? '£20+ — tracked shipping policy' : 'Under £20 — standard shipping policy'}
                    </span>
                  </div>
                </div>
              )}

              {/* Title preview */}
              {priceValid && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Listing title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={80}
                    className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground text-right">{title.length}/80 chars</p>
                </div>
              )}

              {/* Description toggle */}
              {priceValid && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setShowDesc(v => !v)}
                    className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showDesc ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {showDesc ? 'Hide' : 'Preview / edit'} description
                  </button>
                  {showDesc && (
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={10}
                      className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                    />
                  )}
                </div>
              )}

              {/* No-photo warning */}
              {hasNoPhotos && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-300/90 text-xs leading-snug">
                    This card has no photos. eBay recommends at least one photo. You can still list, but it may affect visibility.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleList() }}
                  disabled={!priceValid}
                  className={cn(
                    'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    priceValid
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-secondary text-muted-foreground cursor-not-allowed',
                  )}
                >
                  List on eBay for {priceValid ? formatGBP(price) : '—'}
                </button>
              </div>
            </>
          )}

          {/* ── LISTING phase ─────────────────────────────────────────────────── */}
          {phase === 'listing' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-sm font-medium">Listing on eBay…</p>
                <p className="text-xs text-muted-foreground mt-1">Creating your listing now</p>
              </div>
            </div>
          )}

          {/* ── DONE phase ────────────────────────────────────────────────────── */}
          {phase === 'done' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Listed successfully!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {card.card_name} is now live on eBay for {formatGBP(price)}
                </p>
              </div>
              <div className="flex gap-2 w-full">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors"
                >
                  Close
                </button>
                {listingId && (
                  <a
                    href={`https://www.ebay.co.uk/itm/${listingId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 flex-1 justify-center rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    View on eBay
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── ERROR phase ───────────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
                <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Listing failed</p>
                  <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setPhase('price')}
                  className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
