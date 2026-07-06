'use client'
// =============================================================================
// EbayListingsView — manage active eBay listings.
//
// Features:
//   - Sync from eBay (GetMyeBaySelling)
//   - Inline price revision with eBay ReviseItem
//   - End listing with confirmation (EndItem + resets card to In Stock)
//   - Enriched with local card data (card name, condition, purchase price)
// =============================================================================
import { useState }                                  from 'react'
import Link                                          from 'next/link'
import { RefreshCw, ExternalLink, Pencil, XCircle, Check, TrendingUp, TrendingDown, AlertTriangle, PlugZap } from 'lucide-react'
import { useEbayListings, useReviseListing, useEndListing } from '@/hooks/useEbayListings'
import { formatGBP, cn } from '@/lib/utils'
import type { EbayActiveListing } from '@/types'

// ── Revise price inline ───────────────────────────────────────────────────────

function ReviseCell({ listing }: { listing: EbayActiveListing }) {
  const revise   = useReviseListing()
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(listing.price.toFixed(2))

  async function save() {
    const price = parseFloat(value)
    if (isNaN(price) || price < 0.01) return
    await revise.mutateAsync({ listingId: listing.listingId, price })
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-sm tabular-nums">{formatGBP(listing.price)}</span>
        <button
          onClick={() => setEditing(true)}
          className="invisible group-hover:visible rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Edit price"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground text-xs">£</span>
      <input
        type="number"
        min="0.01"
        step="0.01"
        value={value}
        onChange={e => setValue(e.target.value)}
        className="w-20 rounded border border-border bg-secondary/40 px-2 py-0.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
        autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter')  void save()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button
        onClick={() => void save()}
        disabled={revise.isPending}
        className="rounded p-0.5 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
        aria-label="Save price"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setEditing(false)}
        className="rounded p-0.5 text-muted-foreground hover:bg-secondary transition-colors"
        aria-label="Cancel"
      >
        <XCircle className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── End listing cell ──────────────────────────────────────────────────────────

function EndListingCell({ listing }: { listing: EbayActiveListing }) {
  const end = useEndListing()
  const [confirm, setConfirm] = useState(false)

  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="invisible group-hover:visible rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 border border-destructive/30 transition-colors"
      >
        End
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-destructive">End listing?</span>
      <button
        onClick={() => end.mutate(listing.listingId)}
        disabled={end.isPending}
        className="rounded px-1.5 py-0.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors disabled:opacity-50"
      >
        {end.isPending ? '…' : 'Yes'}
      </button>
      <button
        onClick={() => setConfirm(false)}
        className="rounded px-1.5 py-0.5 text-xs border border-border text-muted-foreground hover:bg-secondary transition-colors"
      >
        No
      </button>
    </div>
  )
}

// ── Days listed ───────────────────────────────────────────────────────────────

function daysListed(startTime: string): number {
  const start = new Date(startTime).getTime()
  return Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24))
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function EbayListingsSkeleton() {
  return (
    <div className="animate-pulse space-y-2 p-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2 border-b border-border/50">
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-48 rounded bg-secondary/60" />
            <div className="h-3 w-24 rounded bg-secondary/40" />
          </div>
          <div className="h-3.5 w-16 rounded bg-secondary/40" />
          <div className="h-3.5 w-14 rounded bg-secondary/40" />
          <div className="h-5 w-20 rounded-full bg-secondary/60" />
        </div>
      ))}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function EbayListingsView() {
  const { data, isLoading, isError, error, refetch, isFetching } = useEbayListings()

  const listings       = data?.data ?? []
  const isSandbox      = process.env['NEXT_PUBLIC_EBAY_ENV'] !== 'production'
  const isNotConnected = isError && (error as Error)?.message === 'ebay_not_connected'

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">eBay Listings</h1>
            {isSandbox && (
              <span className="inline-flex items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-400 ring-1 ring-violet-500/30">
                SANDBOX
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your active eBay listings — revise prices, end listings.
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching || isNotConnected}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          {isFetching ? 'Syncing…' : 'Sync from eBay'}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <EbayListingsSkeleton />
        ) : isNotConnected ? (
          /* ── eBay not connected ─────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
            <div className="rounded-full bg-primary/10 p-4">
              <PlugZap className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">eBay account not connected</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Connect your eBay seller account to sync listings, revise prices, and end listings directly from CardVault.
              </p>
            </div>
            <Link
              href="/settings?tab=ebay"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlugZap className="h-3.5 w-3.5" />
              Connect eBay in Settings
            </Link>
          </div>
        ) : isError ? (
          /* ── Generic fetch error ────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <AlertTriangle className="h-8 w-8 text-destructive/50" />
            <div>
              <p className="text-sm font-medium">Failed to load listings</p>
              <p className="text-xs text-muted-foreground mt-1">
                {(error as Error)?.message ?? 'An unexpected error occurred.'}
              </p>
            </div>
            <button
              onClick={() => void refetch()}
              className="text-xs text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : listings.length === 0 ? (
          /* ── Connected but no listings ──────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertTriangle className="h-8 w-8 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">No active listings</p>
              <p className="text-xs text-muted-foreground mt-1">
                List cards from your stock to see them here. Click Sync to refresh.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Card</th>
                  <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Listed price</th>
                  <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Margin</th>
                  <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Watchers</th>
                  <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Days listed</th>
                  <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">eBay link</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {listings.map(listing => {
                  const margin = listing.purchase_price != null && listing.purchase_price > 0
                    ? listing.price - listing.purchase_price
                    : null
                  const marginPct = margin != null && listing.purchase_price
                    ? (margin / listing.purchase_price) * 100
                    : null
                  const days = listing.startTime ? daysListed(listing.startTime) : null

                  return (
                    <tr
                      key={listing.listingId}
                      className="border-b border-border/50 hover:bg-secondary/20 transition-colors group"
                    >
                      {/* Card name + set */}
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{listing.card_name}</p>
                        {(listing.set_code || listing.condition) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[listing.set_code, listing.condition].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </td>

                      {/* Listed price — inline edit */}
                      <td className="px-4 py-3">
                        <ReviseCell listing={listing} />
                      </td>

                      {/* Profit margin */}
                      <td className="px-4 py-3">
                        {margin != null ? (
                          <div className="flex items-center gap-1">
                            {margin >= 0
                              ? <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                              : <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                            }
                            <span className={cn(
                              'text-xs tabular-nums font-medium',
                              margin >= 0 ? 'text-green-400' : 'text-red-400',
                            )}>
                              {formatGBP(margin, { showSign: true })}
                              {marginPct != null && (
                                <span className="ml-1 opacity-70">({marginPct.toFixed(0)}%)</span>
                              )}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Watchers */}
                      <td className="px-4 py-3 text-sm tabular-nums text-foreground">
                        {listing.watchCount > 0 ? (
                          <span className={cn(listing.watchCount >= 3 && 'text-amber-400 font-medium')}>
                            {listing.watchCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">0</span>
                        )}
                      </td>

                      {/* Days listed */}
                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                        {days !== null ? `${days}d` : '—'}
                      </td>

                      {/* eBay link */}
                      <td className="px-4 py-3">
                        <a
                          href={listing.listingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          View
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>

                      {/* End listing */}
                      <td className="px-4 py-3 text-right">
                        <EndListingCell listing={listing} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer count */}
      {listings.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {listings.length} active listing{listings.length !== 1 ? 's' : ''} synced from eBay
        </p>
      )}
    </div>
  )
}
