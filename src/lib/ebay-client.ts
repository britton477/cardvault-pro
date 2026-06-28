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
  NM:     'Near Mint (NM) — card is in excellent condition with no visible wear.',
  LP:     'Lightly Played (LP) — minor edge wear or light surface scratches, still presentable.',
  MP:     'Moderately Played (MP) — visible wear but card is fully playable and identifiable.',
  HP:     'Heavily Played (HP) — significant wear; condition clearly described.',
  Sealed: 'Factory Sealed — item has never been opened.',
}

/**
 * Build the eBay listing description.
 * Postage section is dynamic: under £20 → 2nd class, £20+ → tracked.
 */
export function buildListingDescription(
  card: ListingCardData,
  price: number,
  shopName = 'VaultHunters TCG',
): string {
  const condDesc    = CONDITION_DESCRIPTIONS[card.condition] ?? `${card.condition} — see photos.`
  const isHighValue = price >= 20

  const shippingLine = isHighValue
    ? 'Royal Mail Tracked 48 postage — buyer pays shipping. Every card is carefully packaged with protection in mind so it arrives safely and in the condition described.'
    : 'Royal Mail 2nd Class postage — buyer pays shipping. Every card is carefully packaged with protection in mind so it arrives safely and in the condition described.'

  const setLine = [card.set_code, card.card_number ? `#${card.card_number}` : null].filter(Boolean).join(' · ')

  const extras: string[] = []
  if (card.foil_type && card.foil_type !== 'Normal') extras.push(`Variant: ${card.foil_type}`)
  if (card.is_graded && card.grader && card.grade)   extras.push(`Graded: ${card.grader} ${card.grade}`)
  if (card.notes) extras.push(`Notes: ${card.notes}`)

  return `🃏 ${shopName}
✅ ${card.card_name}${extras.length ? '\n' + extras.join('\n') : ''}
Set: ${setLine}
Condition: ${condDesc}
🚚 SHIPPING
${shippingLine}
💳 PAYMENT
Payment required within 48 hours of auction end. We aim to dispatch within 1–2 business days.
🃏 ABOUT US
We're a UK-based private Pokémon card seller. All cards are accurately described and photo evidence is available on request. If you're happy with your purchase, we'd really appreciate you leaving us feedback!
Any questions? Just ask — happy to help 😊`
}
