// =============================================================================
// GET /api/ebay/listings
// Fetches active eBay listings via GetMyeBaySelling and cross-references with
// the cards table to enrich each listing with local card data.
// =============================================================================
import { requireAuth, ok, serverError } from '@/lib/api'
import { getActiveListings } from '@/lib/ebay'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { type NextRequest, NextResponse } from 'next/server'

// Error messages thrown by ebay.ts when OAuth is not set up
const NOT_CONNECTED_PHRASES = [
  'not connected',
  'credentials not configured',
  'refresh token missing',
]

function isNotConnectedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  return NOT_CONNECTED_PHRASES.some(phrase => msg.includes(phrase))
}

export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(request, 'ebay-listings-sync', { max: 10, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const { orgId } = await requireAuth()
    const supabase  = await createClient()

    // 1. Fetch active listings from eBay
    const ebayListings = await getActiveListings(orgId)

    if (ebayListings.length === 0) return ok({ data: [], count: 0 })

    const listingIds = ebayListings.map(l => l.listingId)

    // 2. Load single-card listings — enriches eBay data with local card info
    const { data: cards } = await supabase
      .from('cards')
      .select('id, card_name, set_code, condition, purchase_price, ebay_listing_id')
      .eq('org_id', orgId)
      .in('ebay_listing_id', listingIds)

    const cardsByListingId = Object.fromEntries(
      (cards ?? []).map(c => [c['ebay_listing_id'] as string, c]),
    )

    // 3. Load multi-variation set listings.
    //
    // IMPORTANT: set listings must be flagged, not treated as singles. Their
    // variation cards link via cards.ebay_set_listing_id (not ebay_listing_id),
    // so they'd otherwise appear here as unmatched rows where:
    //   - inline price revise would send ReviseItem/StartPrice → invalid on a
    //     variation listing and rejected by eBay
    //   - "End" would reset cards WHERE ebay_listing_id = <id>, matching zero
    //     variation cards and orphaning them as 'Listed' against a dead listing
    // The UI routes anything flagged here to the Set Listings tab instead.
    const { data: setListings } = await supabase
      .from('ebay_set_listings')
      .select('id, ebay_listing_id, set_code, condition, title, variation_count')
      .eq('org_id', orgId)
      .in('ebay_listing_id', listingIds)

    const setListingByEbayId = Object.fromEntries(
      (setListings ?? []).map(s => [s['ebay_listing_id'] as string, s]),
    )

    // 4. Merge eBay data with local card / set-listing data
    const enriched = ebayListings.map(listing => {
      const setListing = setListingByEbayId[listing.listingId]

      if (setListing) {
        return {
          ...listing,
          is_set_listing:  true,
          set_listing_id:  setListing['id']              as string,
          card_id:         null,
          card_name:       setListing['title']           as string,
          set_code:        setListing['set_code']        as string | null,
          condition:       setListing['condition']       as string | null,
          purchase_price:  null,
          variation_count: setListing['variation_count'] as number,
        }
      }

      const card = cardsByListingId[listing.listingId]
      return {
        ...listing,
        is_set_listing: false,
        set_listing_id: null,
        card_id:        card?.['id']             ?? null,
        card_name:      card?.['card_name']      ?? listing.title,
        set_code:       card?.['set_code']       ?? null,
        condition:      card?.['condition']      ?? null,
        purchase_price: card?.['purchase_price'] ?? null,
      }
    })

    return ok({ data: enriched, count: enriched.length })
  } catch (err) {
    if (err instanceof Response) return err
    if (isNotConnectedError(err)) {
      return NextResponse.json(
        { error: 'ebay_not_connected', message: 'eBay account not connected. Go to Settings → eBay to connect.' },
        { status: 422 },
      )
    }
    return serverError(err)
  }
}
