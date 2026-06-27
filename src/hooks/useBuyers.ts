'use client'
// =============================================================================
// useBuyers — TanStack Query hooks for buyer profile CRUD.
// =============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Buyer }                             from '@/types'
import type { CreateBuyerInput, UpdateBuyerInput } from '@/types/validation'

const QUERY_KEY = ['buyers'] as const

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchBuyers(search?: string, page = 1): Promise<{ data: Buyer[]; count: number; page: number; limit: number }> {
  const qs = new URLSearchParams({ page: String(page) })
  if (search) qs.set('search', search)
  const res = await fetch(`/api/buyers?${qs}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to load buyers')
  }
  return res.json() as Promise<{ data: Buyer[]; count: number; page: number; limit: number }>
}

async function fetchBuyer(id: string): Promise<Buyer & { sales: unknown[] }> {
  const res = await fetch(`/api/buyers/${id}`)
  if (!res.ok) throw new Error('Failed to load buyer')
  return res.json() as Promise<Buyer & { sales: unknown[] }>
}

async function createBuyer(input: CreateBuyerInput): Promise<Buyer> {
  const res = await fetch('/api/buyers', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to create buyer')
  }
  return res.json() as Promise<Buyer>
}

async function updateBuyer(id: string, input: UpdateBuyerInput): Promise<Buyer> {
  const res = await fetch(`/api/buyers/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to update buyer')
  }
  return res.json() as Promise<Buyer>
}

async function deleteBuyer(id: string): Promise<void> {
  const res = await fetch(`/api/buyers/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete buyer')
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useBuyers(search?: string, page?: number) {
  return useQuery({
    queryKey:        [...QUERY_KEY, search, page],
    queryFn:         () => fetchBuyers(search, page),
    staleTime:       30_000,
    placeholderData: (prev) => prev,
  })
}

export function useBuyer(id: string | null) {
  return useQuery({
    queryKey:  [...QUERY_KEY, id],
    queryFn:   () => fetchBuyer(id!),
    enabled:   !!id,
    staleTime: 30_000,
  })
}

export function useCreateBuyer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createBuyer,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: QUERY_KEY }) },
  })
}

export function useUpdateBuyer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBuyerInput }) => updateBuyer(id, input),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: QUERY_KEY }) },
  })
}

export function useDeleteBuyer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteBuyer,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: QUERY_KEY }) },
  })
}
