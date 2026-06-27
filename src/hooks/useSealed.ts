'use client'
// =============================================================================
// useSealed — TanStack Query hooks for the Sealed Products resource
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PaginatedResponse, SealedProduct, ProductType } from '@/types'
import type {
  CreateSealedProductInput,
  UpdateSealedProductInput,
  OpenProductInput,
} from '@/types/validation'

// ── Query types ───────────────────────────────────────────────────────────────

interface SealedQuery {
  page?:         number
  limit?:        number
  product_type?: ProductType
  sort?:         string
  order?:        string
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchSealed(params: SealedQuery): Promise<PaginatedResponse<SealedProduct>> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString()
  const res = await fetch(`/api/sealed?${qs}`)
  if (!res.ok) throw new Error('Failed to load sealed products')
  return res.json() as Promise<PaginatedResponse<SealedProduct>>
}

// ── Query hook ────────────────────────────────────────────────────────────────

export function useSealed(params: SealedQuery = {}) {
  return useQuery({
    queryKey:        ['sealed', params],
    queryFn:         () => fetchSealed(params),
    placeholderData: (prev) => prev,
    staleTime:       30_000,  // don't refetch on focus/mount within 30 s
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreateSealed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateSealedProductInput) => {
      const res = await fetch('/api/sealed', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }
      return res.json() as Promise<SealedProduct>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sealed'] }),
  })
}

export function useUpdateSealed(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateSealedProductInput) => {
      const res = await fetch(`/api/sealed/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }
      return res.json() as Promise<SealedProduct>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sealed'] }),
  })
}

export function useDeleteSealed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productId: string) => {
      const res = await fetch(`/api/sealed/${productId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete sealed product')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sealed'] }),
  })
}

export function useOpenProduct(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: OpenProductInput) => {
      const res = await fetch(`/api/sealed/${id}/open`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }
      return res.json() as Promise<SealedProduct>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sealed'] }),
  })
}
