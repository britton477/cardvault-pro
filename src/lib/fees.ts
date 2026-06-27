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

/**
 * Calculate the buyer total (list price + protection fee).
 */
export function calcBuyerTotal(listPrice: number): number {
  return Math.round((listPrice + calcBuyerFee(listPrice)) * 100) / 100
}

/**
 * Suggest a list price given purchase price and optional eBay avg.
 * If we have eBay market data, use the median. Otherwise apply markup.
 */
export function suggestListPrice(
  purchasePrice: number,
  ebayAvgSold: number | null | undefined,
  markupPct = 40,
): number {
  if (ebayAvgSold && ebayAvgSold > 0) return Math.round(ebayAvgSold * 100) / 100
  if (!purchasePrice) return 0
  const marked = purchasePrice * (1 + markupPct / 100)
  return Math.round(marked * 100) / 100
}

/**
 * Calculate profit on a sale.
 * profit = soldPrice - fees - shipping - purchasePrice
 */
export function calcProfit(
  soldPrice: number,
  fees: number,
  shipping: number,
  purchasePrice: number,
): number {
  return Math.round((soldPrice - fees - shipping - purchasePrice) * 100) / 100
}
