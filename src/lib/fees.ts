// =============================================================================
// CardVault Pro — eBay UK Fee Calculations
// =============================================================================
// Formula source: eBay UK Seller Centre, Buyer Protection fee schedule.
// Brackets: £0.10 flat + 7% (≤£20) + 4% (£20–£300) + 2% (£300–£4000)
// eBay applies Math.floor (truncate), not banker's rounding.
// =============================================================================

/**
 * Calculate the total eBay buyer protection fee for a given list price.
 * Returns the fee amount (not the total buyer pays).
 */
export function calcBuyerFee(listPrice: number): number {
  if (!listPrice || listPrice <= 0) return 0

  let fee = 0.10

  if (listPrice <= 20) {
    fee += listPrice * 0.07
  } else if (listPrice <= 300) {
    fee += 20 * 0.07 + (listPrice - 20) * 0.04
  } else if (listPrice <= 4000) {
    fee += 20 * 0.07 + 280 * 0.04 + (listPrice - 300) * 0.02
  } else {
    fee += 20 * 0.07 + 280 * 0.04 + 3700 * 0.02
  }

  // eBay truncates to 2dp
  return Math.floor(fee * 100) / 100
}

/**
 * Given the desired buyer-pays price, back-calculate the list price.
 * Inverts calcBuyerFee() bracket-by-bracket.
 */
export function calcListFromBuyerPays(buyerPays: number): number {
  if (!buyerPays || buyerPays <= 0) return 0

  // Try ≤£20 bracket: fee = 0.10 + lp*0.07  →  bp = lp + 0.10 + lp*0.07 = lp*1.07 + 0.10
  let lp = (buyerPays - 0.10) / 1.07
  if (lp <= 20) return Math.max(0.01, Math.round(lp * 100) / 100)

  // Try £20–£300 bracket: fee = 0.10 + 1.40 + (lp-20)*0.04 = 1.50 + (lp-20)*0.04
  // bp = lp + 1.50 + (lp-20)*0.04 = lp*1.04 + 0.70
  lp = (buyerPays - 0.70) / 1.04
  if (lp <= 300) return Math.max(0.01, Math.round(lp * 100) / 100)

  // £300–£4000 bracket: fee = 0.10 + 1.40 + 11.20 + (lp-300)*0.02 = 12.70 + (lp-300)*0.02
  // bp = lp + 12.70 + (lp-300)*0.02 = lp*1.02 + 6.70
  lp = (buyerPays - 6.70) / 1.02
  return Math.max(0.01, Math.round(lp * 100) / 100)
}

// =============================================================================
// NET PROCEEDS — what YOU actually receive for a given list price.
//
// IMPORTANT: `listPrice` is the price the BUYER PAYS (the asking price you set,
// which already includes the eBay Buyer Protection fee). This matches how
// sellers research the market — sold prices on eBay are what the buyer paid.
//
//   private  → the buyer pays your list price; eBay keeps the protection fee,
//              so YOU receive the eBay item price = list − protection.
//   business → the buyer pays your list price; eBay's Final Value Fee comes out
//              of your side, so you receive list − FVF.
//
// Postage is excluded on both sides, so cost/profit tracking compares like with
// like. The eBay item price (StartPrice) we send is youReceive — see ebay.ts.
// =============================================================================

export type SellerModel =
  | { kind: 'private' }
  | { kind: 'business'; fvfPct: number; fvfFixed: number }

export interface NetProceeds {
  /** What the buyer pays for the item, excluding postage (list + protection). */
  buyerPaysExclPostage: number
  /** What lands in your account for the item, excluding postage. */
  youReceive: number
  /** The fee deducted from YOU (0 for private sellers). */
  fee: number
}

/** Round to whole pence — money is never carried at floating precision. */
function p2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Given a list price and the org's seller model, return what the buyer pays
 * (excl. postage) and what you receive (excl. postage).
 */
export function calcNetProceeds(listPrice: number, model: SellerModel): NetProceeds {
  const lp = listPrice > 0 ? listPrice : 0
  if (lp === 0) return { buyerPaysExclPostage: 0, youReceive: 0, fee: 0 }

  // The buyer pays the list price in both models.
  if (model.kind === 'private') {
    // You receive the eBay item price (list minus the buyer-protection fee).
    const youReceive = calcListFromBuyerPays(lp)
    return { buyerPaysExclPostage: lp, youReceive, fee: p2(lp - youReceive) }
  }

  // Business: FVF comes out of your proceeds; the buyer still pays the list price.
  const fvf = p2(lp * (model.fvfPct / 100) + model.fvfFixed)
  return { buyerPaysExclPostage: lp, youReceive: p2(lp - fvf), fee: fvf }
}

// NOTE: suggestListPrice() used to live here.
//
// It was one of four competing definitions of "list price" in this codebase,
// each with different arithmetic and a different default markup. Deriving an
// asking price now lives solely in lib/pricing.ts — import derivePrice() from
// there rather than adding a local formula, or the screens drift apart again.
//
// This file is for eBay's fee schedule only: what eBay charges, and how to
// work backwards from a buyer-pays total. It does not decide prices.
