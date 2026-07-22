// =============================================================================
// POST /api/ebay/list — list one or more cards on eBay
// Body: { listings: [{ card_id, list_price }] }
// Returns: { results: EbayListingResult[] }
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { listItem, buildListingTitle, buildListingDescription } from '@/lib/ebay'
import { EbayBulkListSchema } from '@/types/validation'
import type { EbayListingResult } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list' })
    const body   = await request.json() as unknown
    const input  = EbayBulkListSchema.parse(body)

    const supabase = await createClient()

    // Load org settings for eBay policy IDs
    const { data: settings } = await supabase
      .from('org_settings')
      .select('*')
      .eq('org_id', orgId)
      .single()

    if (!settings?.ebay_fulfillment_policy_id) {
      return serverError(new Error('eBay policy IDs not configured in settings'))
    }

    const results: EbayListingResult[] = await Promise.allSettled(
      input.listings.map(async ({ card_id, list_price, quantity }) => {
        // Load card with photos
        const { data: card } = await supabase
          .from('cards')
          .select('*, photos:card_photos(*)')
          .eq('id', card_id)
          .eq('org_id', orgId)
          .single()

        if (!card) throw new Error('Card not found')

        // Guard: card already sold on eBay inside a multi-variation set listing.
        // Listing it again as a single would double-list stock held only once.
        if (card['listing_type'] === 'variation' && card['ebay_set_listing_id']) {
          throw new Error('Card is already part of a set listing — manage it from the Set Listings tab')
        }

        const photoUrls = (card['photos'] as Array<{ url: string }> ?? [])
          .map((p) => p.url)

        const cardData = {
          card_name:   card['card_name']   as string,
          set_code:    card['set_code']    as string,
          card_number: card['card_number'] as string | null,
          condition:   card['condition']   as string,
          foil_type:   card['foil_type']   as string | null,
          is_graded:   card['is_graded']   as boolean,
          grader:      card['grader']      as string | null,
          grade:       card['grade']       as string | null,
          notes:       card['notes']       as string | null,
        }

        const title       = buildListingTitle(cardData)
        const description = buildListingDescription(
          cardData,
          list_price,
          (settings['shop_name'] as string | null) ?? 'VaultHunters TCG',
        )

        // Select fulfillment policy: tracked (£20+) vs standard (under £20)
        const fulfillmentPolicyId = list_price >= 20
          ? ((settings['ebay_fulfillment_policy_id_high'] as string | null) ?? (settings['ebay_fulfillment_policy_id'] as string))
          : (settings['ebay_fulfillment_policy_id'] as string)

        const listingId = await listItem({
          orgId,
          // SKU = card UUID, so eBay order sync can always resolve the card
          sku:                  card_id,
          title,
          description,
          condition:            card['condition'] as string,
          isGraded:             (card['is_graded'] as boolean) ?? false,
          grader:               card['grader'] as string | null,
          grade:                card['grade']  as string | null,
          price:                list_price,
          // Advertise the stock actually held, not a hardcoded 1. Capped at the
          // card's quantity so a listing can never promise more than exists.
          quantity:             Math.max(1, Math.min(
            quantity ?? (card['qty'] as number | null) ?? 1,
            (card['qty'] as number | null) ?? 1,
          )),
          photoUrls,
          location:             (settings['item_location'] as string | null) ?? 'United Kingdom',
          fulfillmentPolicyId,
          paymentPolicyId:      settings['ebay_payment_policy_id'] as string,
          returnPolicyId:       settings['ebay_return_policy_id']  as string,
          // Item specifics for better eBay search indexing
          cardName:             card['card_name']   as string | null,
          setCode:              card['set_code']    as string | null,
          cardNumber:           card['card_number'] as string | null,
          language:             card['language']    as string | null,
        })

        // Update card status + listing info
        await supabase.from('cards').update({
          status:           'Listed',
          listed_price:     list_price,
          listed_on:        'eBay',
          ebay_listing_id:  listingId,
          last_edited_by:   user.id,
        }).eq('id', card_id)

        return { card_id, success: true, listing_id: listingId }
      }),
    ).then(results =>
      results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { card_id: input.listings[i]!.card_id, success: false, error: (r.reason as Error).message },
      ),
    )

    return ok({ results })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
