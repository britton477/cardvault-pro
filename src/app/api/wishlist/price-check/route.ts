// =============================================================================
// GET /api/wishlist/price-check
// Checks eBay sold prices for all 'wanted' wishlist items that have a target_price.
// Uses the price cache (24h TTL) — won't hammer the Finding API on every call.
// Returns items where last_ebay_price <= target_price (at-or-below target).
// =============================================================================
import { type NextRequest } from 'next/server'
import crypto               from 'crypto'
import { createClient }     from '@/lib/supabase/server'
import { requireAuth, ok, serverError } from '@/lib/api'
import { fetchSoldPrices }  from '@/lib/ebay'
import { withCache }        from '@/lib/cache'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { median }           from '@/lib/utils'
import type { WishlistItem } from '@/types'

export async function GET(request: NextRequest) {
  try {
    // Rate limit: 5 price-check sweeps per minute per org
    const limit = await rateLimit(request, 'wishlist-price-check', { max: 5, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const { orgId } = await requireAuth()
    const supabase  = await createClient()

    // Load wanted items with a target price set
    const { data: items, error } = await supabase
      .from('wishlist')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'wanted')
      .not('target_price', 'is', null)
      .is('deleted_at', null)
      .order('priority', { ascending: false }) // high priority first
      .limit(50)

    if (error) return serverError(error)
    if (!items || items.length === 0) {
      return ok({ checked: 0, alerts: [] })
    }

    const now       = new Date().toISOString()
    const alerts: WishlistItem[] = []

    await Promise.allSettled(
      items.map(async (item) => {
        const cardName = item['card_name'] as string
        const setName  = item['set_name']  as string | null
        const target   = item['target_price'] as number

        // Build cache key identical to /api/ebay/price
        const queryHash = crypto
          .createHash('md5')
          .update(`${cardName.toLowerCase()}|${(setName ?? '').toLowerCase()}`)
          .digest('hex')

        // Two-tier cache lookup (Redis → Postgres)
        const result = await withCache(
          `ebay-price:${queryHash}`,
          60 * 60 * 24,
          async () => {
            const db = createClient()
            const { data: cached } = await (await db)
              .from('price_cache')
              .select('median_price, prices')
              .eq('query_hash', queryHash)
              .gt('expires_at', now)
              .maybeSingle()

            if (cached) {
              return { median_price: cached['median_price'] as number | null }
            }

            // Fetch from Finding API
            const listings = await fetchSoldPrices(orgId, cardName, setName ?? undefined)
            const prices   = listings.map(l => l.price).filter(p => p > 0)
            const med      = median(prices)

            // Persist to cache
            await (await db).from('price_cache').upsert({
              query_hash:  queryHash,
              card_name:   cardName,
              set_code:    setName ?? '',
              median_price: med,
              price_count: prices.length,
              prices,
              fetched_at:  now,
              expires_at:  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            })

            return { median_price: med }
          }
        ) as { median_price: number | null }

        const medianPrice = result?.median_price ?? null

        // Write price back to wishlist row
        await supabase
          .from('wishlist')
          .update({
            last_ebay_price:  medianPrice,
            price_checked_at: now,
            updated_at:       now,
          })
          .eq('id', item['id'] as string)

        // Collect alert if at or below target
        if (medianPrice !== null && medianPrice <= target) {
          alerts.push({
            ...(item as WishlistItem),
            last_ebay_price:  medianPrice,
            price_checked_at: now,
          })
        }
      })
    )

    return ok({
      checked: items.length,
      alerts,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
