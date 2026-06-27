'use client'
// =============================================================================
// useReports — TanStack Query hooks for Reports & Export
// =============================================================================
import { useQuery }         from '@tanstack/react-query'
import type { ReportSummary } from '@/types'

// ── Report summary ────────────────────────────────────────────────────────────

async function fetchReportSummary(from: string, to: string): Promise<ReportSummary> {
  const res = await fetch(`/api/reports/summary?from=${from}&to=${to}`)
  if (!res.ok) throw new Error('Failed to load report')
  return (await res.json()) as ReportSummary
}

export function useReportSummary(from: string, to: string) {
  return useQuery<ReportSummary, Error>({
    queryKey:  ['report-summary', from, to],
    queryFn:   () => fetchReportSummary(from, to),
    staleTime: 5 * 60 * 1000,  // 5 min — reports don't need to be live
    enabled:   Boolean(from && to && from <= to),
  })
}

// ── CSV export helper (not a hook — triggers a browser download) ──────────────

type ExportType = 'sales' | 'cards' | 'sealed'

export function downloadCSV(type: ExportType, from?: string, to?: string) {
  const qs = new URLSearchParams({ type })
  if (from) qs.set('from', from)
  if (to)   qs.set('to',   to)
  // Anchor click triggers Content-Disposition download without page navigation
  const a  = document.createElement('a')
  a.href   = `/api/export/csv?${qs.toString()}`
  a.click()
}
