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
import { pushQuantitiesWithRecovery, pushSingleListingQuantity } from '@/lib/ebay-sync'
import { z } from 'zod'

const SaleQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(200).default(100),
  search:   z.string().max(200).optional(),
  platform: z.enum(['eBay', 'Face to Face', 'Facebook', 'Other']).optional(),
  status:   z.enum(['Sold', 'Shipped', 'Fulfilled']).optional(),
  from:     z.string().date().optional(),
  to:       z.string().date().optional(),
  /** Filter to sales imported from eBay that need a cost basis confirmed */
  needs_review: z.enum(['true', 'false']).optional(),
  /** Filter to sales with any refund recorded */
  refunded:     z.enum(['true', 'false']).optional(),
  sort:     z.enum([
    'sale_date', 'sold_price', 'profit', 'created_at',
    'card_name', 'buyer_name', 'qty_sold', 'fees',
  ]).default('sale_date'),
  order:    z.enum(['asc', 'desc']).default('desc'),
})

/**
 * Escape PostgREST `or()` filter metacharacters in user search input.
 *
 * The or() string is parsed as a comma-separated expression list, so an
 * unescaped comma or parenthesis in a search term would be read as filter
 * syntax rather than data and either error or match the wrong rows.
 */
function escapeSearchTerm(raw: string): string {
  return raw.replace(/[,()\\]/g, ' ').trim()
}

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

    if (query.needs_review === 'true')  q = q.eq('needs_review', true)
    if (query.needs_review === 'false') q = q.eq('needs_review', false)
    if (query.refunded === 'true')      q = q.gt('refund_amount', 0)
    if (query.refunded === 'false')     q = q.eq('refund_amount', 0)

    // Search across the fields a user would actually recall: what sold, which
    // set, who bought it, and the tracking number off a parcel.
    if (query.search) {
      const term = escapeSearchTerm(query.search)
      if (term) {
        q = q.or(
          `card_name.ilike.%${term}%,` +
          `set_code.ilike.%${term}%,` +
          `card_number.ilike.%${term}%,` +
          `buyer_name.ilike.%${term}%,` +
          `tracking_number.ilike.%${term}%`,
        )
      }
    }

    // Secondary sort on id keeps pagination stable when the primary key ties
    // (several sales sharing a sale_date is the common case).
    q = q
      .order(query.sort, { ascending: query.order === 'asc' })
      .order('id', { ascending: false })

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

    // If card_id provided, snapshot purchase_price and draw down stock.
    let purchasePrice = input.purchase_price ?? 0
    if (input.card_id) {
      const { data: card } = await supabase
        .from('cards')
        .select('purchase_price, org_id, qty, listing_type, ebay_listing_id, ebay_set_listing_id')
        .eq('id', input.card_id)
        .eq('org_id', orgId)
        .single()

      if (card) {
        purchasePrice = purchasePrice || (card.purchase_price as number)

        // Draw down quantity by the number of units sold. Only mark the card
        // Sold once nothing is left — a card with qty 3 that sells 1 still has
        // stock and must stay listed.
        const qtyBefore = (card['qty'] as number | null) ?? 1
        const qtySold   = input.qty_sold ?? 1
        const qtyAfter  = Math.max(0, qtyBefore - qtySold)

        await supabase
          .from('cards')
          .update({
            qty: qtyAfter,
            // Only touch status when stock is exhausted — leaves a partially
            // sold card in its existing Listed / In Stock state.
            ...(qtyAfter === 0 ? { status: 'Sold' as const } : {}),
          })
          .eq('id', input.card_id)

        // Card belongs to a multi-variation set listing — push the reduced
        // quantity to eBay. Without this, selling off-platform (face to face,
        // Facebook) leaves eBay advertising stock that is already gone, and the
        // next eBay buyer oversells you.
        //
        // Fire-and-forget: the sale record is the source of truth and must not
        // fail because eBay is slow or unreachable. A failed push is recoverable
        // via the Set Listings sync panel.
        if (card['listing_type'] === 'variation' && card['ebay_set_listing_id']) {
          void pushQuantitiesWithRecovery(
            orgId,
            card['ebay_set_listing_id'] as string,
            [{ sku: input.card_id, quantity: qtyAfter }],
          )
        } else if (card['ebay_listing_id']) {
          // Single listing — a sale off eBay (face to face, Facebook) must still
          // reduce what eBay advertises, or the next buyer oversells you.
          void pushSingleListingQuantity(
            orgId,
            card['ebay_listing_id'] as string,
            qtyAfter,
          )
        }
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
