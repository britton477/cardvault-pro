// =============================================================================
// GET  /api/cards  — list cards with pagination, search, filter, sort
// POST /api/cards  — create a card
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, created, badRequest, forbidden, serverError, validationError } from '@/lib/api'
import { CreateCardSchema, ListCardsSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { invalidateCache } from '@/lib/cache'

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const params  = Object.fromEntries(request.nextUrl.searchParams)
    const query   = ListCardsSchema.parse(params)

    const supabase = await createClient()
    let q = supabase
      .from('cards')
      .select('*, photos:card_photos(*)', { count: 'exact' })
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (query.search) {
      q = q.ilike('card_name', `%${query.search}%`)
    }
    if (query.status) {
      q = q.eq('status', query.status)
    }
    if (query.set_code) {
      q = q.eq('set_code', query.set_code)
    }
    if (query.condition) {
      q = q.eq('condition', query.condition)
    }

    q = q.order(query.sort, { ascending: query.order === 'asc' })

    const offset = (query.page - 1) * query.limit
    q = q.range(offset, offset + query.limit - 1)

    const { data, count, error } = await q

    if (error) return serverError(error)

    return ok({
      data:  data ?? [],
      count: count ?? 0,
      page:  query.page,
      limit: query.limit,
    })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response)  return err
    return serverError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    // 60 card creates per hour — prevents bulk spam while allowing genuine batch imports
    const limit = await rateLimit(request, 'card-create', { max: 60, window: '1h' })
    if (!limit.success) return tooManyRequests(300)

    const { orgId, user } = await requireAuth()

    // ── Plan limit check ──────────────────────────────────────────────────────
    // Count active cards for this org and block if the plan limit is reached.
    // card_limit = 0 means unlimited (paid plans set this in the org row).
    const cardLimit = user.org?.card_limit ?? 100
    if (cardLimit > 0) {
      const admin = createAdminClient()
      const { count } = await admin
        .from('cards')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('deleted_at', null)

      if ((count ?? 0) >= cardLimit) {
        return forbidden(
          `You've reached the ${cardLimit}-card limit on your current plan. ` +
          'Upgrade to add more cards.'
        )
      }
    }

    const body   = await request.json() as unknown
    const input  = CreateCardSchema.parse(body)

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('cards')
      .insert({
        org_id:   orgId,
        added_by: user.id,
        ...input,
      })
      .select('*, photos:card_photos(*)')
      .single()

    if (error) return serverError(error)

    // Fire-and-forget side effects — never block the response
    void writeAuditLog({
      orgId: orgId, userId: user.id,
      action: 'card.create', entityType: 'card', entityId: data.id,
      after: input as Record<string, unknown>,
    })
    void invalidateCache(`dashboard:${orgId}`)
    // Refresh materialized dashboard stats cache (fire-and-forget)
    void createAdminClient().rpc('refresh_dashboard_cache', { p_org_id: orgId })

    return created(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response)  return err
    return serverError(err)
  }
}
