'use client'
// =============================================================================
// useDashboard — TanStack Query hooks for dashboard data
// staleTime: 5 minutes — charts show business trends, not real-time ticks.
// Mutations (adding cards/sales) call invalidateCache for the stat row;
// charts self-refresh on the 5-minute stale window.
// =============================================================================
import { useQuery } from '@tanstack/react-query'
import type { DashboardChartData, DashboardInsights } from '@/types'

async function fetchCharts(days: number): Promise<DashboardChartData> {
  const res = await fetch(`/api/dashboard/charts?days=${days}`)
  if (!res.ok) throw new Error('Failed to load dashboard data')
  return res.json() as Promise<DashboardChartData>
}

async function fetchInsights(): Promise<DashboardInsights> {
  const res = await fetch('/api/dashboard/insights')
  if (!res.ok) throw new Error('Failed to load dashboard insights')
  return res.json() as Promise<DashboardInsights>
}

export function useDashboardCharts(days: 30 | 60 | 90 = 30) {
  return useQuery({
    queryKey:        ['dashboard', 'charts', days],
    queryFn:         () => fetchCharts(days),
    staleTime:       5 * 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useDashboardInsights() {
  return useQuery({
    queryKey:  ['dashboard', 'insights'],
    queryFn:   fetchInsights,
    staleTime: 5 * 60_000,
  })
}
