'use client'
// =============================================================================
// useWishlist — TanStack Query hooks for wishlist CRUD.
// staleTime: 30s matches cards/sales/sealed pattern.
// All mutations invalidate ['wishlist'] so the list refreshes immediately.
// =============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  WishlistItem, CreateWishlistInput, UpdateWishlistInput, ListWishlistQuery,
} from '@/types'

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchWishlist(params: ListWishlistQuery): Promise<{ data: WishlistItem[]; count: number }> {
  const qs = new URLSearchParams()
  if (params.page)     qs.set('page',     String(params.page))
  if (params.limit)    qs.set('limit',    String(params.limit))
  if (params.status && params.status !== 'all')   qs.set('status',   params.status)
  if (params.priority && params.priority !== 'all') qs.set('priority', params.priority)
  if (params.search)   qs.set('search',   params.search)

  const res = await fetch(`/api/wishlist?${qs}`)
  if (!res.ok) throw new Error('Failed to load wishlist')
  return res.json() as Promise<{ data: WishlistItem[]; count: number }>
}

async function createWishlistItem(input: CreateWishlistInput): Promise<WishlistItem> {
  const res = await fetch('/api/wishlist', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to add wishlist item')
  }
  return res.json() as Promise<WishlistItem>
}

async function updateWishlistItem(id: string, input: UpdateWishlistInput): Promise<WishlistItem> {
  const res = await fetch(`/api/wishlist/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to update wishlist item')
  }
  return res.json() as Promise<WishlistItem>
}

async function deleteWishlistItem(id: string): Promise<void> {
  const res = await fetch(`/api/wishlist/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete wishlist item')
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useWishlist(params: ListWishlistQuery = {}) {
  return useQuery({
    queryKey:        ['wishlist', params],
    queryFn:         () => fetchWishlist(params),
    staleTime:       30_000,
    placeholderData: (prev) => prev,
  })
}

export function useAddWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateWishlistInput) => createWishlistItem(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  })
}

export function useUpdateWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWishlistInput }) =>
      updateWishlistItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  })
}

export function useDeleteWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWishlistItem(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  })
}
