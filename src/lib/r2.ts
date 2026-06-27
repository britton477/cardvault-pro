// =============================================================================
// Cloudflare R2 — Image Storage
// =============================================================================
// R2 is S3-compatible. We use @aws-sdk/client-s3 with the R2 endpoint.
// All image uploads go through the server-side API route /api/images/upload.
// The client never has direct R2 credentials.
// =============================================================================

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'

// Singleton client — instantiated once per Lambda/Edge invocation
let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env['R2_ACCOUNT_ID']!}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env['R2_ACCESS_KEY_ID']!,
        secretAccessKey: process.env['R2_SECRET_ACCESS_KEY']!,
      },
    })
  }
  return _client
}

const BUCKET = process.env['R2_BUCKET_NAME']!
const PUBLIC_URL = process.env['R2_PUBLIC_URL']!

// ── Upload raw buffer ─────────────────────────────────────────────────────────

export interface UploadResult {
  url:      string
  key:      string
}

export async function uploadImage(
  buffer: Buffer,
  mimeType: string,
  orgId: string,
  cardId: string,
): Promise<UploadResult> {
  const ext = mimeType.split('/')[1] ?? 'jpg'
  const hash = crypto.randomBytes(8).toString('hex')
  const key = `orgs/${orgId}/cards/${cardId}/${hash}.${ext}`

  await getClient().send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
    // Cache aggressively — images are content-addressed (hash in key)
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  return { url: `${PUBLIC_URL}/${key}`, key }
}

// ── Delete image ──────────────────────────────────────────────────────────────

export async function deleteImage(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

// ── Extract key from URL ──────────────────────────────────────────────────────

export function keyFromUrl(url: string): string {
  return url.replace(`${PUBLIC_URL}/`, '')
}

// ── Presigned upload URL (for client-side direct upload, future use) ──────────

export async function presignUpload(
  key: string,
  mimeType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    ContentType: mimeType,
  })
  return getSignedUrl(getClient(), cmd, { expiresIn: expiresInSeconds })
}
