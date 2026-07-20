// =============================================================================
// POST /api/ebay/bulk-list
//
// Lists multiple cards on eBay from the BulkActionBar selection.
// Prices are pulled from cards.listed_price — cards without a price are
// returned in `skipped` so the user can set prices and retry.
//
// Cards are processed SEQUENTIALLY (not Promise.allSettled in parallel)
// to respect eBay's API rate limits. With 50 cards this is slower but safe.
//
// Returns:
//   succeeded: [{ card_id, card_name, listing_id }]
//   failed:    [{ card_id, card_name, error }]
//   skipped:   [{ card_id, card_name, reason }]
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'

// Sequential eBay listing: ~1.5s per card × 100 cards per chunk = ~150s.
// Pro plan allows up to 800s — gives headroom for the largest batches we support.
export const maxDuration = 800
import { createAdminClient }            from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { listItem, getCredentials, buildListingTitle, buildListingDescription } from '@/lib/ebay'
import { writeAuditLog }                from '@/lib/audit'
import { BulkEbayListSchema }           from '@/types/validation'

interface SuccessResult { card_id: string; card_name: string; listing_id: string }
interface FailedResult  { card_id: string; card_name: string; error: string      }
interface SkippedResult { card_id: string; card_name: string; reason: string     }

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list' })
    const body  = await request.json() as unknown
    const input = BulkEbayListSchema.parse(body)

    const db = createAdminClient()

    // ── Verify eBay is connected ───────────────────────────────────────────────
    const creds = await getCredentials(orgId).catch(() => null)
    if (!creds?.accessToken || !creds?.refreshToken) {
      return ok({
        succeeded: [],
        failed:    [],
        skipped:   input.card_ids.map(id => ({
          card_id:   id,
          card_name: 'Unknown',
          reason:    'eBay not connected',
        })),
        ebay_not_connected: true,
      })
    }

    // ── Load org settings (policy IDs) ─────────────────────────────────────────
    const { data: settings } = await db
      .from('org_settings')
      .select('*')
      .eq('org_id', orgId)
      .single()

    if (!settings?.ebay_fulfillment_policy_id) {
      return serverError(new Error('eBay policy IDs not configured in Settings'))
    }

    // ── Load cards ─────────────────────────────────────────────────────────────
    const { data: cards, error: cardsErr } = await db
      .from('cards')
      .select('*, photos:card_photos(url, position)')
      .in('id', input.card_ids)
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (cardsErr) throw cardsErr

    const cardMap = new Map((cards ?? []).map(c => [c.id as string, c]))

    const succeeded: SuccessResult[] = []
    const failed:    FailedResult[]  = []
    const skipped:   SkippedResult[] = []

    // ── Process sequentially ──────────────────────────────────────────────────
    for (const card_id of input.card_ids) {
      const card = cardMap.get(card_id)

      // Not found in org
      if (!card) {
        skipped.push({ card_id, card_name: 'Unknown', reason: 'Card not found' })
        continue
      }

      const card_name = card.card_name as string

      // Already listed as a single
      if (card.status === 'Listed' && card.ebay_listing_id) {
        skipped.push({ card_id, card_name, reason: 'Already listed on eBay' })
        continue
      }

      // Already part of a multi-variation set listing.
      //
      // These cards carry status='Listed' but ebay_listing_id is NULL — they link
      // via ebay_set_listing_id instead — so the check above does not catch them.
      // Without this guard the same physical card gets a second, independent eBay
      // listing: two buyers can purchase stock you only hold once.
      if (card.listing_type === 'variation' && card.ebay_set_listing_id) {
        skipped.push({ card_id, card_name, reason: 'Already in a set listing' })
        continue
      }

      // No price set
      if (!card.listed_price) {
        skipped.push({ card_id, card_name, reason: 'No price set — use Set Price first' })
        continue
      }

      // Attempt listing
      try {
        const photoUrls = ((card.photos ?? []) as Array<{ url: string; position: number }>)
          .sort((a, b) => a.position - b.position)
          .map(p => p.url)
        const listPrice = card.listed_price as number

        const cardData = {
          card_name:   card.card_name   as string,
          set_code:    card.set_code    as string,
          card_number: card.card_number as string | null,
          condition:   card.condition   as string,
          foil_type:   card.foil_type   as string | null,
          is_graded:   card.is_graded   as boolean,
          grader:      card.grader      as string | null,
          grade:       card.grade       as string | null,
          notes:       card.notes       as string | null,
        }

        const title       = buildListingTitle(cardData)
        const description = buildListingDescription(
          cardData,
          listPrice,
          (settings.shop_name as string | null) ?? 'VaultHunters TCG',
        )

        // Select fulfillment policy: tracked (£20+) vs standard (under £20)
        const fulfillmentPolicyId = listPrice >= 20
          ? ((settings.ebay_fulfillment_policy_id_high as string | null) ?? (settings.ebay_fulfillment_policy_id as string))
          : (settings.ebay_fulfillment_policy_id as string)

        const listingId = await listItem({
          orgId,
          // SKU = card UUID, so eBay order sync can always resolve the card
          sku:                 card_id,
          title,
          description,
          condition:           card.condition   as string,
          isGraded:            (card.is_graded  as boolean) ?? false,
          grader:              card.grader      as string | null,
          grade:               card.grade       as string | null,
          price:               listPrice,
          quantity:            1,
          photoUrls,
          location:            (settings.item_location as string | null) ?? 'United Kingdom',
          fulfillmentPolicyId,
          paymentPolicyId:     settings.ebay_payment_policy_id as string,
          returnPolicyId:      settings.ebay_return_policy_id  as string,
        })

        // Update card record
        await db
          .from('cards')
          .update({
            status:          'Listed',
            listed_on:       'eBay',
            ebay_listing_id: listingId,
            last_edited_by:  user.id,
            updated_at:      new Date().toISOString(),
          })
          .eq('id', card_id)

        succeeded.push({ card_id, card_name, listing_id: listingId })
      } catch (err) {
        failed.push({
          card_id,
          card_name,
          error: err instanceof Error ? err.message : 'Listing failed',
        })
      }
    }

    // ── Audit log ──────────────────────────────────────────────────────────────
    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'ebay.bulk_list',
      entityType: 'card',
      after: {
        succeeded: succeeded.length,
        failed:    failed.length,
        skipped:   skipped.length,
        ids:       input.card_ids,
      },
    })

    return ok({ succeeded, failed, skipped })
  } catch (err) {
    if (err instanceof ZodError)  return validationError(err)
    if (err instanceof Response)  return err
    return serverError(err)
  }
}
