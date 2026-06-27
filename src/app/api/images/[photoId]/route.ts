// =============================================================================
// DELETE /api/images/[photoId] — delete a card photo
//
// Removes the record from card_photos, then deletes both the full and thumb
// files from storage (R2 or Supabase Storage).
//
// Org-isolation: verifies the photo's card belongs to the authenticated org
// before doing anything.
// =============================================================================
import { type NextRequest } from 'next/server'
import { createClient }     from '@/lib/supabase/server'
import { requireAuth, ok, notFound, serverError } from '@/lib/api'
import { deleteCardImage }  from '@/lib/storage'
import { writeAuditLog }    from '@/lib/audit'

interface Params { params: Promise<{ photoId: string }> }

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

    // Type-safe org check — cards is a single joined row
    const cardOrg = (photo.cards as unknown as { org_id: string }).org_id
    if (cardOrg !== orgId) return notFound()  // 404 not 403 — don't leak existence

    // Delete DB record first (so if storage delete fails, the photo is gone from the UI)
    const { error: deleteErr } = await supabase
      .from('card_photos')
      .delete()
      .eq('id', photoId)

    if (deleteErr) return serverError(deleteErr)

    // Delete from storage (fire-and-forget safe — worst case we have orphaned objects)
    try {
      await deleteCardImage(photo.url, photo.thumb_url)
    } catch (storageErr) {
      // Log but don't fail the request — the DB record is already gone
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
