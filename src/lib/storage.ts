// =============================================================================
// Unified image storage — R2 preferred, Supabase Storage fallback
//
// Upload path: orgs/{orgId}/cards/{cardId}/{hash}.webp
// Thumb path:  orgs/{orgId}/cards/{cardId}/{hash}-thumb.webp
//
// The calling code never needs to know which backend was used — it just
// gets back a public URL and stores it in card_photos.
// =============================================================================
import crypto from 'crypto'
import { features } from '@/lib/env'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeKey(orgId: string, cardId: string, suffix: string): string {
  const hash = crypto.randomBytes(8).toString('hex')
  return `orgs/${orgId}/cards/${cardId}/${hash}${suffix}.webp`
}

// ── R2 upload (when credentials are present) ──────────────────────────────────

async function uploadToR2(
  buffer: Buffer,
  key: string,
): Promise<string> {
  // Lazy-import to avoid loading AWS SDK when R2 isn't configured
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

  const client = new S3Client({
    region:   'auto',
    endpoint: `https://${process.env['R2_ACCOUNT_ID']!}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env['R2_ACCESS_KEY_ID']!,
      secretAccessKey: process.env['R2_SECRET_ACCESS_KEY']!,
    },
  })

  await client.send(new PutObjectCommand({
    Bucket:       process.env['R2_BUCKET_NAME']!,
    Key:          key,
    Body:         buffer,
    ContentType:  'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  const publicUrl = process.env['R2_PUBLIC_URL']!
  return `${publicUrl}/${key}`
}

async function deleteFromR2(url: string): Promise<void> {
  const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
  const publicUrl = process.env['R2_PUBLIC_URL']!
  const key = url.replace(`${publicUrl}/`, '')

  const client = new S3Client({
    region:   'auto',
    endpoint: `https://${process.env['R2_ACCOUNT_ID']!}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env['R2_ACCESS_KEY_ID']!,
      secretAccessKey: process.env['R2_SECRET_ACCESS_KEY']!,
    },
  })

  await client.send(new DeleteObjectCommand({
    Bucket: process.env['R2_BUCKET_NAME']!,
    Key:    key,
  }))
}

// ── Supabase Storage upload (fallback) ───────────────────────────────────────

async function uploadToSupabase(
  buffer: Buffer,
  key: string,
): Promise<string> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const admin = createAdminClient()

  const { error } = await admin.storage
    .from('card-photos')
    .upload(key, buffer, {
      contentType:  'image/webp',
      cacheControl: '31536000',
      upsert:       false,
    })

  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)

  const { data } = admin.storage.from('card-photos').getPublicUrl(key)

  // Supabase Storage returns a signed URL for private buckets;
  // for private buckets we store the path and sign at read time.
  // Instead we'll use createSignedUrl at read time — but for simplicity
  // and since card_photos.url is always read server-side, store the path
  // as a special marker URL that we can detect.
  // Actually: let's make the bucket public-readable for simplicity.
  // The RLS policies still prevent unauthorised uploads/deletes.
  return data.publicUrl
}

async function deleteFromSupabase(url: string): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const admin = createAdminClient()

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']!
  // Extract storage path from URL
  // URL format: {supabaseUrl}/storage/v1/object/public/card-photos/{key}
  const prefix = `${supabaseUrl}/storage/v1/object/public/card-photos/`
  const key    = url.replace(prefix, '')

  const { error } = await admin.storage.from('card-photos').remove([key])
  if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`)
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface StorageUploadResult {
  url:       string
  thumbUrl:  string
  backend:   'r2' | 'supabase'
}

export async function uploadCardImage(
  fullBuffer:  Buffer,
  thumbBuffer: Buffer,
  orgId:       string,
  cardId:      string,
): Promise<StorageUploadResult> {
  const fullKey  = makeKey(orgId, cardId, '')
  const thumbKey = makeKey(orgId, cardId, '-thumb')

  if (features.r2Enabled) {
    const [url, thumbUrl] = await Promise.all([
      uploadToR2(fullBuffer,  fullKey),
      uploadToR2(thumbBuffer, thumbKey),
    ])
    return { url, thumbUrl, backend: 'r2' }
  }

  // Supabase Storage fallback
  const [url, thumbUrl] = await Promise.all([
    uploadToSupabase(fullBuffer,  fullKey),
    uploadToSupabase(thumbBuffer, thumbKey),
  ])
  return { url, thumbUrl, backend: 'supabase' }
}

export async function deleteCardImage(
  url:      string,
  thumbUrl: string | null,
): Promise<void> {
  const isR2 = url.includes(process.env['R2_PUBLIC_URL'] ?? '__r2__')

  if (isR2) {
    await Promise.all([
      deleteFromR2(url),
      thumbUrl ? deleteFromR2(thumbUrl) : Promise.resolve(),
    ])
  } else {
    await Promise.all([
      deleteFromSupabase(url),
      thumbUrl ? deleteFromSupabase(thumbUrl) : Promise.resolve(),
    ])
  }
}
