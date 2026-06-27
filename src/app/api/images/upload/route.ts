// =============================================================================
// POST /api/images/upload — upload a photo for a card
//
// Accepts: multipart/form-data with fields: file, card_id, position
// Returns: { url, thumb_url, photo_id }
//
// Storage: R2 when configured, Supabase Storage otherwise.
// Processing: sharp converts to WebP at 85% quality; thumbs at 400px wide.
// =============================================================================
import { type NextRequest } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, ok, badRequest, serverError } from '@/lib/api'
import { uploadCardImage } from '@/lib/storage'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

const MAX_FILE_SIZE   = 10 * 1024 * 1024          // 10MB
const ALLOWED_TYPES   = ['image/jpeg', 'image/png', 'image/webp']
const THUMB_WIDTH     = 400

export async function POST(request: NextRequest) {
  try {
    // 30 uploads per 10 minutes — prevents storage abuse
    const limit = await rateLimit(request, 'image-upload', { max: 30, window: '10m' })
    if (!limit.success) return tooManyRequests(120)

    const { orgId } = await requireAuth()

    const formData = await request.formData()
    const file     = formData.get('file')
    const cardId   = formData.get('card_id')
    const position = parseInt(String(formData.get('position') ?? '0'), 10)

    if (!(file instanceof File))                  return badRequest('Missing file')
    if (!cardId || typeof cardId !== 'string')    return badRequest('Missing card_id')
    if (file.size > MAX_FILE_SIZE)                return badRequest('File exceeds 10MB limit')
    if (!ALLOWED_TYPES.includes(file.type))       return badRequest('Only JPEG, PNG and WebP are accepted')

    // Verify the card belongs to this org
    const supabase = await createClient()
    const { data: card } = await supabase
      .from('cards')
      .select('id')
      .eq('id', cardId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!card) return badRequest('Card not found')

    const buffer = Buffer.from(await file.arrayBuffer())

    // Resize + convert to WebP concurrently
    const [fullBuffer, thumbBuffer] = await Promise.all([
      sharp(buffer).webp({ quality: 85 }).toBuffer(),
      sharp(buffer).resize(THUMB_WIDTH).webp({ quality: 75 }).toBuffer(),
    ])

    // Upload to R2 or Supabase Storage
    const { url, thumbUrl } = await uploadCardImage(fullBuffer, thumbBuffer, orgId, cardId)

    // Persist record to card_photos
    const { data: photo, error } = await supabase
      .from('card_photos')
      .insert({
        card_id:   cardId,
        url,
        thumb_url: thumbUrl,
        position,
      })
      .select()
      .single()

    if (error) return serverError(error)

    return ok({ url, thumb_url: thumbUrl, photo_id: photo.id })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
