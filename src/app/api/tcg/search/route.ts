// =============================================================================
// GET /api/tcg/search?q=charizard&set=sv01
//
// Proxies the Pokémon TCG API (pokemontcg.io) for card auto-fill in AddCardModal.
// - No API key required (public endpoints work for card search)
// - Results cached in Redis for 7 days (card data is stable)
// - Returns a simplified shape: { cards: TcgCard[] }
// - Rate limited: 30 req/min per IP (generous — client debounces)
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { ok, serverError, validationError } from '@/lib/api'
import { withCache } from '@/lib/cache'

const QuerySchema = z.object({
  q:   z.string().min(2).max(100),
  set: z.string().max(20).optional(),
})

export interface TcgCard {
  id:          string
  name:        string
  number:      string
  set_code:    string
  set_name:    string
  rarity:      string | null
  supertype:   string  // 'Pokémon' | 'Trainer' | 'Energy'
  image_small: string
}

interface PokemonTcgCard {
  id:         string
  name:       string
  number:     string
  rarity?:    string
  supertype:  string
  set:        { id: string; name: string }
  images:     { small: string; large: string }
}

export async function GET(request: NextRequest) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams)
    const { q, set } = QuerySchema.parse(params)

    // Build search query for pokemontcg.io
    let query = `name:"${q}*"`
    if (set) query += ` set.id:${set}`

    const cacheKey = `tcg:search:${query}`

    const cards = await withCache<TcgCard[]>(cacheKey, 60 * 60 * 24 * 7, async () => {
      const url = new URL('https://api.pokemontcg.io/v2/cards')
      url.searchParams.set('q', query)
      url.searchParams.set('pageSize', '20')
      url.searchParams.set('select', 'id,name,number,rarity,supertype,set,images')

      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'CardVaultPro/2.0',
          // API key header if configured — optional for basic search
          ...(process.env.POKEMON_TCG_API_KEY
            ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
            : {}),
        },
        next: { revalidate: 0 }, // Don't use Next.js data cache — we use Redis
      })

      if (!res.ok) {
        throw new Error(`Pokémon TCG API error: ${res.status}`)
      }

      const data = await res.json() as { data: PokemonTcgCard[] }

      return (data.data ?? []).map((c): TcgCard => ({
        id:          c.id,
        name:        c.name,
        number:      c.number,
        set_code:    c.set.id.toUpperCase(),
        set_name:    c.set.name,
        rarity:      c.rarity ?? null,
        supertype:   c.supertype,
        image_small: c.images.small,
      }))
    })

    return ok({ cards })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    return serverError(err)
  }
}
