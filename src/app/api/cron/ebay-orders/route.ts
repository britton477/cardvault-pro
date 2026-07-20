// =============================================================================
// GET /api/cron/ebay-orders
//
// Hourly cron: pull new eBay orders into sales for every org with eBay
// connected, so sales appear without the user having to think about it.
//
// Security: guarded by CRON_SECRET header (set as a Vercel env var). Vercel
// sends Authorization: Bearer <CRON_SECRET> for crons declared in vercel.json.
//
// Schedule: hourly at :15 (configured in vercel.json)
//
// Design:
//   - Only orgs with stored eBay credentials are scanned
//   - 2-day lookback: generous overlap against an hourly cadence, so a failed
//     run or a late-clearing payment still gets picked up on the next pass.
//     Re-seeing an order is free — the sync is idempotent on
//     (ebay_order_id, ebay_transaction_id).
//   - One org failing never stops the others
//   - Summary returned as JSON for the Vercel function log
// =============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncEbayOrders }    from '@/lib/ebay-orders'
import { invalidateCache }   from '@/lib/cache'

export const maxDuration = 300  // 5-minute Vercel function timeout

const LOOKBACK_DAYS = 2

export async function GET(request: NextRequest) {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Only orgs that have actually connected eBay — everyone else has nothing
  // to sync and would just burn a failed API call.
  const { data: connected, error } = await db
    .from('ebay_credentials')
    .select('org_id')
    .not('refresh_token_enc', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const orgIds = [...new Set((connected ?? []).map(c => c['org_id'] as string))]

  const summary = {
    orgs_scanned: orgIds.length,
    imported:     0,
    skipped:      0,
    unmatched:    0,
    cancelled:    0,
    failed_orgs:  [] as Array<{ org_id: string; error: string }>,
  }

  for (const orgId of orgIds) {
    try {
      const res = await syncEbayOrders(orgId, LOOKBACK_DAYS, null)

      summary.imported  += res.imported
      summary.skipped   += res.skipped
      summary.unmatched += res.unmatched
      summary.cancelled += res.cancelled

      // Only bust the dashboard cache when something actually changed
      if (res.imported > 0) {
        void invalidateCache(`dashboard:${orgId}`)
        void db.rpc('refresh_dashboard_cache', { p_org_id: orgId })
      }

      if (res.errors.length > 0) {
        console.error(`[cron/ebay-orders] org ${orgId} partial errors:`, res.errors)
      }
    } catch (err) {
      // An expired token or eBay outage for one seller must not block the rest
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/ebay-orders] org ${orgId} failed:`, message)
      summary.failed_orgs.push({ org_id: orgId, error: message })
    }
  }

  return NextResponse.json(summary)
}
