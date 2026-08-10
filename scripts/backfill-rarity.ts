#!/usr/bin/env tsx
// =============================================================================
// CardVault Pro — Rarity backfill
//
// Populates `cards.rarity` for existing rows that predate the rarity column,
// using the same authoritative source as the Bulk Wizard (pokemontcg.io).
//
// Usage:
//   1. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
//      (optionally POKEMON_TCG_API_KEY for higher rate limits)
//   2. tsx scripts/backfill-rarity.ts            (dry run — prints, no writes)
//      tsx scripts/backfill-rarity.ts --apply    (writes)
//
// Idempotent: only touches rows where rarity IS NULL. Safe to re-run.
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { normaliseRarity } from '../src/lib/rarity'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const APPLY = process.argv.includes('--apply')

const supabase = createClient(
  process.env['NEXT_PUBLIC_SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const log = (m: string) => console.log(`[backfill-rarity] ${m}`)

/** "025/198" → "25", "TG01/TG30" → "TG01". Mirrors lib/tcg.normaliseCardNumber. */
function normaliseCardNumber(raw: string): string {
  const head = (raw.split('/')[0] ?? '').trim()
  return /^\d+$/.test(head) ? String(parseInt(head, 10)) : head
}

interface TcgApiCard { rarity?: string; set?: { ptcgoCode?: string } }

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
  })
  if (!res.ok) throw new Error(`TCG API ${res.status}`)
  const data = await res.json() as { data?: TcgApiCard[] }
  return data.data ?? []
}

async function lookupRarity(setCode: string, cardNumber: string, cardName: string): Promise<string | null> {
  const code = (setCode ?? '').trim().toUpperCase()
  const num  = normaliseCardNumber(cardNumber ?? '')
  if (code && num) {
    try {
      const r = (await queryTcg(`set.ptcgoCode:${code} number:${num}`))[0]?.rarity
      if (r) return normaliseRarity(r)
    } catch { /* fall through */ }
  }
  if (cardName && num) {
    try {
      const rows = await queryTcg(`name:"${cardName.replace(/"/g, '')}" number:${num}`)
      const pick = code ? rows.find(c => (c.set?.ptcgoCode ?? '').toUpperCase() === code) ?? rows[0] : rows[0]
      if (pick?.rarity) return normaliseRarity(pick.rarity)
    } catch { /* fall through */ }
  }
  return null
}

async function main() {
  const { data: cards, error } = await supabase
    .from('cards')
    .select('id, card_name, set_code, card_number')
    .is('rarity', null)
    .is('deleted_at', null)

  if (error) { console.error(error); process.exit(1) }
  log(`${cards?.length ?? 0} cards without a rarity${APPLY ? '' : ' (dry run — pass --apply to write)'}`)

  let matched = 0, missed = 0
  for (const c of cards ?? []) {
    const rarity = await lookupRarity(c.set_code ?? '', c.card_number ?? '', c.card_name ?? '')
    if (!rarity || rarity === 'Unknown') { missed++; continue }
    matched++
    log(`${c.card_name} ${c.set_code} ${c.card_number} → ${rarity}`)
    if (APPLY) {
      const { error: upErr } = await supabase.from('cards').update({ rarity }).eq('id', c.id)
      if (upErr) log(`  ! update failed: ${upErr.message}`)
    }
    await new Promise(r => setTimeout(r, 120)) // be polite to the public API
  }
  log(`done — matched ${matched}, unresolved ${missed}`)
}

void main()
