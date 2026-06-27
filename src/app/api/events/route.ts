// =============================================================================
// GET  /api/events?month=YYYY-MM   — list events for a calendar month
// POST /api/events                 — create a new event
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                         from '@/lib/supabase/server'
import { requireAuth, ok, created, badRequest, serverError, validationError } from '@/lib/api'
import { writeAuditLog }                                             from '@/lib/audit'
import { rateLimit, tooManyRequests }                                from '@/lib/rate-limit'
import { CreateEventSchema, ListEventsSchema }                       from '@/types/validation'

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const db = createAdminClient()

    const params = Object.fromEntries(request.nextUrl.searchParams)
    const query  = ListEventsSchema.parse(params)

    let dbQuery = db
      .from('calendar_events')
      .select('*')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })

    // Filter to a specific month — include any event that OVERLAPS the month:
    //   event_date <= monthEnd
    //   AND (end_date >= monthStart  OR  (end_date IS NULL AND event_date >= monthStart))
    //
    // This correctly handles single-day events, multi-day events starting before
    // the month, and multi-day events ending after the month.
    if (query.month) {
      const [year, mon] = query.month.split('-').map(Number)
      const monthStart  = `${query.month}-01`
      const lastDay     = new Date(year!, mon!, 0).getDate()
      const monthEnd    = `${query.month}-${String(lastDay).padStart(2, '0')}`

      dbQuery = dbQuery
        .lte('event_date', monthEnd)
        .or(`end_date.gte.${monthStart},and(end_date.is.null,event_date.gte.${monthStart})`)
    }

    if (query.type) {
      dbQuery = dbQuery.eq('event_type', query.type)
    }

    const { data, error } = await dbQuery

    if (error) throw error

    return ok({ data: data ?? [], count: (data ?? []).length })
  } catch (err) {
    if (err instanceof ZodError)   return validationError(err)
    if (err instanceof Response)   return err
    return serverError(err)
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const limit = await rateLimit(request, 'events-create', { max: 30, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const { orgId, user } = await requireAuth()
    const body  = await request.json() as unknown
    const input = CreateEventSchema.parse(body)

    // all_day events shouldn't have times
    const start_time = input.all_day ? null : (input.start_time ?? null)
    const end_time   = input.all_day ? null : (input.end_time   ?? null)

    const db = createAdminClient()
    const { data, error } = await db
      .from('calendar_events')
      .insert({
        org_id:      orgId,
        title:       input.title,
        description: input.description ?? '',
        event_type:  input.event_type,
        event_date:  input.event_date,
        end_date:    input.end_date ?? null,
        all_day:     input.all_day ?? true,
        start_time,
        end_time,
        location:    input.location ?? '',
        color:       input.color ?? 'blue',
        created_by:  user.id,
      })
      .select()
      .single()

    if (error) throw error

    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'event.create',
      entityType: 'calendar_events',
      entityId:   data.id as string,
      after:      data as Record<string, unknown>,
    })

    return created(data)
  } catch (err) {
    if (err instanceof ZodError)   return validationError(err)
    if (err instanceof Response)   return err
    return serverError(err)
  }
}
