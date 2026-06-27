// =============================================================================
// GET  /api/sealed  — list sealed products with optional type filter
// POST /api/sealed  — add a new sealed product
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError, z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, ok, created, serverError, validationError } from '@/lib/api'
import { CreateSealedProductSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

const ListSealedSchema = z.object({
  page:         z.coerce.number().int().min(1).default(1),
  limit:        z.coerce.number().int().min(1).max(200).default(100),
  product_type: z.enum([
    'Booster Box', 'Elite Trainer Box', 'Booster Pack', 'Tin', 'Collection', 'Other',
  ]).optional(),
  sort:  z.enum(['product_name', 'created_at', 'cost_per_unit', 'qty_remaining']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export async function GET(request: NextRequest) {
  try {
    const { orgId }  = await requireAuth()
    const params     = Object.fromEntries(request.nextUrl.searchParams)
    const query      = ListSealedSchema.parse(params)
    const supabase   = await createClient()

    let q = supabase
      .from('sealed_products')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (query.product_type) q = q.eq('product_type', query.product_type)

    q = q.order(query.sort, { ascending: query.order === 'asc' })

    const offset = (query.page - 1) * query.limit
    q = q.range(offset, offset + query.limit - 1)

    const { data, count, error } = await q

    if (error) return serverError(error)

    return ok({ data: data ?? [], count: count ?? 0, page: query.page, limit: query.limit })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()

    // Rate limit: 20 new sealed products per minute per IP
    const limit = await rateLimit(request, 'sealed-create', { max: 20, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const body  = await request.json() as unknown
    const input = CreateSealedProductSchema.parse(body)

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('sealed_products')
      .insert({
        org_id: orgId,
        ...input,
      })
      .select()
      .single()

    if (error) return serverError(error)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'sealed.create',
      entityType: 'sealed_product',
      entityId:   data.id,
      after:      input as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)

    return created(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
