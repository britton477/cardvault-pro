// =============================================================================
// CardVault Pro — List price derivation
//
// SINGLE SOURCE OF TRUTH for turning what we know about a card into an asking
// price. Everything that sets listed_price goes through here: the Bulk Wizard,
// the stock bulk price action, and the single-card listing modal.
//
// WHY THIS EXISTS
//
// "Markup" previously meant three different things in three places:
//
//   lib/fees.ts        market price as-is, else cost × markup   (default 40%)
//   Bulk Wizard        market × (1 + markup)                    (default 10%)
//   BulkPriceModal     cost × (1 + markup)                      (default 30%)
//
// A card costing £2.00 with an £8.00 eBay median priced at £8.00, £8.80 or
// £2.60 depending which screen you were on. Meanwhile org_settings.markup_pct
// — the "Default markup %" field in Settings — was read by none of them.
//
// The fix is not to pick one formula. Both rules are legitimate:
//
//   "price near what these actually sell for"  → market-relative
//   "guarantee me this margin over what I paid" → cost-plus
//
// The defect was leaving which one you got to chance. Here the strategy is
// explicit, and the fallback when market data is missing is defined rather
// than accidental.
// =============================================================================

/** How to derive an asking price. */
export type PricingStrategy =
  | {
      /** Price relative to what the card actually sells for on eBay. */
      mode: 'market'
      /**
       * Percent applied to the eBay median.
       *   0   → list at the going rate
       *  +10  → 10% above, room to accept offers
       *  −5   → undercut to move stock
       */
      adjustmentPct: number
    }
  | {
      /** Price to guarantee a margin over what you paid. */
      mode: 'cost'
      /** Percent added to purchase price. 40 → £2.00 becomes £2.80. */
      markupPct: number
    }
  | {
      /** Same flat price for every card. */
      mode: 'fixed'
      price: number
    }

/** The inputs a price can be derived from. */
export interface PriceableCard {
  purchase_price: number | null | undefined
  ebay_avg_sold:  number | null | undefined
}

/** Why a price came out the way it did — surfaced in previews so the user can see the reasoning. */
export type PriceBasis = 'market' | 'cost' | 'fixed' | 'none'

export interface PriceResult {
  /** The derived price, or null when there was nothing to derive from. */
  price: number | null
  basis: PriceBasis
}

/** Round to whole pence. Money is never carried at floating precision. */
function toPence(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Derive an asking price for one card.
 *
 * Fallback behaviour is deliberate and specified:
 *
 *   market strategy, no market data → falls back to cost-plus using
 *     `fallbackCostMarkupPct`, because a card with no comparables still needs
 *     a price. Returning null would silently drop cards out of bulk listing
 *     operations, which is how the 43-unpriced-cards problem happened.
 *
 *   cost strategy, no purchase price → returns null. There is genuinely
 *     nothing to compute from, and inventing a number would be worse than
 *     making the user set one.
 */
export function derivePrice(
  card: PriceableCard,
  strategy: PricingStrategy,
  fallbackCostMarkupPct = 40,
): PriceResult {
  const cost   = card.purchase_price ?? 0
  const market = card.ebay_avg_sold  ?? 0

  if (strategy.mode === 'fixed') {
    return { price: toPence(strategy.price), basis: 'fixed' }
  }

  if (strategy.mode === 'market') {
    if (market > 0) {
      return {
        price: toPence(market * (1 + strategy.adjustmentPct / 100)),
        basis: 'market',
      }
    }
    // No comparables — fall back to cost-plus rather than leaving it unpriced
    if (cost > 0) {
      return {
        price: toPence(cost * (1 + fallbackCostMarkupPct / 100)),
        basis: 'cost',
      }
    }
    return { price: null, basis: 'none' }
  }

  // cost-plus
  if (cost > 0) {
    return {
      price: toPence(cost * (1 + strategy.markupPct / 100)),
      basis: 'cost',
    }
  }
  return { price: null, basis: 'none' }
}

/**
 * Derive prices for a batch, preserving order.
 *
 * Cards that already carry a manual price keep it — an explicit decision by the
 * user always outranks a derived one, in every entry point.
 */
export function derivePrices<T extends PriceableCard & { listed_price?: number | null }>(
  cards: T[],
  strategy: PricingStrategy,
  fallbackCostMarkupPct = 40,
): PriceResult[] {
  return cards.map(c =>
    c.listed_price != null && c.listed_price > 0
      ? { price: c.listed_price, basis: 'fixed' as const }
      : derivePrice(c, strategy, fallbackCostMarkupPct),
  )
}

/** Default strategy for an org: list at the eBay going rate. */
export function defaultStrategy(): PricingStrategy {
  return { mode: 'market', adjustmentPct: 0 }
}

/**
 * Human-readable explanation of a strategy, for preview panels.
 */
export function describeStrategy(strategy: PricingStrategy): string {
  switch (strategy.mode) {
    case 'fixed':
      return `Flat £${strategy.price.toFixed(2)} per card`
    case 'cost':
      return `${strategy.markupPct}% over what you paid`
    case 'market':
      if (strategy.adjustmentPct === 0) return 'At the eBay going rate'
      return strategy.adjustmentPct > 0
        ? `${strategy.adjustmentPct}% above the eBay going rate`
        : `${Math.abs(strategy.adjustmentPct)}% below the eBay going rate`
  }
}
