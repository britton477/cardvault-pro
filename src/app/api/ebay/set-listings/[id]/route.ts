// =============================================================================
// PATCH  /api/ebay/set-listings/[id] — add cards or sync quantities
// DELETE /api/ebay/set-listings/[id] — end eBay listing + reset all cards
//
// [id] is the ebay_set_listings.id (UUID), not the eBay ItemID.
//
// PATCH actions:
//   { action: 'add_cards', card_ids: [] }  — add new variations to the listing
//   { action: 'sync' }                      — compare eBay qty vs DB, return diffs
//
// DELETE: calls endItem → sets listing status='ended' → resets all variation
//         cards to In Stock (clears listing_type, ebay_set_listing_id, etc.)
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  requireAuth, ok, noContent, notFound, serverError, validationError, badRequest,
} from '@/lib/api'
import {
  addVariationsToListing,
  syncVariationQuantities,
  endItem,
  EBAY_MAX_VARIATIONS,
  EBAY_IS_SANDBOX,
  type VariationInput,
} from '@/lib/ebay'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { SetListingActionSchema } from '@/types/validation'

interface Ctx { params: Promise<{ id: string }> }

// ── Helper: build display names (deduplicates card names within a set) ────────
function buildDisplayNames(
  cards: Array<{ id: string; card_name: string; card_number: string }>,
): Map<string, string> {
  const nameCount = new Map<string, number>()
  for (const c of cards) nameCount.set(c.card_name, (nameCount.get(c.card_name) ?? 0) + 1)

  const result = new Map<string, string>()
  for (const c of cards) {
    const isDup = (nameCount.get(c.card_name) ?? 0) > 1
    result.set(c.id, isDup && c.card_number ? `${c.card_name} #${c.card_number}` : c.card_name)
  }
  return result
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list' })
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = SetListingActionSchema.parse(body)

    const supabase = await createClient()
    const admin    = createAdminClient()

    // Load the set listing with its variation cards via FK
    // cards.ebay_set_listing_id → ebay_set_listings.id
    const { data: setListing } = await supabase
      .from('ebay_set_listings')
      .select('*, variations:cards!ebay_set_listing_id(id, card_name, card_number, qty, listed_price)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!setListing) return notFound('Set listing not found')
    if (setListing['status'] === 'ended') {
      return badRequest('This listing has ended and can no longer be modified')
    }

    // Environment guard — a listing created in sandbox has an item ID that only
    // exists in sandbox. Acting on it while pointed at production would send
    // revise/end calls for a nonexistent item to a live seller account (and
    // vice versa). Refuse rather than let the two environments cross.
    const listingEnv = (setListing['environment'] as string | null) ?? 'production'
    const currentEnv = EBAY_IS_SANDBOX ? 'sandbox' : 'production'
    if (listingEnv !== currentEnv) {
      return badRequest(
        `This listing was created in eBay ${listingEnv}, but the app is currently connected to ${currentEnv}. Switch EBAY_ENV back to ${listingEnv} to manage it.`,
        'environment_mismatch',
      )
    }

    const ebayListingId = setListing['ebay_listing_id'] as string
    const existingCards = (setListing['variations'] as Array<{
      id: string; card_name: string; card_number: string; qty: number; listed_price: number | null
    }>) ?? []

    // ── action: add_cards ─────────────────────────────────────────────────────
    if (input.action === 'add_cards') {
      // Load the new cards
      const { data: newCards } = await supabase
        .from('cards')
        .select('id, card_name, card_number, listed_price, qty, ebay_set_listing_id')
        .in('id', input.card_ids)
        .eq('org_id', orgId)
        .is('deleted_at', null)

      if (!newCards?.length) return badRequest('No valid cards found for the provided IDs')

      const unpriced = newCards.filter(c => !c['listed_price'])
      if (unpriced.length > 0) {
        return badRequest(
          `${unpriced.length} card(s) have no listed price. Set a price before adding to a set listing.`,
        )
      }

      // eBay hard-caps a listing at 250 variations. Check the COMBINED total —
      // createVariationListing only validates its own batch, so without this an
      // add_cards call could push an existing 240-variation listing to 260 and
      // be rejected by eBay after the DB had already been updated.
      const combined = existingCards.length + newCards.length
      if (combined > EBAY_MAX_VARIATIONS) {
        const room = Math.max(0, EBAY_MAX_VARIATIONS - existingCards.length)
        return badRequest(
          room === 0
            ? `This listing is at eBay's ${EBAY_MAX_VARIATIONS}-variation limit. Create a second set listing for the remaining cards.`
            : `Adding ${newCards.length} cards would exceed eBay's ${EBAY_MAX_VARIATIONS}-variation limit. You can add up to ${room} more.`,
        )
      }

      // Cards already in a set listing must not be added to another — the same
      // physical stock would be advertised twice.
      const alreadyInSet = newCards.filter(c => c['ebay_set_listing_id'])
      if (alreadyInSet.length > 0) {
        return badRequest(
          `${alreadyInSet.length} card(s) already belong to a set listing. Remove them from that listing first.`,
        )
      }

      // Build display names across all cards (existing + new) to detect collisions
      const allCards = [
        ...existingCards.map(c => ({ id: c.id, card_name: c.card_name, card_number: c.card_number })),
        ...newCards.map(c => ({ id: c['id'] as string, card_name: c['card_name'] as string, card_number: c['card_number'] as string })),
      ]
      const displayNames = buildDisplayNames(allCards)

      const existingNames = existingCards.map(c =>
        displayNames.get(c.id) ?? c.card_name,
      )

      const newVariations: VariationInput[] = newCards.map(c => ({
        sku:         c['id'] as string,
        displayName: displayNames.get(c['id'] as string) ?? (c['card_name'] as string),
        price:       c['listed_price'] as number,
        quantity:    c['qty'] as number,
      }))

      // Push to eBay
      await addVariationsToListing(orgId, ebayListingId, newVariations, existingNames)

      // Update all added cards in DB
      await admin
        .from('cards')
        .update({
          status:              'Listed',
          listed_on:           'eBay',
          listing_type:        'variation',
          ebay_set_listing_id: id,
          last_edited_by:      user.id,
        })
        .in('id', input.card_ids)
        .eq('org_id', orgId)

      // Update variation_count on the set listing
      const newCount = existingCards.length + newCards.length
      await admin
        .from('ebay_set_listings')
        .update({
          variation_count: newCount,
          last_synced_at:  new Date().toISOString(),
        })
        .eq('id', id)

      void writeAuditLog({
        orgId, userId: user.id,
        action:     'ebay_set_listing.add_cards',
        entityType: 'ebay_set_listing',
        entityId:   id,
        after: { added_card_ids: input.card_ids, new_variation_count: newCount } as Record<string, unknown>,
      })
      void invalidateCache(`dashboard:${orgId}`)

      return ok({ added: newCards.length, variation_count: newCount })
    }

    // ── action: sync ─────────────────────────────────────────────────────────
    if (input.action === 'sync') {
      const dbVariations = existingCards.map(c => ({
        sku:         c.id,
        displayName: c.card_name,
        qty:         c.qty,
      }))

      const discrepancies = await syncVariationQuantities(orgId, ebayListingId, dbVariations)

      // Update last_synced_at regardless
      await admin
        .from('ebay_set_listings')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', id)

      return ok({
        synced_at:     new Date().toISOString(),
        discrepancies,
        in_sync:       discrepancies.length === 0,
      })
    }

    // ── action: accept_ebay_quantities ───────────────────────────────────────
    // Resolve discrepancies by trusting eBay's numbers. Runs entirely server-side
    // in one request: N client-side card PATCHes would each re-trigger the
    // variation qty push hook and waste eBay quota pushing values eBay already has.
    //
    // A card dropping to qty 0 sold out — mark it Sold so it leaves active stock.
    if (input.action === 'accept_ebay_quantities') {
      // Only allow updates to cards that actually belong to this set listing
      const ownedIds = new Set(existingCards.map(c => c.id))
      const valid    = input.updates.filter(u => ownedIds.has(u.card_id))

      if (valid.length === 0) {
        return badRequest('None of the provided cards belong to this set listing')
      }

      for (const { card_id, qty } of valid) {
        await admin
          .from('cards')
          .update({
            qty,
            ...(qty === 0 ? { status: 'Sold' as const } : {}),
            last_edited_by: user.id,
          })
          .eq('id', card_id)
          .eq('org_id', orgId)
      }

      await admin
        .from('ebay_set_listings')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', id)

      void writeAuditLog({
        orgId, userId: user.id,
        action:     'ebay_set_listing.accept_ebay_quantities',
        entityType: 'ebay_set_listing',
        entityId:   id,
        after: { updates: valid } as unknown as Record<string, unknown>,
      })
      void invalidateCache(`dashboard:${orgId}`)

      return ok({
        applied:   valid.length,
        sold_out:  valid.filter(u => u.qty === 0).length,
      })
    }

    return badRequest('Unknown action')
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list', role: 'owner' })
    const { id }          = await params

    const supabase = await createClient()
    const admin    = createAdminClient()

    // Load the set listing
    const { data: setListing } = await supabase
      .from('ebay_set_listings')
      .select('id, ebay_listing_id, status, environment')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!setListing) return notFound('Set listing not found')

    // Environment guard — see PATCH. Ending is destructive on both sides, so
    // this must not run against the wrong eBay account.
    const listingEnv = (setListing['environment'] as string | null) ?? 'production'
    const currentEnv = EBAY_IS_SANDBOX ? 'sandbox' : 'production'
    if (listingEnv !== currentEnv) {
      return badRequest(
        `This listing was created in eBay ${listingEnv}, but the app is currently connected to ${currentEnv}. Switch EBAY_ENV back to ${listingEnv} to end it.`,
        'environment_mismatch',
      )
    }

    const ebayListingId = setListing['ebay_listing_id'] as string

    // End the listing on eBay (idempotent — won't throw if already ended)
    if (setListing['status'] !== 'ended') {
      try {
        await endItem(orgId, ebayListingId, 'NotAvailable')
      } catch (err) {
        // If eBay says it's already ended, continue with local cleanup
        const msg = err instanceof Error ? err.message.toLowerCase() : ''
        if (!msg.includes('already ended') && !msg.includes('invalid item')) throw err
      }
    }

    // Mark listing as ended
    await admin
      .from('ebay_set_listings')
      .update({ status: 'ended' })
      .eq('id', id)

    // Reset all variation cards back to In Stock
    await admin
      .from('cards')
      .update({
        status:              'In Stock',
        listed_on:           null,
        listing_type:        null,
        ebay_set_listing_id: null,
        last_edited_by:      user.id,
      })
      .eq('org_id', orgId)
      .eq('ebay_set_listing_id', id)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'ebay_set_listing.end',
      entityType: 'ebay_set_listing',
      entityId:   id,
      before: { ebay_listing_id: ebayListingId, status: setListing['status'] } as Record<string, unknown>,
      after:  { status: 'ended' } as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
