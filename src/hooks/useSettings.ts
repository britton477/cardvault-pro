'use client'
// =============================================================================
// useSettings — TanStack Query hooks for org settings + eBay credentials.
// All credential operations are server-side only; the client never sees raw
// credential values — only { has_credentials, updated_at }.
// =============================================================================
import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { OrgSettings } from '@/types'
import type { SellerModel } from '@/lib/fees'

/** Build the fee-calc SellerModel from stored settings (defaults to private). */
export function toSellerModel(s: Pick<OrgSettings, 'seller_model' | 'fvf_pct' | 'fvf_fixed'> | undefined): SellerModel {
  if (s?.seller_model === 'business') {
    return { kind: 'business', fvfPct: s.fvf_pct ?? 0, fvfFixed: s.fvf_fixed ?? 0 }
  }
  return { kind: 'private' }
}

/**
 * Seller model for net-proceeds display. Reads the shared org-settings query,
 * so many callers dedupe onto one fetch. The result is memoised on the
 * underlying primitives so its identity is stable across renders — callers can
 * safely pass it to React.memo'd children without defeating the memo.
 */
export function useSellerModel(): SellerModel {
  const { data } = useOrgSettings()
  const kind  = data?.seller_model === 'business' ? 'business' : 'private'
  const pct   = data?.fvf_pct   ?? 0
  const fixed = data?.fvf_fixed ?? 0
  return useMemo<SellerModel>(
    () => (kind === 'business' ? { kind, fvfPct: pct, fvfFixed: fixed } : { kind: 'private' }),
    [kind, pct, fixed],
  )
}

// ── Org settings ──────────────────────────────────────────────────────────────

export function useOrgSettings() {
  return useQuery<OrgSettings>({
    queryKey: ['settings', 'org'],
    queryFn: async () => {
      const res = await fetch('/api/settings/org')
      if (!res.ok) throw new Error('Failed to load settings')
      return res.json() as Promise<OrgSettings>
    },
    staleTime: 60_000,
  })
}

export function useUpdateOrgSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: Partial<OrgSettings>) => {
      const res = await fetch('/api/settings/org', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error ?? 'Failed to save settings')
      }
      return res.json() as Promise<OrgSettings>
    },
    onSuccess: (updated) => {
      // Update cache immediately so UI reflects new values
      qc.setQueryData<OrgSettings>(['settings', 'org'], updated)
    },
  })
}

// ── eBay credentials ──────────────────────────────────────────────────────────

export interface EbayCredentialStatus {
  has_credentials: boolean
  updated_at:      string | null
}

export function useEbayCredentialStatus() {
  return useQuery<EbayCredentialStatus>({
    queryKey: ['settings', 'ebay-credentials'],
    queryFn: async () => {
      const res = await fetch('/api/settings/ebay-credentials')
      if (!res.ok) throw new Error('Failed to check eBay credential status')
      return res.json() as Promise<EbayCredentialStatus>
    },
    staleTime: 60_000,
  })
}

export interface EbayCredentialsInput {
  app_id:  string
  secret:  string
  ru_name: string
}

// ── eBay OAuth connection status ──────────────────────────────────────────────

export interface EbayConnectionStatus {
  connected:       boolean
  has_token:       boolean
  has_refresh:     boolean
  is_expired:      boolean
  expires_at:      string | null
  expires_in_ms:   number | null
  is_sandbox:      boolean
  has_credentials: boolean
}

export function useEbayConnectionStatus() {
  return useQuery<EbayConnectionStatus>({
    queryKey: ['settings', 'ebay-connection'],
    queryFn: async () => {
      const res = await fetch('/api/ebay/status')
      if (!res.ok) throw new Error('Failed to check eBay connection status')
      return res.json() as Promise<EbayConnectionStatus>
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useSaveEbayCredentials() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: EbayCredentialsInput) => {
      const res = await fetch('/api/settings/ebay-credentials', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error ?? 'Failed to save eBay credentials')
      }
      return res.json() as Promise<{ success: boolean }>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'ebay-credentials'] })
    },
  })
}
