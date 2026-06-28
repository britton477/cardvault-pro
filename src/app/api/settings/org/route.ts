// =============================================================================
// GET   /api/settings/org  — fetch org_settings for the current user's org
// PATCH /api/settings/org  — update org_settings fields
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError, invalidateAuthCache } from '@/lib/api'
import { OrgSettingsSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const db = createAdminClient()

    // maybeSingle() returns null (not an error) when no row exists yet
    const { data, error } = await db
      .from('org_settings')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle()

    if (error) return serverError(error)

    // Return an empty-but-typed default so the client form still renders
    return ok(data ?? {
      org_id:                     orgId,
      markup_pct:                 0,
      shop_name:                  '',
      item_location:              '',
      ebay_username:              '',
      ebay_fulfillment_policy_id:      null,
      ebay_fulfillment_policy_id_high: null,
      ebay_payment_policy_id:          null,
      ebay_return_policy_id:           null,
      updated_at:                 null,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()
    const body  = await request.json() as unknown
    const input = OrgSettingsSchema.partial().parse(body)

    const db = createAdminClient()

    // Snapshot before-state for audit log
    const { data: before } = await db
      .from('org_settings')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle()

    // upsert: creates the row if it doesn't exist, updates if it does
    const { data, error } = await db
      .from('org_settings')
      .upsert(
        { org_id: orgId, ...input, updated_at: new Date().toISOString() },
        { onConflict: 'org_id' },
      )
      .select()
      .single()

    if (error) return serverError(error)

    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'settings.update',
      entityType: 'org_settings',
      entityId:   orgId,
      before:     before as Record<string, unknown>,
      after:      input  as Record<string, unknown>,
    })
    // Invalidate the auth profile cache so the next API request sees updated settings
    void invalidateAuthCache(user.id)

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
