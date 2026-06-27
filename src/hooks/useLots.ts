'use client'
// =============================================================================
// useLots — TanStack Query hooks for purchase lot CRUD + lot cards.
// =============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PurchaseLot, Card }                from '@/types'
import type { CreateLotInput, UpdateLotInput }   from '@/types/validation'

const QUERY_KEY      = ['lots'] as const
const LOT_CARDS_KEY  = (id: string) => ['lot-cards', id] as const

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchLot(id: string): Promise<PurchaseLot> {
  const res = await fetch(`/api/lots/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to load lot')
  }
  return res.json() as Promise<PurchaseLot>
}

async function fetchLotCards(lotId: string): Promise<{ data: Card[]; count: number }> {
  const res = await fetch(`/api/lots/${lotId}/cards`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to load lot cards')
  }
  return res.json() as Promise<{ data: Card[]; count: number }>
}

async function fetchLots(search?: string): Promise<{ data: PurchaseLot[]; count: number }> {
  const qs  = search ? `?search=${encodeURIComponent(search)}` : ''
  const res = await fetch(`/api/lots${qs}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to load lots')
  }
  return res.json() as Promise<{ data: PurchaseLot[]; count: number }>
}

async function createLot(input: CreateLotInput): Promise<PurchaseLot> {
  const res = await fetch('/api/lots', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to create lot')
  }
  return res.json() as Promise<PurchaseLot>
}

async function updateLot(id: string, input: UpdateLotInput): Promise<PurchaseLot> {
  const res = await fetch(`/api/lots/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to update lot')
  }
  return res.json() as Promise<PurchaseLot>
}

async function deleteLot(id: string): Promise<void> {
  const res = await fetch(`/api/lots/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to delete lot')
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useLots(search?: string) {
  return useQuery({
    queryKey:        [...QUERY_KEY, search],
    queryFn:         () => fetchLots(search),
    staleTime:       30_000,
    placeholderData: (prev) => prev,
  })
}

export function useLot(id: string | null) {
  return useQuery({
    queryKey:  ['lot', id],
    queryFn:   () => fetchLot(id!),
    enabled:   Boolean(id),
    staleTime: 30_000,
  })
}

export function useLotCards(lotId: string | null) {
  return useQuery({
    queryKey:  LOT_CARDS_KEY(lotId ?? ''),
    queryFn:   () => fetchLotCards(lotId!),
    enabled:   Boolean(lotId),
    staleTime: 30_000,
  })
}

export function useCreateLot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createLot,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: QUERY_KEY }) },
  })
}

export function useUpdateLot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLotInput }) => updateLot(id, input),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: QUERY_KEY }) },
  })
}

export function useDeleteLot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteLot,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: QUERY_KEY }) },
  })
}

// Remove a card from its lot by setting lot_id = null
export function useRemoveCardFromLot(lotId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cardId: string) => {
      const res = await fetch(`/api/cards/${cardId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lot_id: null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to remove card from lot')
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LOT_CARDS_KEY(lotId) })
      void qc.invalidateQueries({ queryKey: QUERY_KEY })
      void qc.invalidateQueries({ queryKey: ['cards'] })
    },
  })
}
