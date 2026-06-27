#!/usr/bin/env tsx
// =============================================================================
// CardVault Pro — Data Migration Script
// Reads the existing JSON blob from Supabase and populates the new v2 tables.
//
// Usage:
//   1. Fill in the constants below (ORG_ID, OWNER_AUTH_ID)
//   2. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
//   3. pnpm migrate:data  (or: tsx scripts/migrate-json-to-tables.ts)
//
// This script is idempotent — run it multiple times safely (it uses upsert).
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as crypto from 'crypto'

// Load env from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ── Config — fill in before running ──────────────────────────────────────────
const ORG_NAME      = 'VaultHunters TCG'
const ORG_SLUG      = 'vaulthunters-tcg'
const OWNER_EMAIL   = 'info@vaulthunterstcg.co.uk'  // must already exist in auth.users
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env['NEXT_PUBLIC_SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[migrate] ${msg}`)
}

function warn(msg: string) {
  console.warn(`[migrate:warn] ${msg}`)
}

function failHard(msg: string, err?: unknown): never {
  console.error(`[migrate:error] ${msg}`, err ?? '')
  process.exit(1)
}

// ── Step 1: Ensure organisation exists ───────────────────────────────────────

async function ensureOrg(): Promise<string> {
  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', ORG_SLUG)
    .single()

  if (existing) {
    log(`Organisation already exists: ${existing['id']}`)
    return existing['id'] as string
  }

  const { data, error } = await supabase
    .from('organizations')
    .insert({ name: ORG_NAME, slug: ORG_SLUG, plan: 'pro', card_limit: 999999 })
    .select('id')
    .single()

  if (error || !data) failHard('Failed to create organisation', error)
  log(`Created organisation: ${data['id']}`)
  return data['id'] as string
}

// ── Step 2: Ensure owner user profile exists ──────────────────────────────────

async function ensureOwner(orgId: string): Promise<string> {
  // Look up auth user by email
  const { data: authData, error: authErr } = await supabase.auth.admin.listUsers()
  if (authErr) failHard('Failed to list auth users', authErr)

  const authUser = authData.users.find(u => u.email === OWNER_EMAIL)
  if (!authUser) {
    failHard(`Auth user not found for ${OWNER_EMAIL}. Create them in Supabase Auth first, then re-run.`)
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', authUser.id)
    .single()

  if (existing) {
    log(`Owner profile already exists: ${authUser.id}`)
    return authUser.id
  }

  const { error } = await supabase.from('users').insert({
    id:     authUser.id,
    org_id: orgId,
    name:   'Aaron',
    avatar: '🃏',
    role:   'owner',
  })
  if (error) failHard('Failed to create owner profile', error)

  log(`Created owner profile: ${authUser.id}`)
  return authUser.id
}

// ── Step 3: Read existing JSON blob from old table ────────────────────────────

interface LegacyData {
  cards:   LegacyCard[]
  sales:   LegacySale[]
  sealed:  LegacySealed[]
}

interface LegacyCard {
  id:             string
  cardName:       string   // actual field name in legacy data
  setCode?:       string   // actual field name in legacy data
  cardNumber?:    string   // actual field name in legacy data
  condition?:     string
  foil?:          string
  language?:      string
  graded?:        boolean
  grader?:        string
  grade?:         string
  qty?:           number
  status?:        string
  purchasePrice?: number
  purchaseDate?:  string
  source?:        string
  notes?:         string
  listedPrice?:   number
  listedOn?:      string
  ebayListingId?: string
  ebayAvgSold?:   number
  priceSource?:   string
  photos?:        Array<{ url?: string; thumb_url?: string } | string>
}

interface LegacySale {
  id:            string
  cardName:      string
  set?:          string
  number?:       string
  condition?:    string
  platform?:     string
  qtySold?:      number
  soldPrice?:    number
  fees?:         number
  shipping?:     number
  purchasePrice?: number
  saleDate?:     string
  status?:       string
  tracking?:     string
}

interface LegacySealed {
  id:           string
  productName:  string   // actual field name in legacy data
  setCode?:     string   // actual field name in legacy data
  productType?: string   // actual field name in legacy data
  qtyBought?:   number
  costPerUnit?: number
  qtyOpened?:  number
  qtySold?:    number
  source?:      string
  notes?:       string
}

async function readLegacyData(): Promise<LegacyData> {
  // The old table is 'cardvault' with a 'data' JSONB column
  const { data, error } = await supabase
    .from('cardvault')
    .select('data')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    failHard('Could not read legacy data from "cardvault" table. Check it exists.', error)
  }

  // data column is stored as TEXT in the legacy table, so parse it
  const raw = data['data']
  const blob = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  return {
    cards:  (blob['cards']  as LegacyCard[]  ?? []),
    sales:  (blob['sales']  as LegacySale[]  ?? []),
    sealed: (blob['sealed'] as LegacySealed[] ?? []),
  }
}

// ── Step 4: Migrate cards ─────────────────────────────────────────────────────

const CONDITION_MAP: Record<string, string> = {
  nm: 'NM', lp: 'LP', mp: 'MP', hp: 'HP', sealed: 'Sealed',
  'near mint': 'NM', 'lightly played': 'LP', 'moderately played': 'MP', 'heavily played': 'HP',
}

function normaliseCondition(c?: string): 'NM' | 'LP' | 'MP' | 'HP' | 'Sealed' {
  if (!c) return 'NM'
  return (CONDITION_MAP[c.toLowerCase()] ?? 'NM') as 'NM' | 'LP' | 'MP' | 'HP' | 'Sealed'
}

const STATUS_MAP: Record<string, string> = {
  'in stock': 'In Stock', 'listed': 'Listed', 'sold': 'Sold',
  'In Stock': 'In Stock', 'Listed': 'Listed', 'Sold': 'Sold',
}

async function migrateCards(orgId: string, ownerId: string, cards: LegacyCard[]) {
  log(`Migrating ${cards.length} cards…`)
  let ok = 0, skip = 0

  for (const c of cards) {
    if (!c.cardName?.trim()) { skip++; continue }

    const { data: inserted, error } = await supabase
      .from('cards')
      .upsert({
        // Use a stable UUID derived from the legacy ID so re-runs don't duplicate
        id:             uuidFromLegacyId(c.id),
        org_id:         orgId,
        card_name:      c.cardName.trim(),
        set_code:       c.setCode ?? '',
        card_number:    c.cardNumber ?? '',
        condition:      normaliseCondition(c.condition),
        foil_type:      c.foil ?? 'Normal',
        language:       c.language ?? 'EN',
        is_graded:      c.graded ?? false,
        grader:         c.grader ?? null,
        grade:          c.grade ?? null,
        qty:            c.qty ?? 1,
        status:         STATUS_MAP[c.status ?? 'In Stock'] ?? 'In Stock',
        purchase_price: c.purchasePrice ?? 0,
        purchase_date:  c.purchaseDate ?? null,
        source:         c.source ?? '',
        notes:          c.notes ?? '',
        listed_price:   c.listedPrice ?? null,
        listed_on:      c.listedOn ?? null,
        ebay_listing_id: c.ebayListingId ?? null,
        ebay_avg_sold:  c.ebayAvgSold ?? null,
        price_source:   c.priceSource ?? null,
        added_by:       ownerId,
      })
      .select('id')
      .single()

    if (error) {
      warn(`Card "${c.cardName}" failed: ${error.message}`)
      skip++
      continue
    }

    // Migrate photos
    const cardId = inserted['id'] as string
    const photos = (c.photos ?? [])
      .map((p, i) => {
        const url = typeof p === 'string' ? p : p?.url
        if (!url || url.startsWith('data:')) return null   // skip base64
        return {
          card_id:   cardId,
          url,
          thumb_url: typeof p === 'object' ? (p.thumb_url ?? null) : null,
          position:  i,
        }
      })
      .filter(Boolean)

    if (photos.length) {
      const { error: photoErr } = await supabase.from('card_photos').upsert(photos)
      if (photoErr) warn(`Photos for "${c.name}" failed: ${photoErr.message}`)
    }

    ok++
  }

  log(`Cards: ${ok} migrated, ${skip} skipped`)
}

// ── Step 5: Migrate sales ─────────────────────────────────────────────────────

async function migrateSales(orgId: string, ownerId: string, sales: LegacySale[]) {
  log(`Migrating ${sales.length} sales…`)
  let ok = 0, skip = 0

  const PLATFORM_MAP: Record<string, string> = {
    ebay: 'eBay', 'face to face': 'Face to Face', facebook: 'Facebook', other: 'Other',
    eBay: 'eBay', 'Face to Face': 'Face to Face', Facebook: 'Facebook', Other: 'Other',
  }

  const SALE_STATUS_MAP: Record<string, string> = {
    sold: 'Sold', shipped: 'Shipped', fulfilled: 'Fulfilled',
    Sold: 'Sold', Shipped: 'Shipped', Fulfilled: 'Fulfilled',
  }

  for (const s of sales) {
    if (!s.cardName?.trim()) { skip++; continue }
    if (!s.soldPrice) { skip++; continue }

    const { error } = await supabase.from('sales').upsert({
      id:             uuidFromLegacyId(s.id),
      org_id:         orgId,
      card_name:      s.cardName.trim(),
      set_code:       s.set ?? '',
      card_number:    s.number ?? '',
      condition:      s.condition ?? '',
      platform:       (PLATFORM_MAP[s.platform ?? 'eBay'] ?? 'Other') as 'eBay' | 'Face to Face' | 'Facebook' | 'Other',
      qty_sold:       s.qtySold ?? 1,
      sold_price:     s.soldPrice,
      fees:           s.fees ?? 0,
      shipping:       s.shipping ?? 0,
      purchase_price: s.purchasePrice ?? 0,
      sale_date:      s.saleDate ?? new Date().toISOString().split('T')[0],
      sale_status:    (SALE_STATUS_MAP[s.status ?? 'Sold'] ?? 'Sold') as 'Sold' | 'Shipped' | 'Fulfilled',
      tracking_number: s.tracking ?? null,
      sold_by:        ownerId,
    })

    if (error) { warn(`Sale "${s.cardName}" failed: ${error.message}`); skip++; continue }
    ok++
  }

  log(`Sales: ${ok} migrated, ${skip} skipped`)
}

// ── Step 6: Migrate sealed products ──────────────────────────────────────────

async function migrateSealed(orgId: string, sealed: LegacySealed[]) {
  log(`Migrating ${sealed.length} sealed products…`)
  let ok = 0, skip = 0

  const TYPE_MAP: Record<string, string> = {
    'booster box': 'Booster Box', 'elite trainer box': 'Elite Trainer Box',
    'etb': 'Elite Trainer Box', 'booster pack': 'Booster Pack',
    'tin': 'Tin', 'collection': 'Collection', 'other': 'Other',
  }

  for (const p of sealed) {
    if (!p.productName?.trim()) { skip++; continue }
    const typeKey = (p.productType ?? '').toLowerCase()
    const { error } = await supabase.from('sealed_products').upsert({
      id:           uuidFromLegacyId(p.id),
      org_id:       orgId,
      product_name: p.productName.trim(),
      set_code:     p.setCode ?? '',
      product_type: (TYPE_MAP[typeKey] ?? 'Other') as 'Booster Box' | 'Elite Trainer Box' | 'Booster Pack' | 'Tin' | 'Collection' | 'Other',
      qty_bought:   p.qtyBought ?? 1,
      cost_per_unit: p.costPerUnit ?? 0,
      qty_opened:   p.qtyOpened ?? 0,
      qty_sold:     p.qtySold ?? 0,
      source:       p.source ?? '',
      notes:        p.notes ?? '',
    })
    if (error) { warn(`Sealed "${p.name}" failed: ${error.message}`); skip++; continue }
    ok++
  }

  log(`Sealed: ${ok} migrated, ${skip} skipped`)
}

// ── Deterministic UUID from legacy ID string ──────────────────────────────────

function uuidFromLegacyId(legacyId: string): string {
  // Generate a v5-like UUID: SHA-1 of the legacy ID, formatted as UUID
  const hash = crypto.createHash('sha1').update(`cv-legacy:${legacyId}`).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),   // version 5
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('Starting CardVault Pro data migration v1 → v2')
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const orgId   = await ensureOrg()
  const ownerId = await ensureOwner(orgId)

  log('Reading legacy data from Supabase…')
  const legacy = await readLegacyData()
  log(`Found: ${legacy.cards.length} cards, ${legacy.sales.length} sales, ${legacy.sealed.length} sealed`)

  await migrateCards(orgId, ownerId, legacy.cards)
  await migrateSales(orgId, ownerId, legacy.sales)
  await migrateSealed(orgId, legacy.sealed)

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log('Migration complete ✓')
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
