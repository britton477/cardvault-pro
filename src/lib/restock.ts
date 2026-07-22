// =============================================================================
// CardVault Pro — Restock matching
//
// Single source of truth for deciding whether a scanned card is a RESTOCK of
// something already in inventory, or a genuinely NEW card.
//
// Both the preview endpoint (/api/bulk-wizard/check-restock) and the import
// endpoint (/api/bulk-wizard/import) import from here. If they used separate
// logic the preview would eventually lie about what import is going to do.
// =============================================================================

/** The fields that together identify a fungible card. */
export interface CardIdentity {
  card_name:   string
  set_code:    string
  card_number: string
  condition:   string
  foil_type:   string
  language:    string
}

/** An existing stock row considered as a restock target. */
export interface RestockCandidate extends CardIdentity {
  id:                  string
  qty:                 number
  purchase_price:      number
  status:              string
  is_graded:           boolean
  listing_type:        string | null
  /** Single-card eBay listing, if this card has one */
  ebay_listing_id:     string | null
  ebay_set_listing_id: string | null
}

/**
 * Build the comparison key for a card identity.
 *
 * Normalised so trivial input differences don't create phantom duplicates:
 *   "Charizard " / "charizard" / "CHARIZARD" all collapse to the same key.
 *
 * Deliberately EXCLUDES purchase price, source, notes and dates — those vary
 * between acquisitions of the same card and must not affect identity.
 */
export function identityKey(c: CardIdentity): string {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  return [
    norm(c.card_name),
    norm(c.set_code),
    norm(c.card_number),
    norm(c.condition),
    norm(c.foil_type),
    norm(c.language),
  ].join('|')
}

/**
 * Is this existing stock row eligible to absorb a restock?
 *
 *   GRADED CARDS — a PSA 10 Charizard is a unique physical slab with its own
 *   certification number. Two of them are not interchangeable units of one
 *   line item, and collapsing them to qty 2 destroys that distinction (and any
 *   hope of tracking which slab sold). Graded cards always create a new row.
 *
 *   SOLD CARDS — normally excluded: a Sold row is a historical record whose
 *   cost basis was already consumed by a sale, and reviving it would corrupt
 *   past P&L.
 *
 *   EXCEPT a sold-out card still attached to a live set listing. That row is
 *   not history — it is a live eBay variation sitting at quantity 0, waiting
 *   for stock. Excluding it would create a second row for the same card while
 *   the set listing kept advertising 0, so the restocked units would be
 *   unsellable through the listing they belong to. Reviving it is correct, and
 *   the weighted-average maths handles it cleanly: at qty 0 the stale cost
 *   carries zero weight, so the new purchase price simply becomes the cost.
 */
export function isRestockEligible(candidate: RestockCandidate): boolean {
  if (candidate.is_graded) return false

  if (candidate.status === 'Sold') {
    const isLiveSetVariation =
      candidate.listing_type === 'variation' && !!candidate.ebay_set_listing_id
    return isLiveSetVariation
  }

  return true
}

/**
 * Does absorbing a restock require reviving this row back into active stock?
 *
 * True for sold-out set-listing variations — they must return to 'Listed' so
 * they show as sellable again alongside the eBay quantity push.
 */
export function needsStatusRevival(candidate: RestockCandidate): boolean {
  return candidate.status === 'Sold'
}

/**
 * Index existing stock by identity key, keeping only eligible rows.
 *
 * When several rows share an identity (legacy duplicates created before restock
 * merging existed), the one with the most stock wins — merging into the largest
 * pile keeps the long tail of stragglers visible rather than hiding new units
 * inside a qty-0 row.
 */
export function buildRestockIndex(
  candidates: RestockCandidate[],
): Map<string, RestockCandidate> {
  const index = new Map<string, RestockCandidate>()

  for (const c of candidates) {
    if (!isRestockEligible(c)) continue
    const key      = identityKey(c)
    const existing = index.get(key)
    if (!existing || c.qty > existing.qty) index.set(key, c)
  }

  return index
}

/**
 * Weighted-average cost basis after adding stock.
 *
 * Buying the same card at different prices means the line item no longer has a
 * single true cost. Weighted average is the standard treatment for fungible
 * inventory and keeps profit reporting honest:
 *
 *   3 @ £5.00 + 2 @ £7.50  →  (15.00 + 15.00) / 5  =  £6.00 each
 *
 * The alternative — keeping the original price — would understate cost and
 * overstate profit on every restock.
 *
 * Rounded to 2dp since it is stored as currency.
 */
export function weightedAverageCost(
  existingQty:   number,
  existingPrice: number,
  addedQty:      number,
  addedPrice:    number,
): number {
  const totalQty = existingQty + addedQty
  if (totalQty <= 0) return addedPrice

  const totalCost = existingQty * existingPrice + addedQty * addedPrice
  return Math.round((totalCost / totalQty) * 100) / 100
}

/** Result of matching one incoming card against existing stock. */
export interface RestockMatch {
  /** Index of the card in the incoming array */
  inputIndex: number
  /** Existing card row it matches, or null when it is new */
  existing:   RestockCandidate | null
}

/**
 * Match an incoming batch against the restock index.
 *
 * Incoming cards are matched in order. Two identical scans in the same batch
 * both map to the same existing row — the import route accumulates their
 * quantities rather than applying two separate increments.
 */
export function matchBatch(
  incoming: CardIdentity[],
  index:    Map<string, RestockCandidate>,
): RestockMatch[] {
  return incoming.map((card, inputIndex) => ({
    inputIndex,
    existing: index.get(identityKey(card)) ?? null,
  }))
}
