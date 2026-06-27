'use client'
// =============================================================================
// useNotifications — polls /api/notifications every 5 minutes.
// The endpoint is cheap (3 lightweight queries), so frequent polling is safe.
// =============================================================================
import { useQuery } from '@tanstack/react-query'
import type { AppNotification } from '@/types'

interface NotificationsResponse {
  notifications: AppNotification[]
  count:         number
}

async function fetchNotifications(): Promise<NotificationsResponse> {
  const res = await fetch('/api/notifications')
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? 'Failed to load notifications')
  }
  return res.json() as Promise<NotificationsResponse>
}

export function useNotifications() {
  return useQuery({
    queryKey:       ['notifications'],
    queryFn:        fetchNotifications,
    staleTime:      60_000,          // treat as fresh for 1 min
    refetchInterval: 5 * 60_000,    // background refetch every 5 min
    placeholderData: (prev) => prev,
  })
}
