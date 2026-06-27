// =============================================================================
// GET  /api/buyers  — list buyers with computed sale stats
// POST /api/buyers  — create a new buyer profile
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError, z }      from 'zod'
import { createAdminClient }                            from '@/lib/supabase/server'
import { requireAuth, ok, created, serverError, validationError } from '@/lib/api'
import { CreateBuyerSchema }                            from '@/types/validation'
import { writeAuditLog }                                from '@/lib/audit'

const ListBuyersSchema = z.object({
  search: z.string().optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const params    = Object.fromEntries(request.nextUrl.searchParams)
    const { search, page, limit } = ListBuyersSchema.parse(params)

    const db     = createAdminClient()
    const offset = (page - 1) * limit

    // Fetch buyers + their sales for stat computation
    let q = db
      .from('buyers')
      .select(`
        *,
        sales(sold_price, sale_date, deleted_at)
      `, { count: 'exact' })
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1)

    if (search) q = q.ilike('name', `%${search}%`)

    const { data, count, error } = await q
    if (error) throw error

    const buyers = (data ?? []).map(buyer => {
      const activeSales = ((buyer.sales ?? []) as Array<{ sold_price: number; sale_date: string; deleted_at: string | null }>)
        .filter(s => !s.deleted_at)

      const sale_count   = activeSales.length
      const total_spent  = activeSales.reduce((sum, s) => sum + (s.sold_price ?? 0), 0)
      const last_sale_at = activeSales
        .map(s => s.sale_date)
        .sort()
        .at(-1) ?? null

      const { sales: _sales, ...rest } = buyer
      return { ...rest, sale_count, total_spent, last_sale_at }
    })

    return ok({ data: buyers, count: count ?? 0, page, limit })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()
    const body  = await request.json() as unknown
    const input = CreateBuyerSchema.parse(body)

    const db = createAdminClient()
    const { data, error } = await db
      .from('buyers')
      .insert({ org_id: orgId, created_by: user.id, ...input })
      .select()
      .single()

    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action: 'buyer.create', entityType: 'buyer', entityId: data.id,
      after: input as Record<string, unknown>,
    })

    return created({ ...data, sale_count: 0, total_spent: 0, last_sale_at: null })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
