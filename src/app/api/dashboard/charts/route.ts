// =============================================================================
// GET /api/dashboard/charts?days=30|60|90
// Returns all chart data for the dashboard in a single round-trip:
//   - profit_trend:   daily profit for the last N days (all days filled, zeros included)
//   - platform_split: all-time revenue + profit grouped by sales platform
//   - activity:       last 15 audit log entries for the org
//
// No Redis caching here — TanStack Query caches this client-side for 5 minutes.
// The per-org stat card cache (dashboard:${orgId}) is separate (60s, Redis).
// =============================================================================
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, serverError } from '@/lib/api'
import type { ActivityEntry, PlatformSplit, ProfitTrendPoint, SalePlatform } from '@/types'

const QuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
})

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()

    const params   = Object.fromEntries(request.nextUrl.searchParams)
    const { days } = QuerySchema.parse(params)
    const db       = createAdminClient()

    // Start of the trend window (YYYY-MM-DD, UTC)
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const since     = sinceDate.toISOString().split('T')[0]!

    // ── 1. Profit trend ───────────────────────────────────────────────────────
    // Fetch all sales in the window — aggregate to day in JS (avoids raw SQL)
    const { data: salesRaw, error: salesErr } = await db
      .from('sales')
      .select('sale_date, profit, sold_price')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .gte('sale_date', since)

    if (salesErr) return serverError(salesErr)

    // Build map pre-filled with zero for every calendar day in the window so
    // the chart always renders a complete X axis with no missing dates.
    const trendMap = new Map<string, ProfitTrendPoint>()
    for (let i = 0; i < days; i++) {
      const ms  = Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000
      const key = new Date(ms).toISOString().split('T')[0]!
      trendMap.set(key, { date: key, profit: 0, revenue: 0, count: 0 })
    }
    for (const s of salesRaw ?? []) {
      // sale_date may be "YYYY-MM-DD" or a full ISO string
      const key   = (s.sale_date as string).slice(0, 10)
      const entry = trendMap.get(key)
      if (entry) {
        entry.profit  += s.profit    as number
        entry.revenue += s.sold_price as number
        entry.count   += 1
      }
    }
    const profit_trend = Array.from(trendMap.values())

    // ── 2. Platform split (all-time) ──────────────────────────────────────────
    // Fetch all non-deleted sales — small table for card businesses, safe to aggregate in JS
    const { data: platRaw, error: platErr } = await db
      .from('sales')
      .select('platform, sold_price, profit')
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (platErr) return serverError(platErr)

    const platMap = new Map<SalePlatform, PlatformSplit>()
    for (const s of platRaw ?? []) {
      const p     = s.platform as SalePlatform
      const entry = platMap.get(p) ?? { platform: p, revenue: 0, profit: 0, count: 0 }
      entry.revenue += s.sold_price as number
      entry.profit  += s.profit    as number
      entry.count   += 1
      platMap.set(p, entry)
    }
    const platform_split = Array.from(platMap.values())
      .sort((a, b) => b.revenue - a.revenue)

    // ── 3. Activity feed ──────────────────────────────────────────────────────
    const { data: actRaw, error: actErr } = await db
      .from('audit_log')
      .select('id, action, entity_type, entity_id, created_at, changes, users!user_id(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(15)

    if (actErr) return serverError(actErr)

    const activity: ActivityEntry[] = (actRaw ?? []).map(a => {
      const userRow = a.users as { name?: string } | null
      return {
        id:          a.id          as string,
        action:      a.action      as string,
        entity_type: a.entity_type as string,
        entity_id:   a.entity_id  as string | null,
        created_at:  a.created_at as string,
        changes:     a.changes    as Record<string, unknown> | null,
        user_name:   userRow?.name ?? null,
      }
    })

    return ok({ profit_trend, platform_split, activity, days })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
