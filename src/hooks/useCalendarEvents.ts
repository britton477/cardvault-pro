// =============================================================================
// useCalendarEvents — TanStack Query hooks for the calendar feature
// =============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CalendarEvent, CreateEventInput, UpdateEventInput } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function eventsKey(month: string) {
  return ['events', month] as const
}

async function fetchEvents(month: string): Promise<CalendarEvent[]> {
  const res  = await fetch(`/api/events?month=${month}`)
  if (!res.ok) throw new Error('Failed to load calendar events')
  const json = await res.json() as { data: CalendarEvent[] }
  return json.data
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all events for a given month (YYYY-MM).
 * Data is considered fresh for 60 seconds; background refetch on window focus.
 */
export function useCalendarEvents(month: string) {
  return useQuery({
    queryKey:  eventsKey(month),
    queryFn:   () => fetchEvents(month),
    staleTime: 60_000,
    enabled:   Boolean(month),
  })
}

// ── Create ────────────────────────────────────────────────────────────────────

export function useCreateEvent(month: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateEventInput) => {
      const res = await fetch('/api/events', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error ?? 'Failed to create event')
      }
      return res.json() as Promise<CalendarEvent>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventsKey(month) })
    },
  })
}

// ── Update ────────────────────────────────────────────────────────────────────

export function useUpdateEvent(month: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateEventInput & { id: string }) => {
      const res = await fetch(`/api/events/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error ?? 'Failed to update event')
      }
      return res.json() as Promise<CalendarEvent>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventsKey(month) })
    },
  })
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function useDeleteEvent(month: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/events/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const err = await res.json() as { error: string }
        throw new Error(err.error ?? 'Failed to delete event')
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventsKey(month) })
    },
  })
}
