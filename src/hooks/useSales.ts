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
  page?:     number
  limit?:    number
  platform?: string
  status?:   string
  from?:     string
  to?:       string
  sort?:     string
  order?:    string
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

export function useDeleteSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (saleId: string) => {
      const res = await fetch(`/api/sales/${saleId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete sale')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}
