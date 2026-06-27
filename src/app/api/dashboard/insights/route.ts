// =============================================================================
// GET /api/dashboard/insights
//
// Returns three actionable insight lists for the dashboard:
//
//   sitting_longest   — top 5 active cards by days in stock (oldest first)
//   price_opportunities — top 5 cards where ebay_avg_sold > listed_price,
//                         ranked by the price gap (biggest opportunity first)
//   stock_by_set      — inventory cost + count grouped by set_code,
//                         sorted by total value descending
//
// Cached by TanStack Query client-side for 5 minutes.
// No Redis cache needed — data changes infrequently and queries are cheap.
// =============================================================================
import { createAdminClient }          from '@/lib/supabase/server'
import { requireAuth, ok, serverError } from '@/lib/api'

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const db = createAdminClient()

    // ── 1. Sitting longest ────────────────────────────────────────────────────
    // Active (unsold, undiscarded) cards ordered by purchase date ascending.
    // days_in_stock computed in JS to avoid raw SQL.
    const { data: stockRaw, error: stockErr } = await db
      .from('cards')
      .select('id, card_name, set_code, condition, purchase_price, created_at, photos:card_photos(thumb_url, url, position)')
      .eq('org_id', orgId)
      .in('status', ['In Stock', 'Listed'])
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(5)

    if (stockErr) throw stockErr

    const now = Date.now()
    const sitting_longest = (stockRaw ?? []).map(c => ({
      id:             c.id,
      card_name:      c.card_name,
      set_code:       c.set_code,
      condition:      c.condition,
      purchase_price: c.purchase_price,
      days_in_stock:  Math.floor((now - new Date(c.created_at as string).getTime()) / 86_400_000),
      thumb_url:      (c.photos as { thumb_url: string | null; url: string; position: number }[])
                        ?.sort((a, b) => a.position - b.position)[0]?.thumb_url ?? null,
    }))

    // ── 2. Price opportunities ────────────────────────────────────────────────
    // Active cards with a known eBay avg where listed_price < ebay_avg_sold.
    // Gap = ebay_avg_sold - listed_price. Only consider cards that have a price.
    const { data: oppsRaw, error: oppsErr } = await db
      .from('cards')
      .select('id, card_name, set_code, condition, listed_price, ebay_avg_sold, photos:card_photos(thumb_url, url, position)')
      .eq('org_id', orgId)
      .in('status', ['In Stock', 'Listed'])
      .is('deleted_at', null)
      .not('ebay_avg_sold', 'is', null)
      .not('listed_price',  'is', null)
      .order('ebay_avg_sold', { ascending: false })
      .limit(50) // fetch more, filter + sort in JS

    if (oppsErr) throw oppsErr

    const price_opportunities = (oppsRaw ?? [])
      .filter(c => (c.ebay_avg_sold as number) > (c.listed_price as number))
      .map(c => ({
        id:            c.id,
        card_name:     c.card_name,
        set_code:      c.set_code,
        condition:     c.condition,
        listed_price:  c.listed_price  as number,
        ebay_avg_sold: c.ebay_avg_sold as number,
        gap:           (c.ebay_avg_sold as number) - (c.listed_price as number),
        thumb_url:     (c.photos as { thumb_url: string | null; url: string; position: number }[])
                         ?.sort((a, b) => a.position - b.position)[0]?.thumb_url ?? null,
      }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 5)

    // ── 3. Stock value by set ─────────────────────────────────────────────────
    // Sum purchase_price grouped by set_code for all active cards.
    const { data: setsRaw, error: setsErr } = await db
      .from('cards')
      .select('set_code, purchase_price')
      .eq('org_id', orgId)
      .in('status', ['In Stock', 'Listed'])
      .is('deleted_at', null)
      .not('set_code', 'is', null)

    if (setsErr) throw setsErr

    const setMap = new Map<string, { set_code: string; total_value: number; card_count: number }>()
    for (const c of setsRaw ?? []) {
      const key   = (c.set_code as string) || 'Unknown'
      const entry = setMap.get(key) ?? { set_code: key, total_value: 0, card_count: 0 }
      entry.total_value += c.purchase_price as number
      entry.card_count  += 1
      setMap.set(key, entry)
    }

    const stock_by_set = Array.from(setMap.values())
      .sort((a, b) => b.total_value - a.total_value)
      .slice(0, 10) // top 10 sets by value

    return ok({ sitting_longest, price_opportunities, stock_by_set })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
