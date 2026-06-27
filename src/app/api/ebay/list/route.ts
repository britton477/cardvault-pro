// =============================================================================
// POST /api/ebay/list — list one or more cards on eBay
// Body: { listings: [{ card_id, list_price }] }
// Returns: { results: EbayListingResult[] }
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { listItem } from '@/lib/ebay'
import { EbayBulkListSchema } from '@/types/validation'
import type { EbayListingResult } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()
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
      input.listings.map(async ({ card_id, list_price }) => {
        // Load card with photos
        const { data: card } = await supabase
          .from('cards')
          .select('*, photos:card_photos(*)')
          .eq('id', card_id)
          .eq('org_id', orgId)
          .single()

        if (!card) throw new Error('Card not found')

        const photoUrls = (card['card_photos'] as Array<{ url: string }> ?? [])
          .map((p) => p.url)

        const title = [
          card['card_name'],
          card['set_code'],
          card['card_number'],
          card['condition'],
          card['foil_type'] !== 'Normal' ? card['foil_type'] : '',
          card['is_graded'] ? `${card['grader']} ${card['grade']}` : '',
        ].filter(Boolean).join(' ').slice(0, 80)

        const description = `${card['card_name']} — ${card['set_code']} #${card['card_number']}
Condition: ${card['condition']}
${card['foil_type'] !== 'Normal' ? 'Foil: ' + card['foil_type'] : ''}
${card['is_graded'] ? `Graded: ${card['grader']} ${card['grade']}` : ''}
${card['notes'] ? '\n' + card['notes'] : ''}

Listed via CardVault Pro`

        const listingId = await listItem({
          orgId,
          title,
          description,
          condition:            card['condition'] as string,
          price:                list_price,
          quantity:             1,
          photoUrls,
          location:             settings['item_location'] as string ?? 'United Kingdom',
          fulfillmentPolicyId:  settings['ebay_fulfillment_policy_id'] as string,
          paymentPolicyId:      settings['ebay_payment_policy_id'] as string,
          returnPolicyId:       settings['ebay_return_policy_id'] as string,
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
