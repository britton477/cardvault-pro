'use client'
// =============================================================================
// useSales — TanStack Query hooks for the Sales resource
// Mirrors the useCards pattern exactly.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PaginatedResponse, Sale } from '@/types'
import type { CreateSaleInput, UpdateSaleInput } from '@/types/validation'

// ── Fetch helper ──────────────────────────────────────────────────────────────

interface SalesQuery {
  page?:         number
  limit?:        number
  search?:       string
  platform?:     string
  status?:       string
  from?:         string
  to?:           string
  needs_review?: string
  refunded?:     string
  sort?:         string
  order?:        string
}

async function fetchSales(params: SalesQuery): Promise<PaginatedResponse<Sale>> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString()
  const res = await fetch(`/api/sales?${qs}`)
  if (!res.ok) throw new Error('Failed to load sales')
  return res.json() as Promise<PaginatedResponse<Sale>>
}

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useSales(params: SalesQuery) {
  return useQuery({
    queryKey:        ['sales', params],
    queryFn:         () => fetchSales(params),
    placeholderData: (prev) => prev,
    staleTime:       30_000,  // don't refetch on focus/mount within 30 s
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreateSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateSaleInput) => {
      const res = await fetch('/api/sales', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }
      return res.json() as Promise<Sale>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      // Card status may have changed to 'Sold' when card_id was supplied
      qc.invalidateQueries({ queryKey: ['cards'] })
    },
  })
}

export function useUpdateSale(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateSaleInput) => {
      const res = await fetch(`/api/sales/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }
      return res.json() as Promise<Sale>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}

/**
 * Delete a sale, optionally returning the sold units to stock.
 *
 * restock is explicit rather than automatic: deleting a duplicate row should
 * NOT restore inventory, while deleting a sale that never happened should.
 */
export function useDeleteSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      arg: string | { saleId: string; restock?: boolean },
    ) => {
      const { saleId, restock } = typeof arg === 'string'
        ? { saleId: arg, restock: false }
        : arg
      const qs  = restock ? '?restock=true' : ''
      const res = await fetch(`/api/sales/${saleId}${qs}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete sale')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['cards'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// ── Refunds ───────────────────────────────────────────────────────────────────

export interface RefundInput {
  saleId:  string
  amount:  number
  reason?: string
  restock: boolean
}

export interface RefundResult {
  sale:           Sale
  restocked:      boolean
  is_full_refund: boolean
}

export function useRefundSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ saleId, amount, reason, restock }: RefundInput): Promise<RefundResult> => {
      const res = await fetch(`/api/sales/${saleId}/refund`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount, reason: reason ?? '', restock }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Refund failed')
      }
      return res.json() as Promise<RefundResult>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['cards'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// ── eBay order sync ───────────────────────────────────────────────────────────

export interface SyncOrdersResult {
  scanned:   number
  imported:  number
  skipped:   number
  unmatched: number
  cancelled: number
  errors:    string[]
}

/** Pull recent eBay orders into sales on demand. */
export function useSyncEbayOrders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lookbackDays = 7): Promise<SyncOrdersResult> => {
      const res = await fetch('/api/ebay/sync-orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lookback_days: lookbackDays }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; message?: string }
        throw new Error(err.message ?? err.error ?? 'Sync failed')
      }
      return res.json() as Promise<SyncOrdersResult>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['cards'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
