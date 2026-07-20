'use client'
// =============================================================================
// SetListingSlideOver — manage one multi-variation "Complete Your Set" listing.
//
// Panels:
//   Variations   — every card in the listing with its qty and price
//   Sync         — compare eBay quantities against the DB, resolve discrepancies
//   Danger zone  — end the listing and return all cards to stock
//
// Discrepancy semantics (this is the important bit):
//   discrepancy = ebayQty - dbQty
//     negative → eBay has FEWER than we think. Units sold on eBay that CardVault
//                never recorded. Resolve with "Accept eBay" to correct stock.
//     positive → eBay has MORE than we think. Usually means a DB qty edit never
//                reached eBay. Resolve with "Push to eBay" to re-assert our number.
// =============================================================================
import { useState } from 'react'
import {
  X, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, Layers,
  ArrowDownCircle, Loader2, Trash2,
} from 'lucide-react'
import { cn, formatGBP } from '@/lib/utils'
import {
  useSyncSetListing, useEndSetListing, useAcceptEbayQuantities,
  type VariationDiscrepancy,
} from '@/hooks/useSetListings'
import { useToast } from '@/components/ui/Toast'
import type { EbaySetListing } from '@/types'

interface Props {
  setListing: EbaySetListing | null
  onClose:    () => void
}

export function SetListingSlideOver({ setListing, onClose }: Props) {
  const { toast }   = useToast()
  const sync        = useSyncSetListing()
  const endListing  = useEndSetListing()
  const acceptEbay  = useAcceptEbayQuantities()

  const [discrepancies, setDiscrepancies] = useState<VariationDiscrepancy[] | null>(null)
  const [lastSyncOk,    setLastSyncOk]    = useState(false)
  const [confirmEnd,    setConfirmEnd]    = useState(false)

  if (!setListing) return null

  const variations = setListing.variations ?? []
  const totalQty   = variations.reduce((sum, v) => sum + (v.qty ?? 0), 0)
  const totalValue = variations.reduce((sum, v) => sum + ((v.listed_price ?? 0) * (v.qty ?? 0)), 0)

  // Units eBay says sold that we never recorded
  const soldNotRecorded = (discrepancies ?? [])
    .filter(d => d.discrepancy < 0)
    .reduce((sum, d) => sum + Math.abs(d.discrepancy), 0)

  async function handleSync() {
    setDiscrepancies(null)
    setLastSyncOk(false)
    try {
      const result = await sync.mutateAsync(setListing!.id)
      setDiscrepancies(result.discrepancies)
      setLastSyncOk(result.in_sync)
      if (result.in_sync) {
        toast.success('In sync', 'eBay quantities match your stock.')
      } else {
        toast.info(
          `${result.discrepancies.length} discrepanc${result.discrepancies.length !== 1 ? 'ies' : 'y'} found`,
          'Review below to resolve.',
        )
      }
    } catch (err) {
      toast.error('Sync failed', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleAcceptEbay() {
    if (!discrepancies?.length) return
    try {
      const { applied, sold_out } = await acceptEbay.mutateAsync({
        setListingId: setListing!.id,
        updates: discrepancies.map(d => ({ card_id: d.sku, qty: d.ebayQty })),
      })
      setDiscrepancies(null)
      setLastSyncOk(true)
      toast.success(
        `${applied} quantit${applied !== 1 ? 'ies' : 'y'} updated`,
        sold_out > 0 ? `${sold_out} card${sold_out !== 1 ? 's' : ''} marked Sold. Record the sales to capture revenue.` : undefined,
      )
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleEnd() {
    try {
      await endListing.mutateAsync(setListing!.id)
      toast.success('Listing ended', 'All cards returned to In Stock.')
      onClose()
    } catch (err) {
      toast.error('Failed to end listing', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border shrink-0">
          <Layers className="h-5 w-5 text-teal-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm leading-snug">{setListing.title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {[setListing.set_code, setListing.condition].filter(Boolean).join(' · ')}
              {' · '}{variations.length} variation{variations.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── Summary stats ────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cards</p>
              <p className="text-lg font-semibold tabular-nums mt-0.5">{variations.length}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total qty</p>
              <p className="text-lg font-semibold tabular-nums mt-0.5">{totalQty}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Value</p>
              <p className="text-lg font-semibold tabular-nums mt-0.5">{formatGBP(totalValue)}</p>
            </div>
          </div>

          {/* ── Failed push banner ───────────────────────────────────────── */}
          {setListing.status === 'sync_pending' && (
            <div className="mx-5 mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-red-400">
                    eBay is out of date
                  </p>
                  <p className="text-[11px] text-red-400/80 mt-0.5 leading-relaxed">
                    A quantity update could not be sent to eBay, so this listing may be
                    advertising stock you no longer hold. Run a check below to see the
                    difference and resolve it.
                  </p>
                  {setListing.sync_error && (
                    <p className="text-[10px] text-red-400/60 mt-1 font-mono break-words">
                      {setListing.sync_error}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Sync ─────────────────────────────────────────────────────── */}
          <div className="px-5 py-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Quantity sync</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {setListing.last_synced_at
                    ? `Last checked ${new Date(setListing.last_synced_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
                    : 'Never checked'}
                </p>
              </div>
              <button
                onClick={() => void handleSync()}
                disabled={sync.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary transition-colors disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
                {sync.isPending ? 'Checking…' : 'Check eBay'}
              </button>
            </div>

            {/* In-sync confirmation */}
            {lastSyncOk && (
              <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2 text-xs text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                eBay quantities match your stock.
              </div>
            )}

            {/* Discrepancy list */}
            {discrepancies && discrepancies.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {discrepancies.length} card{discrepancies.length !== 1 ? 's' : ''} out of sync.
                    {soldNotRecorded > 0 && (
                      <> eBay shows <strong>{soldNotRecorded} fewer unit{soldNotRecorded !== 1 ? 's' : ''}</strong> than your stock — those likely sold without being recorded.</>
                    )}
                  </span>
                </div>

                <div className="rounded-lg border border-border divide-y divide-border">
                  {discrepancies.map(d => (
                    <div key={d.sku} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="font-medium truncate min-w-0 mr-3">{d.displayName}</span>
                      <span className="flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="text-muted-foreground">DB {d.dbQty}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground font-medium">eBay {d.ebayQty}</span>
                        <span className={cn(
                          'font-semibold',
                          d.discrepancy < 0 ? 'text-red-400' : 'text-blue-400',
                        )}>
                          {d.discrepancy > 0 ? '+' : ''}{d.discrepancy}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                {/* Resolution */}
                <button
                  onClick={() => void handleAcceptEbay()}
                  disabled={acceptEbay.isPending}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary/15 border border-primary/30 text-primary px-3 py-2 text-xs font-medium hover:bg-primary/25 transition-colors disabled:opacity-50"
                >
                  {acceptEbay.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ArrowDownCircle className="h-3.5 w-3.5" />
                  }
                  {acceptEbay.isPending ? 'Applying…' : 'Accept eBay quantities'}
                </button>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  This corrects your stock levels only — it does not create sale records.
                  Any units that sold will still need recording on the Sales page to
                  appear in revenue and profit reports.
                </p>
              </div>
            )}
          </div>

          {/* ── Variations list ──────────────────────────────────────────── */}
          <div className="px-5 py-4 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Variations
            </p>
            <div className="rounded-lg border border-border divide-y divide-border">
              {variations.length === 0 ? (
                <p className="px-3 py-6 text-xs text-muted-foreground text-center">
                  No variation cards linked to this listing.
                </p>
              ) : variations.map(v => (
                <div key={v.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="min-w-0 mr-3">
                    <span className="font-medium truncate block">{v.card_name}</span>
                    {v.card_number && (
                      <span className="text-xs text-muted-foreground">#{v.card_number}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 tabular-nums text-xs">
                    <span className={cn(
                      'rounded px-1.5 py-0.5 font-medium',
                      (v.qty ?? 0) === 0
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-secondary text-muted-foreground',
                    )}>
                      ×{v.qty ?? 0}
                    </span>
                    <span className="font-medium w-14 text-right">
                      {v.listed_price != null ? formatGBP(v.listed_price) : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Danger zone ──────────────────────────────────────────────── */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Danger zone
            </p>
            {!confirmEnd ? (
              <button
                onClick={() => setConfirmEnd(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-destructive/40 text-destructive px-3 py-2 text-xs font-medium hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                End listing on eBay
              </button>
            ) : (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 space-y-2.5">
                <p className="text-xs text-destructive">
                  This ends the eBay listing and returns all {variations.length} card
                  {variations.length !== 1 ? 's' : ''} to In Stock. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleEnd()}
                    disabled={endListing.isPending}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium hover:bg-destructive/80 transition-colors disabled:opacity-50"
                  >
                    {endListing.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    {endListing.isPending ? 'Ending…' : 'Yes, end listing'}
                  </button>
                  <button
                    onClick={() => setConfirmEnd(false)}
                    className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — eBay link */}
        {setListing.ebay_url && (
          <div className="px-5 py-3 border-t border-border shrink-0">
            <a
              href={setListing.ebay_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              View listing on eBay
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </aside>
    </>
  )
}
