// =============================================================================
// migrate-photos.cjs — Zero-dependency ImgBB → R2 migration
//
// Uses ONLY Node.js built-ins (crypto, fs, path, fetch).
// No npm packages required. Runs with plain node on Node 18+.
//
// Run from ANYWHERE:
//   node "F:\My Drive\CardVault Pro\app\scripts\migrate-photos.cjs"
//
// Or if you cd into the app directory first:
//   node scripts/migrate-photos.cjs
// =============================================================================

'use strict'

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

// ── Load .env.local (resolved relative to THIS script file, not cwd) ──────────
const ENV_PATH = path.join(__dirname, '..', '.env.local')
try {
  const raw = fs.readFileSync(ENV_PATH, 'utf-8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const val = t.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
  console.log('✓ Loaded', ENV_PATH)
} catch {
  console.log('ℹ .env.local not found at', ENV_PATH, '— falling back to process.env')
}

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const R2_ACCOUNT_ID    = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY    = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_KEY    = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET        = process.env.R2_BUCKET_NAME
const R2_PUBLIC_URL    = process.env.R2_PUBLIC_URL

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\n❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error('    Check that .env.local exists at:', path.join(__dirname, '..', '.env.local'))
  process.exit(1)
}

const USE_R2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET && R2_PUBLIC_URL)
console.log(`\n📦  Storage backend: ${USE_R2 ? 'Cloudflare R2' : 'Supabase Storage'}\n`)

// ── AWS SigV4 signing (for R2 PUT) ────────────────────────────────────────────

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function buildR2PutRequest(key, buffer, contentType) {
  const now      = new Date()
  // Format: 20240101T120000Z
  const amzDate  = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const dateStr  = amzDate.slice(0, 8)
  const host     = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const url      = `https://${host}/${R2_BUCKET}/${key}`
  const bodyHash = sha256hex(buffer)

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    'PUT',
    `/${R2_BUCKET}/${key}`,
    '',                   // no query string
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n')

  const scope         = `${dateStr}/auto/s3/aws4_request`
  const stringToSign  = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`

  const signingKey    = hmac(hmac(hmac(hmac(`AWS4${R2_SECRET_KEY}`, dateStr), 'auto'), 's3'), 'aws4_request')
  const signature     = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    url,
    headers: {
      'Content-Type':         contentType,
      'x-amz-date':           amzDate,
      'x-amz-content-sha256': bodyHash,
      'Cache-Control':        'public, max-age=31536000, immutable',
      'Authorization':        `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}

// ── Upload helpers ────────────────────────────────────────────────────────────

async function uploadToR2(buffer, key, contentType) {
  const { url, headers } = buildR2PutRequest(key, buffer, contentType)
  const res = await fetch(url, { method: 'PUT', headers, body: buffer })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`R2 PUT ${res.status}: ${text.slice(0, 300)}`)
  }
  return `${R2_PUBLIC_URL}/${key}`
}

async function uploadToSupabase(buffer, key, contentType) {
  const url = `${SUPABASE_URL}/storage/v1/object/card-photos/${key}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type':  contentType,
      'Cache-Control': '31536000',
    },
    body: buffer,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`Supabase Storage ${res.status}: ${body.message ?? JSON.stringify(body)}`)
  }
  return `${SUPABASE_URL}/storage/v1/object/public/card-photos/${key}`
}

async function upload(buffer, key, contentType) {
  return USE_R2 ? uploadToR2(buffer, key, contentType) : uploadToSupabase(buffer, key, contentType)
}

// ── Supabase REST API helpers ─────────────────────────────────────────────────

const SB_HEADERS = {
  'apikey':         SERVICE_ROLE_KEY,
  'Authorization':  `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type':   'application/json',
}

async function fetchImgbbPhotos() {
  // PostgREST: select card_photos joined to cards (many-to-one FK: card_photos.card_id → cards.id)
  const url = new URL(`${SUPABASE_URL}/rest/v1/card_photos`)
  url.searchParams.set('select',    'id,card_id,url,thumb_url,position,cards!inner(org_id)')
  url.searchParams.set('url',       'like.*i.ibb.co*')   // PostgREST LIKE, * = wildcard
  url.searchParams.set('order',     'created_at.asc')

  const res = await fetch(url.toString(), { headers: SB_HEADERS })
  if (!res.ok) throw new Error(`Failed to fetch photos: ${await res.text()}`)
  return res.json()
}

async function updatePhoto(id, newUrl, newThumbUrl) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/card_photos`)
  url.searchParams.set('id', `eq.${id}`)

  const res = await fetch(url.toString(), {
    method:  'PATCH',
    headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
    body:    JSON.stringify({ url: newUrl, thumb_url: newThumbUrl }),
  })
  if (!res.ok) throw new Error(`DB update failed: ${await res.text()}`)
}

// ── Download helper ───────────────────────────────────────────────────────────

async function downloadImage(imgUrl) {
  const res = await fetch(imgUrl, {
    headers: { 'User-Agent': 'CardVaultPro/2.0 migration' },
    signal:  AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${imgUrl}`)
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const buffer      = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType }
}

function ext(contentType) {
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('png'))  return 'png'
  return 'jpg'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const rows = await fetchImgbbPhotos()

  if (!rows.length) {
    console.log('✅  No ImgBB photos found — nothing to migrate.\n')
    return
  }

  console.log(`🔍  Found ${rows.length} photo${rows.length !== 1 ? 's' : ''} to migrate\n`)

  let success = 0
  let failed  = 0

  for (let i = 0; i < rows.length; i++) {
    const photo = rows[i]
    const label = `[${i + 1}/${rows.length}] ${photo.id.slice(0, 8)}…`
    process.stdout.write(`  ${label} downloading… `)

    try {
      const orgId  = photo.cards.org_id
      const hash   = crypto.randomBytes(8).toString('hex')

      // Download full image
      const { buffer: fullBuf, contentType: fullMime } = await downloadImage(photo.url)
      const fullKey  = `orgs/${orgId}/cards/${photo.card_id}/${hash}.${ext(fullMime)}`

      // Download thumb (fall back to full image if no separate thumb URL)
      let thumbBuf  = fullBuf
      let thumbMime = fullMime
      if (photo.thumb_url && photo.thumb_url !== photo.url && photo.thumb_url.includes('i.ibb.co')) {
        try {
          const dl  = await downloadImage(photo.thumb_url)
          thumbBuf  = dl.buffer
          thumbMime = dl.contentType
        } catch {
          // thumb download failed — use full image as thumb
        }
      }
      const thumbKey = `orgs/${orgId}/cards/${photo.card_id}/${hash}-thumb.${ext(thumbMime)}`

      process.stdout.write('uploading… ')

      const [newUrl, newThumbUrl] = await Promise.all([
        upload(fullBuf,  fullKey,  fullMime),
        upload(thumbBuf, thumbKey, thumbMime),
      ])

      await updatePhoto(photo.id, newUrl, newThumbUrl)

      console.log('✅')
      success++
    } catch (err) {
      console.log(`❌  ${err.message}`)
      failed++
    }

    // 300ms between photos — polite to ImgBB
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`✅  Migrated: ${success}`)
  if (failed > 0) console.log(`❌  Failed:   ${failed}  (re-run to retry)`)
  console.log(`${'─'.repeat(50)}\n`)
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
