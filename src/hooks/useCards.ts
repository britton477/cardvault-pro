'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Card, PaginatedResponse, CreateCardInput, UpdateCardInput } from '@/types'
import type { ListCardsQuery } from '@/types/validation'

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchCards(params: ListCardsQuery): Promise<PaginatedResponse<Card>> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString()
  const res = await fetch(`/api/cards?${qs}`)
  if (!res.ok) throw new Error('Failed to load cards')
  return res.json() as Promise<PaginatedResponse<Card>>
}

async function fetchCard(id: string): Promise<Card> {
  const res = await fetch(`/api/cards/${id}`)
  if (!res.ok) throw new Error('Card not found')
  return res.json() as Promise<Card>
}

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useCards(params: ListCardsQuery) {
  return useQuery({
    queryKey:        ['cards', params],
    queryFn:         () => fetchCards(params),
    placeholderData: (prev) => prev,  // keep previous page while loading
    staleTime:       30_000,          // don't refetch on focus/mount within 30 s
  })
}

export function useCard(id: string) {
  return useQuery({
    queryKey: ['cards', id],
    queryFn:  () => fetchCard(id),
    enabled:  Boolean(id),
  })
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreateCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCardInput) => {
      const res = await fetch('/api/cards', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }
      return res.json() as Promise<Card>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards'] }),
  })
}

export function useUpdateCard(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateCardInput) => {
      const res = await fetch(`/api/cards/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }
      return res.json() as Promise<Card>
    },
    onSuccess: (data) => {
      qc.setQueryData(['cards', id], data)
      qc.invalidateQueries({ queryKey: ['cards'] })
    },
  })
}

export function useDeleteCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/cards/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete card')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards'] }),
  })
}

// ── Bulk action ───────────────────────────────────────────────────────────────

import type { BulkCardAction } from '@/types/validation'

interface BulkResult { affected: number }

export function useBulkCardAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BulkCardAction): Promise<BulkResult> => {
      const res = await fetch('/api/cards/bulk', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error ?? 'Bulk action failed')
      }
      return res.json() as Promise<BulkResult>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards'] }),
  })
}
