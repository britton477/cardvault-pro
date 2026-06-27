// =============================================================================
// GET /api/ebay/listings
// Fetches active eBay listings via GetMyeBaySelling and cross-references with
// the cards table to enrich each listing with local card data.
// =============================================================================
import { requireAuth, ok, serverError } from '@/lib/api'
import { getActiveListings } from '@/lib/ebay'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(request, 'ebay-listings-sync', { max: 10, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const { orgId } = await requireAuth()
    const supabase  = await createClient()

    // 1. Fetch active listings from eBay
    const ebayListings = await getActiveListings(orgId)

    if (ebayListings.length === 0) return ok({ data: [], count: 0 })

    // 2. Load cards that have an ebay_listing_id set — to enrich eBay data
    const listingIds = ebayListings.map(l => l.listingId)
    const { data: cards } = await supabase
      .from('cards')
      .select('id, card_name, set_code, condition, purchase_price, ebay_listing_id')
      .eq('org_id', orgId)
      .in('ebay_listing_id', listingIds)

    const cardsByListingId = Object.fromEntries(
      (cards ?? []).map(c => [c['ebay_listing_id'] as string, c]),
    )

    // 3. Merge eBay data with local card data
    const enriched = ebayListings.map(listing => {
      const card = cardsByListingId[listing.listingId]
      return {
        ...listing,
        card_id:        card?.['id']             ?? null,
        card_name:      card?.['card_name']       ?? listing.title,
        set_code:       card?.['set_code']        ?? null,
        condition:      card?.['condition']       ?? null,
        purchase_price: card?.['purchase_price']  ?? null,
      }
    })

    return ok({ data: enriched, count: enriched.length })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
