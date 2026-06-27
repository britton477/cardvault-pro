// =============================================================================
// GET /api/admin/migrate-photos
//
// One-time migration: moves all ImgBB-hosted card photos to R2.
// Hit this URL once in your browser while dev server is running.
// Safe to re-run — only processes rows with i.ibb.co URLs.
// DELETE THIS FILE after migration is complete.
// =============================================================================
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'

interface PhotoRow {
  id:        string
  card_id:   string
  url:       string
  thumb_url: string | null
  position:  number
  cards:     { org_id: string }
}

interface Result {
  id:      string
  status:  'ok' | 'failed'
  error?:  string
  newUrl?: string
}

export async function GET() {
  const R2_ACCOUNT_ID = process.env['R2_ACCOUNT_ID']
  const R2_ACCESS_KEY = process.env['R2_ACCESS_KEY_ID']
  const R2_SECRET_KEY = process.env['R2_SECRET_ACCESS_KEY']
  const R2_BUCKET     = process.env['R2_BUCKET_NAME']
  const R2_PUBLIC_URL = process.env['R2_PUBLIC_URL']

  const USE_R2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET && R2_PUBLIC_URL)

  if (!USE_R2) {
    return NextResponse.json({ error: 'R2 env vars not set' }, { status: 500 })
  }

  const r2 = new S3Client({
    region:   'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY!, secretAccessKey: R2_SECRET_KEY! },
  })

  const db = createAdminClient()

  const { data: photos, error } = await db
    .from('card_photos')
    .select('id, card_id, url, thumb_url, position, cards!inner(org_id)')
    .like('url', '%i.ibb.co%')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!photos || photos.length === 0) {
    return NextResponse.json({ message: 'No ImgBB photos to migrate', migrated: 0 })
  }

  const rows = photos as unknown as PhotoRow[]
  const results: Result[] = []

  for (const photo of rows) {
    try {
      const orgId = photo.cards.org_id

      // Download full image
      const fullRes = await fetch(photo.url, {
        headers: { 'User-Agent': 'CardVaultPro/2.0 migration' },
        signal:  AbortSignal.timeout(30_000),
      })
      if (!fullRes.ok) throw new Error(`HTTP ${fullRes.status} fetching full image`)
      const fullBuffer    = Buffer.from(await fullRes.arrayBuffer())
      const fullMime      = fullRes.headers.get('content-type') ?? 'image/jpeg'
      const ext           = fullMime.includes('webp') ? 'webp' : fullMime.includes('png') ? 'png' : 'jpg'
      const hash          = crypto.randomBytes(8).toString('hex')
      const fullKey       = `orgs/${orgId}/cards/${photo.card_id}/${hash}.${ext}`

      // Download thumb (if separate ImgBB URL)
      let thumbBuffer  = fullBuffer
      let thumbMime    = fullMime
      let thumbKey     = `orgs/${orgId}/cards/${photo.card_id}/${hash}-thumb.${ext}`

      if (photo.thumb_url && photo.thumb_url.includes('i.ibb.co') && photo.thumb_url !== photo.url) {
        const thumbRes = await fetch(photo.thumb_url, {
          headers: { 'User-Agent': 'CardVaultPro/2.0 migration' },
          signal:  AbortSignal.timeout(30_000),
        })
        if (thumbRes.ok) {
          thumbBuffer = Buffer.from(await thumbRes.arrayBuffer())
          thumbMime   = thumbRes.headers.get('content-type') ?? fullMime
          const tExt  = thumbMime.includes('webp') ? 'webp' : thumbMime.includes('png') ? 'png' : 'jpg'
          thumbKey    = `orgs/${orgId}/cards/${photo.card_id}/${hash}-thumb.${tExt}`
        }
      }

      // Upload to R2
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET!, Key: fullKey, Body: fullBuffer,
        ContentType: fullMime, CacheControl: 'public, max-age=31536000, immutable',
      }))
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET!, Key: thumbKey, Body: thumbBuffer,
        ContentType: thumbMime, CacheControl: 'public, max-age=31536000, immutable',
      }))

      const newUrl      = `${R2_PUBLIC_URL}/${fullKey}`
      const newThumbUrl = `${R2_PUBLIC_URL}/${thumbKey}`

      // Update DB
      const { error: updateErr } = await db
        .from('card_photos')
        .update({ url: newUrl, thumb_url: newThumbUrl })
        .eq('id', photo.id)

      if (updateErr) throw new Error(updateErr.message)

      results.push({ id: photo.id, status: 'ok', newUrl })

      // Polite delay
      await new Promise(r => setTimeout(r, 300))
    } catch (err) {
      results.push({
        id:     photo.id,
        status: 'failed',
        error:  err instanceof Error ? err.message : String(err),
      })
    }
  }

  const ok     = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status === 'failed').length

  return NextResponse.json({
    total:   rows.length,
    migrated: ok,
    failed,
    results,
  })
}
