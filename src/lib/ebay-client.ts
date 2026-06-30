// =============================================================================
// CardVault Pro — eBay client-safe helpers
//
// This file re-exports listing content helpers that are safe to use in
// client components. It does NOT import anything from lib/ebay.ts (which
// contains server-only code: crypto, Supabase admin client, etc.)
// =============================================================================

export interface ListingCardData {
  card_name:   string
  set_code:    string
  card_number: string | null
  condition:   string
  foil_type:   string | null
  is_graded:   boolean
  grader:      string | null
  grade:       string | null
  notes:       string | null
}

/**
 * Build the eBay listing title:
 * "Pokémon TCG | Misty's Psyduck | DRI 193/182 | NM" (max 80 chars)
 */
export function buildListingTitle(card: ListingCardData): string {
  const setAndNum = [card.set_code, card.card_number].filter(Boolean).join(' ')
  const extras: string[] = []
  if (card.foil_type && card.foil_type !== 'Normal') extras.push(card.foil_type)
  if (card.is_graded && card.grader && card.grade)   extras.push(`${card.grader} ${card.grade}`)

  const parts = ['Pokémon TCG', card.card_name, setAndNum, card.condition, ...extras].filter(Boolean)
  return parts.join(' | ').slice(0, 80)
}

const CONDITION_DESCRIPTIONS: Record<string, string> = {
  NM:     'Near Mint (NM) — no visible wear. Card has been stored carefully and is in excellent condition.',
  LP:     'Lightly Played (LP) — minor edge wear or very light surface scratches. Still presentable and fully playable.',
  MP:     'Moderately Played (MP) — visible wear on edges or surface. Fully playable and identifiable.',
  HP:     'Heavily Played (HP) — significant wear. Condition is clearly reflected in the price.',
  Sealed: 'Factory Sealed — item has never been opened and is in original packaging.',
}

/**
 * Build the eBay listing description as structured HTML.
 * eBay renders the description field as HTML, so plain-text \n newlines display
 * as a single run of text. We use <br> and <p> to create proper visual structure.
 * Postage tier is dynamic: under £20 → 2nd class, £20+ → tracked.
 */
export function buildListingDescription(
  card: ListingCardData,
  price: number,
  shopName = 'VaultHunters TCG',
): string {
  const condDesc    = CONDITION_DESCRIPTIONS[card.condition] ?? `${card.condition} — please see photos for full condition details.`
  const isHighValue = price >= 20

  const shippingDesc = isHighValue
    ? 'Royal Mail Tracked 48 — buyer pays shipping. Every order is carefully packaged to ensure your card arrives safely and in the condition described.'
    : 'Royal Mail 2nd Class — buyer pays shipping. Every order is carefully packaged to ensure your card arrives safely and in the condition described.'

  const setLine = [card.set_code, card.card_number ? `#${card.card_number}` : null].filter(Boolean).join(' / ')

  const detailRows: string[] = []
  if (setLine) detailRows.push(`<tr><td><strong>Set / Number</strong></td><td>${setLine}</td></tr>`)
  detailRows.push(`<tr><td><strong>Condition</strong></td><td>${condDesc}</td></tr>`)
  if (card.foil_type && card.foil_type !== 'Normal') {
    detailRows.push(`<tr><td><strong>Variant</strong></td><td>${card.foil_type}</td></tr>`)
  }
  if (card.is_graded && card.grader && card.grade) {
    detailRows.push(`<tr><td><strong>Grader</strong></td><td>${card.grader}</td></tr>`)
    detailRows.push(`<tr><td><strong>Grade</strong></td><td>${card.grade}</td></tr>`)
  }
  if (card.notes) {
    detailRows.push(`<tr><td><strong>Notes</strong></td><td>${card.notes}</td></tr>`)
  }

  return `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #222; max-width: 680px;">

<h2 style="font-size: 18px; margin-bottom: 4px;">&#x1F0CF; ${card.card_name}</h2>
<p style="color: #555; margin-top: 0;">${shopName} &mdash; UK Pok&eacute;mon Card Seller</p>

<hr style="border: none; border-top: 1px solid #ddd; margin: 12px 0;" />

<h3 style="font-size: 14px; margin-bottom: 6px;">&#x1F4CB; Card Details</h3>
<table style="border-collapse: collapse; width: 100%;">
  <tbody style="font-size: 14px;">
    ${detailRows.join('\n    ')}
  </tbody>
</table>

<hr style="border: none; border-top: 1px solid #ddd; margin: 12px 0;" />

<h3 style="font-size: 14px; margin-bottom: 6px;">&#x1F4F8; Photos</h3>
<p>Please review all photos carefully before purchasing &mdash; they form part of the item description. If you have any questions about condition, please message us before buying.</p>

<hr style="border: none; border-top: 1px solid #ddd; margin: 12px 0;" />

<h3 style="font-size: 14px; margin-bottom: 6px;">&#x1F69A; Shipping</h3>
<p>${shippingDesc}</p>

<hr style="border: none; border-top: 1px solid #ddd; margin: 12px 0;" />

<h3 style="font-size: 14px; margin-bottom: 6px;">&#x1F4B3; Payment</h3>
<p>Payment required within 48 hours of purchase. We aim to dispatch within 1&ndash;2 business days.</p>

<hr style="border: none; border-top: 1px solid #ddd; margin: 12px 0;" />

<h3 style="font-size: 14px; margin-bottom: 6px;">&#x2139; About Us</h3>
<p>We&apos;re a UK-based Pok&eacute;mon card seller. All cards are accurately described and additional photos are available on request. If you&apos;re happy with your purchase, we&apos;d really appreciate your feedback!</p>
<p>Any questions? Feel free to message us &mdash; we&apos;re happy to help. &#x1F60A;</p>

</div>`
}
