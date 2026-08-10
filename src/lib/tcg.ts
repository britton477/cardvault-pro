// =============================================================================
// CardVault Pro — Pokémon TCG rarity lookup (server-side, cached)
//
// Authoritative rarity for a scanned card. Used by the Bulk Wizard identify
// route: the vision model reads the name/set/number off the photo, then we ask
// pokemontcg.io what that card's ACTUAL rarity is, rather than letting the model
// guess it. This is what stops a plain `ex` (Double Rare) being called SIR.
//
// Two matching subtleties, both handled here:
//   • our set_code (e.g. "SVI") is the ptcgo code — pokemontcg.io's set.id is
//     "sv1". We query set.ptcgoCode, with a name-based fallback.
//   • our card_number is "025/198"; the API's `number` is "25". We strip the
//     "/total" and any leading zeros (but keep non-numeric prefixes like TG01).
// =============================================================================
import { withCache } from '@/lib/cache'
import { normaliseRarity, type Rarity } from '@/lib/rarity'

/** "025/198" → "25", "TG01/TG30" → "TG01", "SWSH001" → "SWSH001". */
export function normaliseCardNumber(raw: string): string {
  const head = (raw.split('/')[0] ?? '').trim()
  return /^\d+$/.test(head) ? String(parseInt(head, 10)) : head
}

interface TcgApiCard { rarity?: string; number?: string; set?: { ptcgoCode?: string; name?: string } }

async function queryTcg(q: string): Promise<TcgApiCard[]> {
  const url = new URL('https://api.pokemontcg.io/v2/cards')
  url.searchParams.set('q', q)
  url.searchParams.set('pageSize', '20')
  url.searchParams.set('select', 'rarity,number,set')

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'CardVaultPro/2.0',
      ...(process.env['POKEMON_TCG_API_KEY'] ? { 'X-Api-Key': process.env['POKEMON_TCG_API_KEY']! } : {}),
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Pokémon TCG API error: ${res.status}`)
  const data = await res.json() as { data?: TcgApiCard[] }
  return data.data ?? []
}

/**
 * Look up the authoritative rarity for a card. Returns 'Unknown' on any miss so
 * the caller falls back to the vision guess rather than storing a wrong value.
 *
 * Cached 30 days per (set_code|number|name) — card data is immutable, and a
 * 112-card import re-scanning the same set hits the cache after the first card.
 */
export async function lookupRarity(
  setCode: string,
  cardNumber: string,
  cardName?: string,
): Promise<{ rarity: Rarity; matched: boolean }> {
  const code = (setCode ?? '').trim().toUpperCase()
  const num  = normaliseCardNumber(cardNumber ?? '')
  if (!num && !cardName) return { rarity: 'Unknown', matched: false }

  const cacheKey = `tcg:rarity:${code}:${num}:${(cardName ?? '').toLowerCase()}`

  return withCache(cacheKey, 60 * 60 * 24 * 30, async () => {
    // Attempt 1: exact set + number (the strong signal).
    if (code && num) {
      try {
        const byCode = await queryTcg(`set.ptcgoCode:${code} number:${num}`)
        const raw = byCode[0]?.rarity ?? null
        if (raw) return { rarity: normaliseRarity(raw), matched: true }
      } catch { /* fall through to name match */ }
    }

    // Attempt 2: name + number, then disambiguate by set code when we have it.
    if (cardName && num) {
      try {
        const byName = await queryTcg(`name:"${cardName.replace(/"/g, '')}" number:${num}`)
        const pick = code
          ? byName.find(c => (c.set?.ptcgoCode ?? '').toUpperCase() === code) ?? byName[0]
          : byName[0]
        if (pick?.rarity) return { rarity: normaliseRarity(pick.rarity), matched: true }
      } catch { /* fall through to Unknown */ }
    }

    return { rarity: 'Unknown' as Rarity, matched: false }
  })
}
