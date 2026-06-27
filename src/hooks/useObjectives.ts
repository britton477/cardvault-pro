'use client'
// =============================================================================
// useObjectives — TanStack Query hooks for the Objectives resource
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Objective, ObjectiveScope }        from '@/types'
import type { CreateObjectiveSchema }            from '@/types/validation'
import { z }                                     from 'zod'

type CreateInput = z.infer<typeof CreateObjectiveSchema>

// ── Fetch helper ──────────────────────────────────────────────────────────────

interface ObjectivesResponse { data: Objective[]; count: number }

async function fetchObjectives(scope: ObjectiveScope): Promise<Objective[]> {
  const res = await fetch(`/api/objectives?scope=${scope}`)
  if (!res.ok) throw new Error('Failed to load objectives')
  const json = await res.json() as ObjectivesResponse
  return json.data
}

// ── Query ─────────────────────────────────────────────────────────────────────

export function useObjectives(scope: ObjectiveScope) {
  return useQuery<Objective[], Error>({
    queryKey:  ['objectives', scope],
    queryFn:   () => fetchObjectives(scope),
    staleTime: 30_000,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateObjective(scope: ObjectiveScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateInput) => {
      const res = await fetch('/api/objectives', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) throw new Error('Failed to create objective')
      return res.json() as Promise<Objective>
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['objectives', scope] }),
  })
}

export function useToggleObjective(scope: ObjectiveScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, is_complete }: { id: string; is_complete: boolean }) => {
      const res = await fetch(`/api/objectives/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_complete }),
      })
      if (!res.ok) throw new Error('Failed to update objective')
      return res.json() as Promise<Objective>
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['objectives', scope] }),
  })
}

export function useUpdateObjectiveTitle(scope: ObjectiveScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await fetch(`/api/objectives/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error('Failed to update objective')
      return res.json() as Promise<Objective>
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['objectives', scope] }),
  })
}

export function useDeleteObjective(scope: ObjectiveScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/objectives/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete objective')
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['objectives', scope] }),
  })
}
