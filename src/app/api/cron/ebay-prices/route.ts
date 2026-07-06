// =============================================================================
// GET /api/cron/ebay-prices
//
// Daily cron job: refresh ebay_avg_sold for all active (In Stock + Listed)
// cards across all orgs.
//
// Security: guarded by CRON_SECRET header (set as Vercel env var).
// Vercel automatically sends Authorization: Bearer <CRON_SECRET> for crons
// configured in vercel.json.
//
// Schedule: daily at 04:00 UTC (configured in vercel.json)
// Budget: 200ms delay between cards to stay within eBay Browse API rate limits.
//
// Design:
//   - Fetches all org IDs, iterates cards in batches
//   - Skips cards with no card_name
//   - Skips eBay price lookups that fail (logs + continues)
//   - Only writes back when price is found (no overwriting with null)
//   - Summary returned in JSON for Vercel function logs
// =============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient }              from '@/lib/supabase/server'
import { fetchSoldPrices }               from '@/lib/ebay'

export const maxDuration = 300  // 5-minute Vercel function timeout

export async function GET(request: NextRequest) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Fetch all active cards ──────────────────────────────────────────────────
  const db = createAdminClient()

  // Load cards that are In Stock or Listed (not Sold/deleted) with a card name.
  // Process in pages of 200 to avoid memory pressure on large catalogs.
  let page = 0
  const PAGE_SIZE = 200
  let updated = 0
  let skipped = 0
  let failed  = 0

  while (true) {
    const { data: cards, error } = await db
      .from('cards')
      .select('id, org_id, card_name, set_code, card_number, condition, is_graded, grader, grade')
      .in('status', ['In Stock', 'Listed'])
      .is('deleted_at', null)
      .not('card_name', 'is', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[cron/ebay-prices] DB error:', error.message)
      break
    }
    if (!cards || cards.length === 0) break

    for (const card of cards) {
      if (!card.card_name) { skipped++; continue }

      try {
        // Delay between requests to respect eBay Browse API rate limits
        await new Promise(r => setTimeout(r, 200))

        const listings = await fetchSoldPrices(
          card.org_id as string,
          card.card_name as string,
          card.set_code    ?? undefined,
          card.condition   ?? undefined,
          card.card_number ?? undefined,
          card.is_graded   ?? false,
          card.grader      ?? null,
          card.grade       ?? null,
        )

        if (listings.length === 0) { skipped++; continue }

        // IQR-based median
        const prices = listings.map(l => l.price).sort((a, b) => a - b)
        const mid    = Math.floor(prices.length / 2)
        const median = prices.length % 2 === 0
          ? ((prices[mid - 1]! + prices[mid]!) / 2)
          : prices[mid]!

        await db
          .from('cards')
          .update({
            ebay_avg_sold: Math.round(median * 100) / 100,
            updated_at:    new Date().toISOString(),
          })
          .eq('id', card.id)

        updated++
      } catch (err) {
        failed++
        console.error(`[cron/ebay-prices] card ${card.id as string}:`, err instanceof Error ? err.message : String(err))
      }
    }

    if (cards.length < PAGE_SIZE) break
    page++
  }

  const summary = { updated, skipped, failed }
  console.info('[cron/ebay-prices] done', summary)
  return NextResponse.json({ ok: true, ...summary })
}
