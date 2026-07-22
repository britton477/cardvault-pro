// =============================================================================
// POST /api/ebay/set-listings — create a multi-variation "Complete Your Set" listing
// GET  /api/ebay/set-listings — list all set listings for the org
//
// POST body: CreateSetListingSchema
// Returns: { set_listing: EbaySetListing }
//
// The caller passes card_ids — we load their prices and names, call
// createVariationListing, then write the ebay_set_listings row and
// update all cards (listing_type='variation', ebay_set_listing_id, status='Listed').
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  requireAuth, ok, created, serverError, validationError, badRequest,
} from '@/lib/api'
import {
  createVariationListing,
  buildUniqueDisplayNames,
  EBAY_MAX_VARIATIONS,
  EBAY_IS_SANDBOX,
  type VariationInput,
} from '@/lib/ebay'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { CreateSetListingSchema } from '@/types/validation'
import { plainTextToEbayHtml } from '@/lib/listing-templates'

// Display names come from buildUniqueDisplayNames() in lib/ebay.ts — shared
// with the add-cards route so both produce identical labels, and guaranteed
// unique because eBay rejects repeated variation values outright.

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list' })
    const body  = await request.json() as unknown
    const input = CreateSetListingSchema.parse(body)

    const supabase = await createClient()
    const admin    = createAdminClient()

    // ── Load org settings for policy IDs + location ───────────────────────────
    const { data: settings } = await supabase
      .from('org_settings')
      .select('*')
      .eq('org_id', orgId)
      .single()

    if (!settings) return badRequest('Org settings not found')

    const fulfillmentPolicyId =
      input.fulfillment_policy_id ??
      (settings['ebay_fulfillment_policy_id'] as string | null)
    const paymentPolicyId =
      input.payment_policy_id ??
      (settings['ebay_payment_policy_id'] as string | null)
    const returnPolicyId =
      input.return_policy_id ??
      (settings['ebay_return_policy_id'] as string | null)

    if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
      return badRequest('eBay business policy IDs are not configured in Settings → eBay')
    }

    // ── Load requested cards ──────────────────────────────────────────────────
    // Photos are joined here because eBay requires at least one image on the
    // listing, and per-variation images let the buyer see the actual card they
    // are selecting rather than a generic gallery shot.
    const { data: cards, error: cardsErr } = await supabase
      .from('cards')
      .select('id, card_name, card_number, foil_type, condition, listed_price, qty, ebay_set_listing_id, photos:card_photos(url, thumb_url, position)')
      .in('id', input.card_ids)
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (cardsErr || !cards?.length) {
      return badRequest('No valid cards found for the provided IDs')
    }

    // Reject if any card has no listed_price — every variation needs a price
    const unpriced = cards.filter(c => !c['listed_price'])
    if (unpriced.length > 0) {
      return badRequest(
        `${unpriced.length} card(s) have no listed price. Set a price on each card before creating a set listing.`,
      )
    }

    // eBay's hard ceiling — checked here so the user gets a clear message rather
    // than a raw eBay API rejection.
    if (cards.length > EBAY_MAX_VARIATIONS) {
      return badRequest(
        `eBay limits a listing to ${EBAY_MAX_VARIATIONS} variations. Split this into multiple set listings.`,
      )
    }

    // Cards already inside another set listing would be advertised twice
    const alreadyInSet = cards.filter(c => c['ebay_set_listing_id'])
    if (alreadyInSet.length > 0) {
      return badRequest(
        `${alreadyInSet.length} card(s) already belong to a set listing. Remove them from that listing first.`,
      )
    }

    // ── Build variation display names (deduplicates by appending card number) ─
    const displayNames = buildUniqueDisplayNames(
      cards as unknown as Array<{
        id: string; card_name: string; card_number?: string | null
        foil_type?: string | null; condition?: string | null
      }>,
    )

    /** Primary photo for a card — lowest position wins, full-size over thumbnail */
    function primaryPhoto(card: Record<string, unknown>): string | undefined {
      const photos = (card['photos'] as Array<{ url: string; thumb_url: string | null; position: number }> | null) ?? []
      if (photos.length === 0) return undefined
      const sorted = [...photos].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      return sorted[0]?.url ?? sorted[0]?.thumb_url ?? undefined
    }

    const variations: VariationInput[] = cards.map(c => ({
      sku:         c['id'] as string,
      displayName: displayNames.get(c['id'] as string) ?? (c['card_name'] as string),
      price:       c['listed_price'] as number,
      quantity:    c['qty'] as number,
      photoUrl:    primaryPhoto(c as Record<string, unknown>),
    }))

    // eBay rejects a listing with no images at all (21919136). A cover image
    // satisfies that on its own, so this only fires when there is nothing at all.
    const withPhotos = variations.filter(v => v.photoUrl).length
    if (withPhotos === 0 && !input.cover_image_url) {
      return badRequest(
        'eBay requires at least one photo. None of these cards have an image yet — ' +
        'add a cover image, or a photo to at least one card.',
        'no_photos',
      )
    }

    // ── Create the eBay variation listing ─────────────────────────────────────
    const { ebayListingId, itemUrl } = await createVariationListing({
      orgId,
      title:               input.title,
      // The description is authored and stored as plain text so it stays
      // editable in a textarea. eBay renders HTML, so convert on the way out —
      // otherwise every newline collapses and it reads as one long blob.
      description:         plainTextToEbayHtml(
        input.description,
        (settings['shop_name'] as string | null) ?? undefined,
      ),
      condition:           input.condition,
      setCode:             input.set_code || undefined,
      variations,
      // A cover image leads the gallery when supplied. Without one the gallery
      // falls back to the variation card photos inside createVariationListing.
      photoUrls:           input.cover_image_url ? [input.cover_image_url] : [],
      location:            (settings['item_location'] as string | null) ?? 'United Kingdom',
      fulfillmentPolicyId,
      paymentPolicyId,
      returnPolicyId,
    })

    // ── Persist to ebay_set_listings ──────────────────────────────────────────
    const { data: setListing, error: insertErr } = await admin
      .from('ebay_set_listings')
      .insert({
        org_id:          orgId,
        ebay_listing_id: ebayListingId,
        set_code:        input.set_code,
        condition:       input.condition,
        title:           input.title,
        ebay_url:        itemUrl,
        variation_count: cards.length,
        status:          'active',
        // Stamp the environment that actually created this listing. Flipping
        // EBAY_ENV later must not make a sandbox listing look like a live one.
        environment:     EBAY_IS_SANDBOX ? 'sandbox' : 'production',
        last_synced_at:  new Date().toISOString(),
      })
      .select()
      .single()

    if (insertErr || !setListing) {
      // eBay listing was created but DB write failed — log and return partial success
      console.error('[set-listings POST] DB insert failed after eBay listing created:', insertErr)
      return serverError(new Error('eBay listing created but failed to save to database. Note your eBay Item ID: ' + ebayListingId))
    }

    // ── Mark all cards as Listed / variation ─────────────────────────────────
    await admin
      .from('cards')
      .update({
        status:              'Listed',
        listed_on:           'eBay',
        listing_type:        'variation',
        ebay_set_listing_id: setListing['id'],
        last_edited_by:      user.id,
      })
      .in('id', input.card_ids)
      .eq('org_id', orgId)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'ebay_set_listing.create',
      entityType: 'ebay_set_listing',
      entityId:   setListing['id'] as string,
      after:      {
        ebay_listing_id: ebayListingId,
        card_count:      cards.length,
        set_code:        input.set_code,
        condition:       input.condition,
      } as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return created({ set_listing: setListing })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function GET(_request: NextRequest) {
  try {
    const { orgId } = await requireAuth({ feature: 'ebay.bulk_list' })
    const supabase  = await createClient()

    // Return all set listings with variation cards joined via the FK
    // cards.ebay_set_listing_id → ebay_set_listings.id
    const { data, error } = await supabase
      .from('ebay_set_listings')
      .select(`
        *,
        variations:cards!ebay_set_listing_id(id, card_name, card_number, qty, listed_price)
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (error) return serverError(error)

    return ok(data ?? [])
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
