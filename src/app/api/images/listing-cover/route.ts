// =============================================================================
// POST /api/images/listing-cover — upload a cover image for a set listing
//
// Accepts: multipart/form-data with field: file
// Returns: { url, thumb_url }
//
// Distinct from /api/images/upload because a cover image belongs to a LISTING,
// not a card. It has no card_id to verify and writes no card_photos row — it is
// just a hosted URL handed to eBay as the first gallery image.
//
// Same processing as card photos: WebP at 85% quality, 400px thumbnail.
// =============================================================================
import { type NextRequest } from 'next/server'
import crypto from 'crypto'
import sharp from 'sharp'
import { requireAuth, ok, badRequest, serverError } from '@/lib/api'
import { uploadCardImage } from '@/lib/storage'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

const MAX_FILE_SIZE = 10 * 1024 * 1024          // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const THUMB_WIDTH   = 400

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireAuth({ feature: 'ebay.bulk_list' })

    // Far lower than the card-photo limit: covers are uploaded one at a time,
    // not in 500-card batches.
    const limit = await rateLimit(request, `cover-upload:${orgId}`, { max: 30, window: '10m' })
    if (!limit.success) return tooManyRequests(120)

    const formData = await request.formData()
    const file     = formData.get('file')

    if (!(file instanceof File))            return badRequest('Missing file')
    if (file.size > MAX_FILE_SIZE)          return badRequest('File exceeds 10MB limit')
    if (!ALLOWED_TYPES.includes(file.type)) return badRequest('Only JPEG, PNG and WebP are accepted')

    const buffer = Buffer.from(await file.arrayBuffer())

    const [fullBuffer, thumbBuffer] = await Promise.all([
      sharp(buffer).webp({ quality: 85 }).toBuffer(),
      sharp(buffer).resize(THUMB_WIDTH).webp({ quality: 75 }).toBuffer(),
    ])

    // Synthetic key — the storage helper partitions by org and id, and a cover
    // has no card to key on. Random so re-uploads never collide.
    const coverKey = `cover-${crypto.randomUUID()}`

    const { url, thumbUrl } = await uploadCardImage(fullBuffer, thumbBuffer, orgId, coverKey)

    return ok({ url, thumb_url: thumbUrl })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
