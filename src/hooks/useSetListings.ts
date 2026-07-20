'use client'
// =============================================================================
// useSetListings — TanStack Query hooks for multi-variation "Complete Your Set"
// eBay listings.
//
// Cache invalidation strategy:
//   Every mutation here can change BOTH the set listing record and the
//   underlying cards (status, qty, listing_type). So each onSuccess invalidates:
//     ['ebay', 'set-listings']  — this panel
//     ['cards']                 — stock table badges + quantities
//     ['ebay', 'listings']      — the singles tab shares the GetMyeBaySelling call
//     ['dashboard']             — listed counts / inventory value
// =============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EbaySetListing } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VariationDiscrepancy {
  sku:         string   // card.id
  displayName: string
  ebayQty:     number
  dbQty:       number
  /** ebayQty - dbQty. Negative means eBay sold units our DB doesn't know about. */
  discrepancy: number
}

export interface SyncResult {
  synced_at:     string
  discrepancies: VariationDiscrepancy[]
  in_sync:       boolean
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchSetListings(): Promise<EbaySetListing[]> {
  const res = await fetch('/api/ebay/set-listings')
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to load set listings')
  }
  return res.json() as Promise<EbaySetListing[]>
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useSetListings() {
  return useQuery({
    queryKey:        ['ebay', 'set-listings'],
    queryFn:         fetchSetListings,
    staleTime:       60_000,
    placeholderData: (prev) => prev,
  })
}

// ── Shared invalidation ───────────────────────────────────────────────────────

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['ebay', 'set-listings'] })
    void qc.invalidateQueries({ queryKey: ['cards'] })
    void qc.invalidateQueries({ queryKey: ['ebay', 'listings'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Compare eBay quantities against DB quantities for one set listing.
 *
 * Read-only on both sides — returns discrepancies for the user to resolve.
 * Does NOT invalidate cards, since nothing changed; only refreshes the set
 * listing record (last_synced_at was bumped server-side).
 */
export function useSyncSetListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (setListingId: string): Promise<SyncResult> => {
      const res = await fetch(`/api/ebay/set-listings/${setListingId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'sync' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Sync failed')
      }
      return res.json() as Promise<SyncResult>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ebay', 'set-listings'] })
    },
  })
}

/** Add more cards as new variations on an existing set listing. */
export function useAddCardsToSetListing() {
  const invalidateAll = useInvalidateAll()
  return useMutation({
    mutationFn: async (
      { setListingId, cardIds }: { setListingId: string; cardIds: string[] },
    ): Promise<{ added: number; variation_count: number }> => {
      const res = await fetch(`/api/ebay/set-listings/${setListingId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'add_cards', card_ids: cardIds }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to add cards')
      }
      return res.json() as Promise<{ added: number; variation_count: number }>
    },
    onSuccess: invalidateAll,
  })
}

/**
 * End a set listing on eBay and return every variation card to In Stock.
 *
 * Owner-only server-side. Destructive — the UI must confirm before calling.
 */
export function useEndSetListing() {
  const invalidateAll = useInvalidateAll()
  return useMutation({
    mutationFn: async (setListingId: string): Promise<void> => {
      const res = await fetch(`/api/ebay/set-listings/${setListingId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to end set listing')
      }
    },
    onSuccess: invalidateAll,
  })
}

/**
 * Resolve quantity discrepancies by accepting eBay's quantities as truth.
 *
 * Used when eBay shows fewer units than the DB — i.e. cards sold on eBay that
 * CardVault didn't record. Sends one request; the server applies all updates
 * without re-triggering the per-card variation qty push.
 *
 * NOTE: this corrects INVENTORY only. It does NOT create sale records, so the
 * revenue and profit for those units stay missing from Reports until a sale is
 * recorded on the Sales page. The UI must say so before the user confirms.
 */
export function useAcceptEbayQuantities() {
  const invalidateAll = useInvalidateAll()
  return useMutation({
    mutationFn: async (
      { setListingId, updates }: {
        setListingId: string
        updates:      Array<{ card_id: string; qty: number }>
      },
    ): Promise<{ applied: number; sold_out: number }> => {
      const res = await fetch(`/api/ebay/set-listings/${setListingId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'accept_ebay_quantities', updates }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to apply quantities')
      }
      return res.json() as Promise<{ applied: number; sold_out: number }>
    },
    onSuccess: invalidateAll,
  })
}
