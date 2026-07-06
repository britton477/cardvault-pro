// =============================================================================
// GET    /api/buyers/[id]  — buyer profile + full purchase history
// PATCH  /api/buyers/[id]  — update buyer
// DELETE /api/buyers/[id]  — soft-delete
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                      from '@/lib/supabase/server'
import { requireAuth, ok, noContent, notFound, serverError, validationError } from '@/lib/api'
import { UpdateBuyerSchema }                                      from '@/types/validation'
import { writeAuditLog }                                          from '@/lib/audit'

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { orgId } = await requireAuth({ feature: 'buyers_crm' })
    const { id }    = await params

    const db = createAdminClient()

    const [buyerRes, salesRes] = await Promise.all([
      db.from('buyers')
        .select('*')
        .eq('id', id)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .single(),

      db.from('sales')
        .select('id, card_name, set_code, condition, sold_price, platform, sale_date, sale_status, profit')
        .eq('org_id', orgId)
        .eq('buyer_id', id)
        .is('deleted_at', null)
        .order('sale_date', { ascending: false })
        .limit(100),
    ])

    if (buyerRes.error || !buyerRes.data) return notFound()

    const sales      = salesRes.data ?? []
    const sale_count  = sales.length
    const total_spent = sales.reduce((sum, s) => sum + (s.sold_price as number), 0)
    const last_sale_at = sales[0]?.sale_date ?? null

    return ok({
      ...buyerRes.data,
      sale_count,
      total_spent,
      last_sale_at,
      sales,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'buyers_crm' })
    const { id }          = await params
    const body            = await request.json() as unknown
    const input           = UpdateBuyerSchema.parse(body)

    const db = createAdminClient()
    const { data, error } = await db
      .from('buyers')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .select()
      .single()

    if (error || !data) return notFound()

    void writeAuditLog({
      orgId, userId: user.id,
      action: 'buyer.update', entityType: 'buyer', entityId: id,
      after: input as Record<string, unknown>,
    })

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'buyers_crm' })
    const { id }          = await params

    const db = createAdminClient()
    const { error } = await db
      .from('buyers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action: 'buyer.delete', entityType: 'buyer', entityId: id,
    })

    return noContent()
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
