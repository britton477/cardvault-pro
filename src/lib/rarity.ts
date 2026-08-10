// =============================================================================
// CardVault Pro — Card rarity (canonical taxonomy)
//
// SINGLE SOURCE OF TRUTH for what "rarity" means across the app. Every screen
// that shows or edits a rarity reads this enum; nothing invents its own list.
//
// WHY THIS EXISTS
//
// Rarity used to be inferred by the vision model into `foil_type`, which mixed
// two different things — the holo PATTERN (Holo / Reverse / Full Art) and the
// rarity CLASS (Double Rare / Illustration Rare / …). The model, guessing from
// a photo, over-fired "Special Illustration Rare": a plain `ex` printed inside
// the set (a Double Rare) looks a lot like its alt-art SIR sibling.
//
// The fix is to take rarity from the authoritative pokemontcg.io `rarity`
// field (see lib/tcg.ts) and normalise it here. Vision becomes a fallback only.
//
// Taxonomy is aligned to Bulbapedia "Rarity" (modern Scarlet & Violet era):
//   https://bulbapedia.bulbagarden.net/wiki/Rarity
// =============================================================================

/** Canonical rarity class. Ordered roughly low → high for sorting. */
export type Rarity =
  | 'Common'
  | 'Uncommon'
  | 'Rare'
  | 'Double Rare'                 // ex cards (RR, ★★) — the one most misread as SIR
  | 'Ace Spec Rare'
  | 'Radiant Rare'
  | 'Ultra Rare'                  // full-art ex / V / VMAX / VSTAR / GX / prime
  | 'Illustration Rare'          // "AR"
  | 'Special Illustration Rare'  // "SIR" — special/alt art, number ABOVE set total
  | 'Hyper Rare'                 // gold "cracked-ice" cards
  | 'Shiny Rare'
  | 'Shiny Ultra Rare'
  | 'Promo'
  | 'Unknown'

export const RARITIES: readonly Rarity[] = [
  'Common', 'Uncommon', 'Rare', 'Double Rare', 'Ace Spec Rare', 'Radiant Rare',
  'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare',
  'Shiny Rare', 'Shiny Ultra Rare', 'Promo', 'Unknown',
] as const

/** The holo pattern — a card's finish, independent of its rarity class. */
export type FoilPattern = 'Normal' | 'Reverse Holo' | 'Holo' | 'Full Art'

// ── Exact matches from the pokemontcg.io `rarity` field ──────────────────────
// Covers both the current SV strings and the legacy "Rare Holo X" vocabulary
// so historic cards normalise correctly too.
const EXACT: Record<string, Rarity> = {
  'common':                      'Common',
  'uncommon':                    'Uncommon',
  'rare':                        'Rare',
  'rare holo':                   'Rare',
  'double rare':                 'Double Rare',
  'ace spec rare':               'Ace Spec Rare',
  'rare ace':                    'Ace Spec Rare',
  'radiant rare':                'Radiant Rare',
  'amazing rare':                'Radiant Rare',
  'ultra rare':                  'Ultra Rare',
  'rare ultra':                  'Ultra Rare',
  'rare holo ex':                'Ultra Rare',
  'rare holo gx':                'Ultra Rare',
  'rare holo v':                 'Ultra Rare',
  'rare holo vmax':              'Ultra Rare',
  'rare holo vstar':             'Ultra Rare',
  'illustration rare':           'Illustration Rare',
  'special illustration rare':   'Special Illustration Rare',
  'hyper rare':                  'Hyper Rare',
  'rare rainbow':                'Hyper Rare',
  'rare secret':                 'Hyper Rare',
  'shiny rare':                  'Shiny Rare',
  'rare shiny':                  'Shiny Rare',
  'shiny ultra rare':            'Shiny Ultra Rare',
  'rare shiny gx':               'Shiny Ultra Rare',
  'promo':                       'Promo',
}

/**
 * Normalise any pokemontcg.io rarity string into the canonical enum.
 * Returns 'Unknown' for null/blank/unrecognised so callers can fall back to
 * the vision guess rather than storing a wrong value.
 */
export function normaliseRarity(apiRarity: string | null | undefined): Rarity {
  if (!apiRarity) return 'Unknown'
  const key = apiRarity.trim().toLowerCase()
  if (EXACT[key]) return EXACT[key]

  // Keyword fallback for unseen variants ("Trainer Gallery Rare Holo", etc.)
  // Order matters: check the most specific phrases first.
  if (key.includes('special illustration')) return 'Special Illustration Rare'
  if (key.includes('illustration'))         return 'Illustration Rare'
  if (key.includes('hyper') || key.includes('rainbow') || key.includes('secret')) return 'Hyper Rare'
  if (key.includes('double'))               return 'Double Rare'
  if (key.includes('shiny'))                return key.includes('ultra') ? 'Shiny Ultra Rare' : 'Shiny Rare'
  if (key.includes('radiant') || key.includes('amazing')) return 'Radiant Rare'
  if (key.includes('ace'))                  return 'Ace Spec Rare'
  if (key.includes('ultra') || key.includes(' ex') || key.includes(' gx') ||
      key.includes(' v'))                   return 'Ultra Rare'
  if (key.includes('promo'))                return 'Promo'
  if (key.includes('uncommon'))             return 'Uncommon'
  if (key.includes('rare'))                 return 'Rare'
  if (key.includes('common'))               return 'Common'
  return 'Unknown'
}

/**
 * Is this card number above the printed set total? e.g. "181/159" → true.
 * Secret/illustration/hyper rares number ABOVE the set total, which is the one
 * reliable photo-only signal separating SIR from a plain Double Rare.
 */
export function isAboveSetTotal(cardNumber: string): boolean {
  const m = cardNumber.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!m) return false
  return parseInt(m[1]!, 10) > parseInt(m[2]!, 10)
}

/**
 * Vision fallback — used ONLY when the TCG lookup returns 'Unknown'.
 * Conservative on SIR: only claims Special Illustration Rare when the model saw
 * special/alt art AND the number is above the set total. Otherwise a special-art
 * ex is a Double Rare. This is what stops the SIR over-firing.
 */
export function inferRarityFromVision(visionFoil: string | null | undefined, cardNumber: string): Rarity {
  const f = (visionFoil ?? '').trim().toLowerCase()
  const above = isAboveSetTotal(cardNumber)

  if (f.includes('hyper') || f.includes('rainbow') || f.includes('gold')) return 'Hyper Rare'
  if (f.includes('special illustration')) return above ? 'Special Illustration Rare' : 'Double Rare'
  if (f.includes('illustration'))         return 'Illustration Rare'
  if (f.includes('secret'))               return above ? 'Special Illustration Rare' : 'Ultra Rare'
  if (f.includes('full art') || f.includes('alt art')) return above ? 'Special Illustration Rare' : 'Ultra Rare'
  if (f.includes('reverse'))              return 'Rare'
  if (f.includes('holo'))                 return 'Rare'
  return 'Unknown'
}

/**
 * Derive the holo PATTERN (a card's finish) for the foil_type field, preferring
 * what vision actually saw. Keeps foil_type free of rarity words.
 */
export function foilFromRarity(rarity: Rarity, visionFoil?: string | null): FoilPattern {
  const f = (visionFoil ?? '').trim().toLowerCase()
  if (f.includes('reverse'))   return 'Reverse Holo'
  if (f.includes('full art') || f.includes('alt art')) return 'Full Art'
  if (f.includes('holo'))      return 'Holo'
  if (f === 'normal')          return 'Normal'

  // No usable vision pattern — infer from rarity class.
  switch (rarity) {
    case 'Common':
    case 'Uncommon':
      return 'Normal'
    case 'Illustration Rare':
    case 'Special Illustration Rare':
    case 'Ultra Rare':
      return 'Full Art'
    default:
      return 'Holo'
  }
}
