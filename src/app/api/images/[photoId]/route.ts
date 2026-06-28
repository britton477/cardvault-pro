// =============================================================================
// DELETE /api/images/[photoId] — delete a card photo
// PATCH  /api/images/[photoId] — crop an existing card photo
//
// DELETE:
//   Removes the DB record, then deletes both full + thumb files from storage.
//   Org-isolation: verifies the photo's card belongs to the authenticated org.
//
// PATCH:
//   Body: { crop: { x, y, width, height } }  — all values are fractions 0–1
//         of the original image's natural dimensions.
//   Server fetches the original from storage, applies crop via sharp, uploads
//   a new full + thumb, updates the DB record in-place (same id), then deletes
//   the old storage objects.
//   Atomic ordering: upload NEW → update DB → delete OLD.
//   Worst case on failure: orphaned storage objects (no broken references in DB).
// =============================================================================
import { type NextRequest } from 'next/server'
import sharp                from 'sharp'
import { createClient }     from '@/lib/supabase/server'
import { requireAuth, ok, notFound, badRequest, serverError } from '@/lib/api'
import { uploadCardImage, deleteCardImage } from '@/lib/storage'
import { writeAuditLog }                   from '@/lib/audit'

interface Params { params: Promise<{ photoId: string }> }

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { orgId, user } = await requireAuth()
    const { photoId }     = await params

    const supabase = await createClient()

    // Fetch the photo — join to cards to verify org ownership
    const { data: photo, error: fetchErr } = await supabase
      .from('card_photos')
      .select('id, url, thumb_url, card_id, cards!inner(org_id)')
      .eq('id', photoId)
      .single()

    if (fetchErr || !photo) return notFound()

    const cardOrg = (photo.cards as unknown as { org_id: string }).org_id
    if (cardOrg !== orgId) return notFound()

    // Delete DB record first (UI updates immediately; storage delete is best-effort)
    const { error: deleteErr } = await supabase
      .from('card_photos')
      .delete()
      .eq('id', photoId)

    if (deleteErr) return serverError(deleteErr)

    // Delete from storage (fire-and-forget — worst case: orphaned objects)
    try {
      await deleteCardImage(photo.url, photo.thumb_url)
    } catch (storageErr) {
      console.error('[images/delete] Storage delete failed:', storageErr)
    }

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'card.photo_delete',
      entityType: 'card_photo',
      entityId:   photoId,
      before:     { card_id: photo.card_id, url: photo.url },
    })

    return ok({ deleted: photoId })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

interface CropBody {
  crop: { x: number; y: number; width: number; height: number }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { orgId, user } = await requireAuth()
    const { photoId }     = await params

    const body = await request.json() as CropBody
    const { crop } = body

    // Validate crop values are in [0, 1] and crop area is non-trivial
    if (
      typeof crop?.x !== 'number' || typeof crop?.y !== 'number' ||
      typeof crop?.width !== 'number' || typeof crop?.height !== 'number' ||
      crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
      crop.x + crop.width > 1.001 || crop.y + crop.height > 1.001
    ) {
      return badRequest('Invalid crop coordinates — values must be fractions 0–1')
    }

    const supabase = await createClient()

    // Fetch photo + verify org ownership via card join
    const { data: photo, error: fetchErr } = await supabase
      .from('card_photos')
      .select('id, url, thumb_url, card_id, cards!inner(org_id)')
      .eq('id', photoId)
      .single()

    if (fetchErr || !photo) return notFound()

    const cardOrg = (photo.cards as unknown as { org_id: string }).org_id
    if (cardOrg !== orgId) return notFound()

    // Fetch original image from storage (server-side: no CORS restrictions)
    const originalRes = await fetch(photo.url)
    if (!originalRes.ok) {
      return serverError(new Error(`Failed to fetch original image (${originalRes.status})`))
    }
    const originalBuffer = Buffer.from(await originalRes.arrayBuffer())

    // Get natural dimensions
    const meta = await sharp(originalBuffer).metadata()
    const natW  = meta.width
    const natH  = meta.height
    if (!natW || !natH) return serverError(new Error('Could not read image dimensions'))

    // Map percentage crop to pixel extract params (clamp to avoid sharp errors)
    const left   = Math.max(0, Math.round(crop.x * natW))
    const top    = Math.max(0, Math.round(crop.y * natH))
    const width  = Math.min(natW - left, Math.max(1, Math.round(crop.width  * natW)))
    const height = Math.min(natH - top,  Math.max(1, Math.round(crop.height * natH)))

    const sharpBase = sharp(originalBuffer).extract({ left, top, width, height })

    // Process full + thumb concurrently
    const [fullBuffer, thumbBuffer] = await Promise.all([
      sharpBase.clone().webp({ quality: 85 }).toBuffer(),
      sharpBase.clone().resize(400).webp({ quality: 75 }).toBuffer(),
    ])

    // Upload new version — this creates a NEW storage key (random hash)
    const { url: newUrl, thumbUrl: newThumbUrl } = await uploadCardImage(
      fullBuffer, thumbBuffer, orgId, photo.card_id,
    )

    // Update DB record in-place (same id — avoids changing references elsewhere)
    const { error: updateErr } = await supabase
      .from('card_photos')
      .update({ url: newUrl, thumb_url: newThumbUrl })
      .eq('id', photoId)

    if (updateErr) {
      // DB update failed — try to clean up the new storage objects we just created
      deleteCardImage(newUrl, newThumbUrl).catch(console.error)
      return serverError(updateErr)
    }

    // Delete old storage objects (non-blocking — DB already updated)
    deleteCardImage(photo.url, photo.thumb_url).catch(err => {
      console.error('[images/crop] Old storage delete failed (orphaned objects):', err)
    })

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'card.photo_crop',
      entityType: 'card_photo',
      entityId:   photoId,
      before:     { url: photo.url },
      after:      { url: newUrl, crop },
    })

    return ok({ url: newUrl, thumb_url: newThumbUrl, photo_id: photoId })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
