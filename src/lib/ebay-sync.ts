// =============================================================================
// CardVault Pro — Set listing quantity push with failure recovery
//
// Quantity pushes to eBay are deliberately fire-and-forget: the database is the
// source of truth for stock, and a card update or recorded sale must never fail
// because eBay is slow or unreachable.
//
// The cost of that decision is silent drift — a failed push leaves eBay
// advertising a quantity we no longer hold, with nothing to show for it. This
// module closes that gap by recording the failure on the set listing so it
// surfaces in the UI and can be resolved from the sync panel.
//
// Used by every write path that changes a variation quantity:
//   PATCH /api/cards/[id]           — manual qty edit
//   POST  /api/sales                — sale draws stock down
//   POST  /api/bulk-wizard/import   — restock tops stock up
// =============================================================================
import { createAdminClient } from '@/lib/supabase/server'
import { updateVariationQuantities } from '@/lib/ebay'

export interface QuantityPush {
  sku:      string   // card.id
  quantity: number
}

/**
 * Push variation quantities to eBay, recording failure state on the set listing.
 *
 * On success  — clears any previous failure and stamps last_synced_at.
 * On failure  — marks the listing sync_pending with the error message, so the
 *               Set Listings tab can flag it and the user can retry from the
 *               manage panel rather than discovering the drift via a customer.
 *
 * Never throws. Callers are fire-and-forget paths whose primary work has
 * already committed; an exception here would surface as an unhandled rejection.
 */
export async function pushQuantitiesWithRecovery(
  orgId:        string,
  setListingId: string,   // ebay_set_listings.id (UUID)
  updates:      QuantityPush[],
): Promise<boolean> {
  if (updates.length === 0) return true

  const db = createAdminClient()

  try {
    const { data: setListing } = await db
      .from('ebay_set_listings')
      .select('ebay_listing_id, environment, status')
      .eq('id', setListingId)
      .eq('org_id', orgId)
      .single()

    if (!setListing?.['ebay_listing_id']) return false

    // An ended listing has nothing to sync — not a failure.
    if (setListing['status'] === 'ended') return true

    await updateVariationQuantities(
      orgId,
      setListing['ebay_listing_id'] as string,
      updates,
    )

    // Success — clear any prior failure so a recovered listing stops nagging.
    await db
      .from('ebay_set_listings')
      .update({
        status:         'active',
        sync_error:     null,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', setListingId)
      .eq('org_id', orgId)

    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown eBay error'
    console.error(`[ebay-sync] push failed for set listing ${setListingId}:`, message)

    // Record the drift. Deliberately does NOT overwrite last_synced_at — the
    // UI should keep showing when the listing was last genuinely in agreement
    // with eBay, not when we last tried and failed.
    await db
      .from('ebay_set_listings')
      .update({
        status:     'sync_pending',
        sync_error: message.slice(0, 500),
      })
      .eq('id', setListingId)
      .eq('org_id', orgId)
      .then(undefined, () => { /* best-effort — nothing left to escalate to */ })

    return false
  }
}
