// =============================================================================
// scripts/migrate-imgbb-photos.ts
//
// Migrates all ImgBB-hosted card photos to R2 (or Supabase Storage fallback).
//
// For each card_photos row with an i.ibb.co URL:
//   1. Downloads the original image from ImgBB
//   2. Uploads as-is to R2 / Supabase Storage (no sharp re-processing)
//   3. Updates the card_photos row with the new url + thumb_url
//
// Run:
//   npx tsx scripts/migrate-imgbb-photos.ts
//
// Requires these env vars (add to .env.local then run):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_BUCKET_NAME, R2_PUBLIC_URL   (or just Supabase Storage if R2 not set)
// =============================================================================

// Load .env.local manually (dotenv/config looks for .env, not .env.local)
import { readFileSync } from 'fs'
import { resolve } from 'path'
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* .env.local not found — rely on existing process.env */ }

import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'

// ── Config ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env['NEXT_PUBLIC_SUPABASE_URL']!
const SERVICE_ROLE_KEY  = process.env['SUPABASE_SERVICE_ROLE_KEY']!
const R2_ACCOUNT_ID     = process.env['R2_ACCOUNT_ID']
const R2_ACCESS_KEY     = process.env['R2_ACCESS_KEY_ID']
const R2_SECRET_KEY     = process.env['R2_SECRET_ACCESS_KEY']
const R2_BUCKET         = process.env['R2_BUCKET_NAME']
const R2_PUBLIC_URL     = process.env['R2_PUBLIC_URL']

const USE_R2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET && R2_PUBLIC_URL)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

console.log(`\n📦  Storage backend: ${USE_R2 ? 'Cloudflare R2' : 'Supabase Storage'}`)

// ── Clients ────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const r2 = USE_R2 ? new S3Client({
  region:   'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY!, secretAccessKey: R2_SECRET_KEY! },
}) : null

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeKey(orgId: string, cardId: string, suffix: string, ext: string): string {
  const hash = crypto.randomBytes(8).toString('hex')
  return `orgs/${orgId}/cards/${cardId}/${hash}${suffix}.${ext}`
}

function mimeToExt(contentType: string): string {
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('png'))  return 'png'
  return 'jpg'
}

async function uploadToR2(buffer: Buffer, key: string, contentType: string): Promise<string> {
  await r2!.send(new PutObjectCommand({
    Bucket:       R2_BUCKET!,
    Key:          key,
    Body:         buffer,
    ContentType:  contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return `${R2_PUBLIC_URL}/${key}`
}

async function uploadToSupabase(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const { error } = await supabase.storage
    .from('card-photos')
    .upload(key, buffer, { contentType, cacheControl: '31536000', upsert: false })

  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  const { data } = supabase.storage.from('card-photos').getPublicUrl(key)
  return data.publicUrl
}

async function upload(buffer: Buffer, key: string, contentType: string): Promise<string> {
  return USE_R2 ? uploadToR2(buffer, key, contentType) : uploadToSupabase(buffer, key, contentType)
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CardVaultPro/2.0 (migration bot)' },
    signal:  AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType }
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface PhotoRow {
  id:        string
  card_id:   string
  url:       string
  thumb_url: string | null
  position:  number
  cards:     { org_id: string }
}

async function main() {
  // Fetch all ImgBB photos with their card's org_id
  const { data: photos, error } = await supabase
    .from('card_photos')
    .select('id, card_id, url, thumb_url, position, cards!inner(org_id)')
    .like('url', '%i.ibb.co%')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('❌  Failed to fetch photos:', error.message)
    process.exit(1)
  }

  if (!photos || photos.length === 0) {
    console.log('✅  No ImgBB photos found — nothing to migrate.')
    return
  }

  const rows = photos as unknown as PhotoRow[]
  console.log(`\n🔍  Found ${rows.length} ImgBB photo${rows.length !== 1 ? 's' : ''} to migrate\n`)

  let success = 0
  let failed  = 0

  for (const [i, photo] of rows.entries()) {
    const label = `[${i + 1}/${rows.length}] photo ${photo.id.slice(0, 8)}…`
    process.stdout.write(`  ${label} downloading… `)

    try {
      const orgId = photo.cards.org_id

      // Download full image
      const { buffer: fullBuffer, contentType } = await downloadImage(photo.url)
      const ext = mimeToExt(contentType)

      // Download thumb (or reuse full if no separate thumb URL)
      let thumbBuffer = fullBuffer
      let thumbContentType = contentType
      if (photo.thumb_url && photo.thumb_url !== photo.url && photo.thumb_url.includes('i.ibb.co')) {
        const dl = await downloadImage(photo.thumb_url)
        thumbBuffer = dl.buffer
        thumbContentType = dl.contentType
      }

      const fullKey  = makeKey(orgId, photo.card_id, '', ext)
      const thumbKey = makeKey(orgId, photo.card_id, '-thumb', mimeToExt(thumbContentType))

      // Upload both
      process.stdout.write('uploading… ')
      const [newUrl, newThumbUrl] = await Promise.all([
        upload(fullBuffer,  fullKey,  contentType),
        upload(thumbBuffer, thumbKey, thumbContentType),
      ])

      // Update DB row
      const { error: updateErr } = await supabase
        .from('card_photos')
        .update({ url: newUrl, thumb_url: newThumbUrl })
        .eq('id', photo.id)

      if (updateErr) throw new Error(updateErr.message)

      console.log('✅')
      success++
    } catch (err) {
      console.log(`❌  ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }

    // Small delay to avoid hammering ImgBB
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`✅  Migrated: ${success}`)
  if (failed > 0) {
    console.log(`❌  Failed:   ${failed}  (re-run to retry)`)
  }
  console.log(`${'─'.repeat(50)}\n`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
