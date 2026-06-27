// =============================================================================
// PATCH  /api/sales/:id  — update sale (status, tracking, etc.)
// DELETE /api/sales/:id  — soft-delete sale
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, ok, noContent, notFound, serverError, validationError } from '@/lib/api'
import { UpdateSaleSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = UpdateSaleSchema.parse(body)

    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('sales')
      .select('id, org_id, sale_status')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!existing) return notFound('Sale not found')

    const { data, error } = await supabase
      .from('sales')
      .update(input)
      .eq('id', id)
      .select()
      .single()

    if (error) return serverError(error)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'sale.update',
      entityType: 'sale',
      entityId:   id,
      before:     existing as Record<string, unknown>,
      after:      input    as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth()
    const { id }          = await params
    const supabase        = await createClient()

    const { data: existing } = await supabase
      .from('sales')
      .select('id, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!existing) return notFound('Sale not found')

    const { error } = await supabase
      .from('sales')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return serverError(error)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'sale.delete',
      entityType: 'sale',
      entityId:   id,
      before:     existing as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
