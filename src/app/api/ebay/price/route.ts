// =============================================================================
// GET /api/ebay/price?card_name=...&set_code=...
// Returns median sold price from eBay, with 24h DB cache.
// =============================================================================
import { type NextRequest } from 'next/server'
import crypto from 'crypto'
import { ZodError } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, badRequest, serverError, validationError } from '@/lib/api'
import { fetchSoldPrices } from '@/lib/ebay'
import { EbayPriceQuerySchema } from '@/types/validation'
import { median } from '@/lib/utils'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { withCache } from '@/lib/cache'

export async function GET(request: NextRequest) {
  try {
    // 20 eBay price lookups per user per minute — each call costs eBay API quota
    const limit = await rateLimit(request, 'ebay-price', { max: 20, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const { orgId } = await requireAuth()

    const params = Object.fromEntries(request.nextUrl.searchParams)
    const query  = EbayPriceQuerySchema.parse(params)

    // Include condition + card_number in cache key so each variant is cached separately
    const queryHash = crypto
      .createHash('md5')
      .update([
        query.card_name.toLowerCase(),
        (query.set_code    ?? '').toLowerCase(),
        (query.card_number ?? '').toLowerCase(),
        (query.condition   ?? '').toLowerCase(),
      ].join('|'))
      .digest('hex')

    // Two-tier cache: Redis (fast, in-memory) → Postgres price_cache (persistent 24h)
    const result = await withCache(
      `ebay-price:${queryHash}`,
      60 * 60 * 24, // 24h Redis TTL, matching DB cache
      async () => {
        const db = createAdminClient()
        const { data: cached } = await db
          .from('price_cache')
          .select('*')
          .eq('query_hash', queryHash)
          .gt('expires_at', new Date().toISOString())
          .single()

        if (cached) {
          return {
            card_name:    cached.card_name as string,
            set_code:     cached.set_code as string,
            median_price: cached.median_price as number | null,
            prices:       (cached.prices as number[]) ?? [],
            price_count:  cached.price_count as number,
            cached:       true,
          }
        }

        // Fetch from eBay API — condition + card_number narrow results to the specific card
        const listings = await fetchSoldPrices(orgId, query.card_name, query.set_code, query.condition, query.card_number)
        const prices   = listings.map((l: { price: number }) => l.price).filter((p: number) => p > 0)
        const med      = median(prices)

        // Persist to Postgres cache for resilience (survives Redis flushes)
        await db.from('price_cache').upsert({
          query_hash:   queryHash,
          card_name:    query.card_name,
          set_code:     query.set_code ?? '',
          condition:    query.condition ?? null,
          median_price: med,
          price_count:  prices.length,
          prices,
          fetched_at:   new Date().toISOString(),
          expires_at:   new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })

        return {
          card_name:    query.card_name,
          set_code:     query.set_code ?? '',
          condition:    query.condition ?? null,
          median_price: med,
          prices,
          price_count:  prices.length,
          cached:       false,
        }
      }
    )

    return ok(result)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
