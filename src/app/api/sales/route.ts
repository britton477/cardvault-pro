// =============================================================================
// GET  /api/sales  — list sales with pagination and filters
// POST /api/sales  — record a new sale (optionally marks card as Sold)
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, created, serverError, validationError } from '@/lib/api'
import { CreateSaleSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { z } from 'zod'

const SaleQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(200).default(100),
  platform: z.enum(['eBay', 'Face to Face', 'Facebook', 'Other']).optional(),
  status:   z.enum(['Sold', 'Shipped', 'Fulfilled']).optional(),
  from:     z.string().date().optional(),
  to:       z.string().date().optional(),
  sort:     z.enum(['sale_date', 'sold_price', 'profit', 'created_at']).default('sale_date'),
  order:    z.enum(['asc', 'desc']).default('desc'),
})

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const params  = Object.fromEntries(request.nextUrl.searchParams)
    const query   = SaleQuerySchema.parse(params)

    const supabase = await createClient()
    let q = supabase
      .from('sales')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (query.platform) q = q.eq('platform', query.platform)
    if (query.status)   q = q.eq('sale_status', query.status)
    if (query.from)     q = q.gte('sale_date', query.from)
    if (query.to)       q = q.lte('sale_date', query.to)

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

    // Rate limit: 30 sale records per minute per IP
    const limit = await rateLimit(request, 'sales-create', { max: 30, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const body   = await request.json() as unknown
    const input  = CreateSaleSchema.parse(body)

    const supabase = await createClient()

    // If card_id provided, snapshot purchase_price and mark card sold
    let purchasePrice = input.purchase_price ?? 0
    if (input.card_id) {
      const { data: card } = await supabase
        .from('cards')
        .select('purchase_price, org_id')
        .eq('id', input.card_id)
        .eq('org_id', orgId)
        .single()

      if (card) {
        purchasePrice = purchasePrice || (card.purchase_price as number)
        // Mark card as Sold
        await supabase
          .from('cards')
          .update({ status: 'Sold' })
          .eq('id', input.card_id)
      }
    }

    const { data, error } = await supabase
      .from('sales')
      .insert({
        org_id:         orgId,
        sold_by:        user.id,
        purchase_price: purchasePrice,
        ...input,
      })
      .select()
      .single()

    if (error) return serverError(error)

    void writeAuditLog({
      orgId: orgId, userId: user.id,
      action: 'sale.create', entityType: 'sale', entityId: data.id,
      after: { ...input, purchase_price: purchasePrice } as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)
    // Refresh materialized dashboard stats cache (fire-and-forget)
    void createAdminClient().rpc('refresh_dashboard_cache', { p_org_id: orgId })

    return created(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
