// =============================================================================
// POST /api/bulk-wizard/price
//
// eBay sold-price lookup for the Bulk Wizard pipeline.
// Wraps fetchSoldPrices() from lib/ebay.ts — zero new eBay API code.
//
// Returns: { avg_sold, median_sold, sample_count }
//
// Caching: 24-hour Redis cache per (card_name:set_code:card_number:condition).
//   eBay prices are stable enough that a 24h cache is safe and reduces API
//   calls dramatically when the same card appears in multiple scans.
//
// Rate limit: 60 req/min per org (generous — each card fires one request).
//
// Graceful degradation: if eBay credentials are not configured the route
// returns { avg_sold: 0, median_sold: 0, sample_count: 0 } instead of 500
// so the wizard can still function (just without price data).
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { withCache }   from '@/lib/cache'
import { fetchSoldPrices, type SoldListing } from '@/lib/ebay'

const BodySchema = z.object({
  card_name:   z.string().min(1).max(200),
  set_code:    z.string().max(20).optional(),
  card_number: z.string().max(20).optional(),
  condition:   z.enum(['NM', 'LP', 'MP', 'HP', 'Sealed']).optional(),
})

function median(nums: number[]): number {
  if (!nums.length) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid    = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireAuth({ feature: 'bulk_wizard' })

    // 60 price lookups per minute per org
    const limit = await rateLimit(request, `bulk-price:${orgId}`, { max: 60, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const body  = await request.json() as unknown
    const input = BodySchema.parse(body)

    // Stable cache key — normalised to lowercase to maximise hit rate.
    // v2: invalidates v1 cache entries that may contain graded-card-polluted data.
    const cacheKey = [
      'bulk-price-v2',
      input.card_name.toLowerCase().replace(/\s+/g, '-'),
      (input.set_code    ?? '').toLowerCase(),
      (input.card_number ?? '').replace(/\//g, '-'),
      (input.condition   ?? ''),
    ].join(':')

    const result = await withCache(cacheKey, 60 * 60 * 24, async () => {
      try {
        // Try progressively broader queries until we get results.
        // Most specific (name + set + number) gives the best match; falling back
        // to name-only avoids a zero result when sellers omit the set code.
        const queryFns: Array<() => Promise<SoldListing[]>> = [
          () => fetchSoldPrices(orgId, input.card_name, input.set_code, input.condition, input.card_number),
          ...(input.card_number
            ? [() => fetchSoldPrices(orgId, input.card_name, input.set_code, input.condition)]
            : []),
          ...(input.set_code
            ? [() => fetchSoldPrices(orgId, input.card_name, undefined, input.condition)]
            : []),
        ]

        let listings: SoldListing[] = []
        for (const fn of queryFns) {
          listings = await fn()
          if (listings.length > 0) break
        }

        if (!listings.length) {
          return { avg_sold: 0, median_sold: 0, sample_count: 0 }
        }

        const prices      = listings.map(l => l.price)
        const avg_sold    = prices.reduce((s, p) => s + p, 0) / prices.length
        const median_sold = median(prices)

        return {
          avg_sold:     Math.round(avg_sold    * 100) / 100,
          median_sold:  Math.round(median_sold * 100) / 100,
          sample_count: listings.length,
        }
      } catch (ebayErr) {
        // eBay credentials not configured or API error — return zero rather than 500
        console.warn('[BulkWizard/price] eBay lookup failed, returning zero:', ebayErr)
        return { avg_sold: 0, median_sold: 0, sample_count: 0 }
      }
    })

    return ok(result)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
