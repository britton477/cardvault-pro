// =============================================================================
// PATCH  /api/wishlist/[id]  — update a wishlist item
// DELETE /api/wishlist/[id]  — soft-delete a wishlist item
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createClient }     from '@/lib/supabase/server'
import {
  requireAuth, ok, notFound, serverError, validationError,
} from '@/lib/api'
import { UpdateWishlistSchema } from '@/types/validation'
import { writeAuditLog }    from '@/lib/audit'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

interface Ctx { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params

    const limit = await rateLimit(request, 'wishlist-update', { max: 60, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const body  = await request.json() as unknown
    const input = UpdateWishlistSchema.parse(body)

    const supabase = await createClient()

    // Fetch existing for audit diff + org guard
    const { data: existing, error: fetchErr } = await supabase
      .from('wishlist')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle()

    if (fetchErr) return serverError(fetchErr)
    if (!existing) return notFound('Wishlist item')

    const { data, error } = await supabase
      .from('wishlist')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) return serverError(error)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'wishlist.update',
      entityType: 'wishlist',
      entityId:   id,
      before:     existing as Record<string, unknown>,
      after:      input    as Record<string, unknown>,
    })

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params

    const limit = await rateLimit(request, 'wishlist-delete', { max: 30, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const supabase = await createClient()

    const { data: existing, error: fetchErr } = await supabase
      .from('wishlist')
      .select('card_name')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle()

    if (fetchErr) return serverError(fetchErr)
    if (!existing) return notFound('Wishlist item')

    const { error } = await supabase
      .from('wishlist')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) return serverError(error)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'wishlist.delete',
      entityType: 'wishlist',
      entityId:   id,
      before:     existing as Record<string, unknown>,
    })

    return ok({ id })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
