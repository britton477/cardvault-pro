// =============================================================================
// GET  /api/wishlist  — list wishlist items (filterable by status / priority)
// POST /api/wishlist  — add a new wishlist item
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError, z }      from 'zod'
import { createClient }     from '@/lib/supabase/server'
import { requireAuth, ok, created, serverError, validationError } from '@/lib/api'
import { CreateWishlistSchema } from '@/types/validation'
import { writeAuditLog }    from '@/lib/audit'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

const ListWishlistSchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(200).default(100),
  status:   z.enum(['wanted', 'found', 'purchased']).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  search:   z.string().max(200).optional(),
  sort:     z.enum(['card_name', 'created_at', 'target_price', 'priority']).default('created_at'),
  order:    z.enum(['asc', 'desc']).default('desc'),
})

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const params    = Object.fromEntries(request.nextUrl.searchParams)
    const query     = ListWishlistSchema.parse(params)
    const supabase  = await createClient()

    let q = supabase
      .from('wishlist')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (query.status)   q = q.eq('status', query.status)
    if (query.priority) q = q.eq('priority', query.priority)
    if (query.search)   q = q.ilike('card_name', `%${query.search}%`)

    // Priority sort: high → normal → low via custom order
    if (query.sort === 'priority') {
      q = q.order('priority', { ascending: query.order === 'asc' })
    } else {
      q = q.order(query.sort, { ascending: query.order === 'asc' })
    }

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

    const limit = await rateLimit(request, 'wishlist-create', { max: 30, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const body  = await request.json() as unknown
    const input = CreateWishlistSchema.parse(body)

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('wishlist')
      .insert({ org_id: orgId, added_by: user.id, status: 'wanted', ...input })
      .select()
      .single()

    if (error) return serverError(error)

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'wishlist.create',
      entityType: 'wishlist',
      entityId:   data.id,
      after:      input as Record<string, unknown>,
    })

    return created(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
