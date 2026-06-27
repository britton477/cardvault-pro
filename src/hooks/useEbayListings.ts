'use client'
// =============================================================================
// useEbayListings — TanStack Query hooks for active eBay listings.
// useWishlistPriceCheck — mutation to trigger /api/wishlist/price-check.
// =============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EbayActiveListing, WishlistItem }  from '@/types'

// ── Active listings ───────────────────────────────────────────────────────────

async function fetchListings(): Promise<{ data: EbayActiveListing[]; count: number }> {
  const res = await fetch('/api/ebay/listings')
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to load eBay listings')
  }
  return res.json() as Promise<{ data: EbayActiveListing[]; count: number }>
}

async function reviseListing(listingId: string, price: number): Promise<void> {
  const res = await fetch(`/api/ebay/listings/${listingId}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ price }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to revise listing')
  }
}

async function endListing(listingId: string): Promise<void> {
  const res = await fetch(`/api/ebay/listings/${listingId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to end listing')
  }
}

export function useEbayListings() {
  return useQuery({
    queryKey:        ['ebay', 'listings'],
    queryFn:         fetchListings,
    staleTime:       60_000,     // 1 min — eBay data doesn't change every second
    placeholderData: (prev) => prev,
  })
}

export function useReviseListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listingId, price }: { listingId: string; price: number }) =>
      reviseListing(listingId, price),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ebay', 'listings'] })
      void qc.invalidateQueries({ queryKey: ['cards'] })
    },
  })
}

export function useEndListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listingId: string) => endListing(listingId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ebay', 'listings'] })
      void qc.invalidateQueries({ queryKey: ['cards'] })
    },
  })
}

// ── Bulk eBay listing ─────────────────────────────────────────────────────────

export interface BulkEbayListResult {
  succeeded:           Array<{ card_id: string; card_name: string; listing_id: string }>
  failed:              Array<{ card_id: string; card_name: string; error: string      }>
  skipped:             Array<{ card_id: string; card_name: string; reason: string     }>
  ebay_not_connected?: boolean
}

export function useBulkEbayList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (card_ids: string[]): Promise<BulkEbayListResult> => {
      const res = await fetch('/api/ebay/bulk-list', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ card_ids }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Bulk eBay listing failed')
      }
      return res.json() as Promise<BulkEbayListResult>
    },
    onSuccess: () => {
      // Refresh both cards (status changes) and eBay listings panel
      void qc.invalidateQueries({ queryKey: ['cards'] })
      void qc.invalidateQueries({ queryKey: ['ebay', 'listings'] })
    },
  })
}

// ── Wishlist price check ──────────────────────────────────────────────────────

interface PriceCheckResult {
  checked: number
  alerts:  WishlistItem[]
}

export function useWishlistPriceCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<PriceCheckResult> => {
      const res = await fetch('/api/wishlist/price-check')
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Price check failed')
      }
      return res.json() as Promise<PriceCheckResult>
    },
    onSuccess: () => {
      // Refresh wishlist so new prices are visible immediately
      void qc.invalidateQueries({ queryKey: ['wishlist'] })
    },
  })
}
