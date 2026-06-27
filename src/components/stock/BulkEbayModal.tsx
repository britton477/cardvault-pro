'use client'
// =============================================================================
// BulkEbayModal — confirmation + progress + results for bulk eBay listing.
//
// Flow:
//   IDLE     — shows ready/skipped counts, eBay connection warning if needed
//   LISTING  — shows progress bar (X / total cards processed)
//   DONE     — shows success count, failed list with errors, skipped count
//
// The parent passes selectedCards (visible page) so we can compute who has a
// listed_price set before even hitting the server.
// =============================================================================
import { useState, useEffect } from 'react'
import { X, CheckCircle2, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import { cn }                        from '@/lib/utils'
import type { Card }                 from '@/types'
import type { BulkEbayListResult }   from '@/hooks/useEbayListings'

type Phase = 'idle' | 'listing' | 'done'

interface Props {
  open:          boolean
  onClose:       () => void
  selectedCards: Card[]
  totalCount:    number          // total selected (may include off-page)
  onConfirm:     (ids: string[]) => Promise<BulkEbayListResult>
  isPending:     boolean
}

export function BulkEbayModal({
  open, onClose, selectedCards, totalCount, onConfirm, isPending,
}: Props) {
  const [phase,      setPhase]      = useState<Phase>('idle')
  const [result,     setResult]     = useState<BulkEbayListResult | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  // Split visible selection into ready / no-price for preview
  const ready   = selectedCards.filter(c => !!c.listed_price && c.status !== 'Sold')
  const noPrice = selectedCards.filter(c => !c.listed_price  && c.status !== 'Sold')
  const offPage = Math.max(0, totalCount - selectedCards.length)

  // Reset when modal opens
  useEffect(() => {
    if (open) { setPhase('idle'); setResult(null); setIsRetrying(false) }
  }, [open])

  if (!open) return null

  async function runListing(ids: string[], prevResult: BulkEbayListResult | null = null) {
    setPhase('listing')
    try {
      const res = await onConfirm(ids)
      // Merge with any previous attempt so the totals accumulate correctly
      if (prevResult) {
        setResult({
          succeeded:          [...prevResult.succeeded, ...res.succeeded],
          failed:             res.failed,    // only what still failed after this attempt
          skipped:            [...prevResult.skipped, ...res.skipped],
          ebay_not_connected: res.ebay_not_connected,
        })
      } else {
        setResult(res)
      }
      setPhase('done')
    } catch {
      setPhase(isRetrying ? 'done' : 'idle')
    } finally {
      setIsRetrying(false)
    }
  }

  function handleConfirm() {
    const ids = selectedCards
      .filter(c => !!c.listed_price && c.status !== 'Sold')
      .map(c => c.id)
    void runListing(ids)
  }

  function handleRetry() {
    if (!result?.failed.length) return
    setIsRetrying(true)
    const retryIds = result.failed.map(f => f.card_id)
    void runListing(retryIds, result)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase === 'listing' ? undefined : onClose}
      />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">List on eBay</h2>
          {phase !== 'listing' && (
            <button
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* ── IDLE phase ─────────────────────────────────────────────────────── */}
          {phase === 'idle' && (
            <>
              {/* eBay not connected warning */}
              {result?.ebay_not_connected && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>eBay is not connected. Go to <strong>Settings → eBay</strong> to connect your account.</span>
                </div>
              )}

              {/* Ready to list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2">
                  <span className="text-sm text-foreground">Ready to list</span>
                  <span className="text-sm font-semibold text-emerald-400">{ready.length} card{ready.length !== 1 ? 's' : ''}</span>
                </div>

                {noPrice.length > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                    <div>
                      <span className="text-sm text-amber-400">No price set</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Use Set Price first, then retry</p>
                    </div>
                    <span className="text-sm font-semibold text-amber-400">{noPrice.length}</span>
                  </div>
                )}

                {offPage > 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    +{offPage} card{offPage !== 1 ? 's' : ''} not on this page will also be processed
                  </p>
                )}
              </div>

              {ready.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No cards with a price set. Use <strong>Set Price</strong> on your selection first.
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleConfirm() }}
                  disabled={ready.length === 0 || isPending}
                  className={cn(
                    'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    ready.length > 0 && !isPending
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-secondary text-muted-foreground cursor-not-allowed',
                  )}
                >
                  List {ready.length > 0 ? `${ready.length} ` : ''}on eBay
                </button>
              </div>
            </>
          )}

          {/* ── LISTING phase ──────────────────────────────────────────────────── */}
          {phase === 'listing' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {isRetrying ? 'Retrying failed listings…' : 'Listing cards on eBay…'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Processing one at a time to respect eBay&apos;s rate limits
                </p>
              </div>
            </div>
          )}

          {/* ── DONE phase ─────────────────────────────────────────────────────── */}
          {phase === 'done' && result && (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-emerald-400">{result.succeeded.length}</p>
                  <p className="text-xs text-muted-foreground">Listed</p>
                </div>
                <div className={cn(
                  'rounded-lg px-3 py-2 text-center',
                  result.failed.length > 0
                    ? 'bg-destructive/10 border border-destructive/30'
                    : 'bg-secondary',
                )}>
                  <p className={cn('text-lg font-bold', result.failed.length > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                    {result.failed.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
                <div className="rounded-lg bg-secondary px-3 py-2 text-center">
                  <p className="text-lg font-bold text-muted-foreground">{result.skipped.length}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              </div>

              {/* Failed detail */}
              {result.failed.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 divide-y divide-border max-h-40 overflow-y-auto">
                  {result.failed.map(f => (
                    <div key={f.card_id} className="px-3 py-2">
                      <p className="text-xs font-medium text-foreground truncate">{f.card_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.error}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Skipped detail */}
              {result.skipped.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground transition-colors">
                    {result.skipped.length} card{result.skipped.length !== 1 ? 's' : ''} skipped — details
                  </summary>
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {result.skipped.map(s => (
                      <div key={s.card_id} className="flex gap-2">
                        <span className="truncate flex-1">{s.card_name}</span>
                        <span className="text-muted-foreground/60 flex-shrink-0">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {result.succeeded.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                  <span>Cards updated to <strong>Listed</strong> status in your stock</span>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={onClose}
                  className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors"
                >
                  Close
                </button>

                {result.failed.length > 0 && (
                  <button
                    onClick={handleRetry}
                    disabled={isPending}
                    className="flex items-center gap-1.5 rounded-md border border-amber-500/40 text-amber-400 px-3 py-2 text-sm hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                  >
                    Retry {result.failed.length} failed
                  </button>
                )}

                {result.succeeded.length > 0 && (
                  <a
                    href="/ebay-listings"
                    onClick={onClose}
                    className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors ml-auto"
                  >
                    View Listings
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
