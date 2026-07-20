// =============================================================================
// PATCH /api/ebay/listings/[id]  — revise listing price on eBay
// DELETE /api/ebay/listings/[id] — end listing on eBay + reset card to In Stock
// [id] is the eBay listing ID (ItemID), not the card UUID.
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { createClient }     from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError, badRequest } from '@/lib/api'
import { reviseItem, endItem }  from '@/lib/ebay'
import { writeAuditLog }        from '@/lib/audit'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

interface Ctx { params: Promise<{ id: string }> }

const ReviseSchema = z.object({
  price: z.number().min(0.01).max(99999),
})

/**
 * Guard: these endpoints operate on single-card listings only.
 *
 * A multi-variation set listing routed here would cause real damage:
 *   - PATCH  sends ReviseItem with a single StartPrice, which eBay rejects for
 *            variation listings (and would be semantically wrong anyway — each
 *            variation carries its own price).
 *   - DELETE resets cards WHERE ebay_listing_id = <id>. Variation cards link via
 *            ebay_set_listing_id, so zero rows match: the eBay listing ends but
 *            every card stays marked 'Listed' against a listing that no longer
 *            exists — silent inventory corruption.
 *
 * Returns the set listing UUID when the ID belongs to a set listing, else null.
 */
async function findSetListing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  ebayListingId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('ebay_set_listings')
    .select('id')
    .eq('org_id', orgId)
    .eq('ebay_listing_id', ebayListingId)
    .maybeSingle()
  return (data?.['id'] as string | undefined) ?? null
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list' })
    const { id: listingId } = await params

    const limit = await rateLimit(request, 'ebay-revise', { max: 20, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const body  = await request.json() as unknown
    const input = ReviseSchema.parse(body)

    const supabase = await createClient()

    // Reject set listings — see findSetListing() for why this matters
    const setListingId = await findSetListing(supabase, orgId, listingId)
    if (setListingId) {
      return badRequest(
        'This is a multi-variation set listing. Revise variation prices via the Set Listings tab.',
        'is_set_listing',
      )
    }

    // Revise on eBay
    await reviseItem(orgId, listingId, input.price)

    // Update local card's listed_price
    const { data: card } = await supabase
      .from('cards')
      .update({ listed_price: input.price })
      .eq('org_id', orgId)
      .eq('ebay_listing_id', listingId)
      .select('id, card_name')
      .maybeSingle()

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'card.update',
      entityType: 'card',
      entityId:   card?.['id'] ?? listingId,
      after:      { listed_price: input.price, ebay_listing_id: listingId } as Record<string, unknown>,
    })

    return ok({ listing_id: listingId, price: input.price })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list', role: 'owner' })
    const { id: listingId } = await params

    const limit = await rateLimit(request, 'ebay-end', { max: 10, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const supabase = await createClient()

    // Reject set listings — ending one here would orphan every variation card
    // as 'Listed' against a dead listing. See findSetListing() for detail.
    const setListingId = await findSetListing(supabase, orgId, listingId)
    if (setListingId) {
      return badRequest(
        'This is a multi-variation set listing. End it via the Set Listings tab so all its cards are returned to stock.',
        'is_set_listing',
      )
    }

    // End on eBay
    await endItem(orgId, listingId, 'NotAvailable')

    // Reset card to In Stock
    const { data: card } = await supabase
      .from('cards')
      .update({
        status:          'In Stock',
        listed_price:    null,
        listed_on:       null,
        ebay_listing_id: null,
      })
      .eq('org_id', orgId)
      .eq('ebay_listing_id', listingId)
      .select('id, card_name')
      .maybeSingle()

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'card.update',
      entityType: 'card',
      entityId:   card?.['id'] ?? listingId,
      before:     { status: 'Listed', ebay_listing_id: listingId } as Record<string, unknown>,
      after:      { status: 'In Stock', ebay_listing_id: null }    as Record<string, unknown>,
    })

    return ok({ listing_id: listingId, ended: true })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
