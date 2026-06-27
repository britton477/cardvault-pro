// =============================================================================
// GET  /api/objectives?scope=org|personal  — list objectives
// POST /api/objectives                     — create an objective
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                              from '@/lib/supabase/server'
import { requireAuth, ok, created, serverError, validationError }        from '@/lib/api'
import { writeAuditLog }                                                  from '@/lib/audit'
import { rateLimit, tooManyRequests }                                     from '@/lib/rate-limit'
import { CreateObjectiveSchema, ListObjectivesSchema }                    from '@/types/validation'

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()
    const db     = createAdminClient()
    const params = Object.fromEntries(request.nextUrl.searchParams)
    const query  = ListObjectivesSchema.parse(params)

    let dbQuery = db
      .from('objectives')
      .select('*')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('is_complete', { ascending: true })   // incomplete first
      .order('position',    { ascending: true })
      .order('created_at',  { ascending: true })

    if (query.scope === 'personal') {
      // Personal: only this user's personal objectives
      dbQuery = dbQuery.eq('is_personal', true).eq('created_by', user.id)
    } else {
      // Org: all non-personal objectives visible to the whole team
      dbQuery = dbQuery.eq('is_personal', false)
    }

    const { data, error } = await dbQuery
    if (error) throw error

    return ok({ data: data ?? [], count: (data ?? []).length })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const limit = await rateLimit(request, 'objectives-create', { max: 60, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const { orgId, user } = await requireAuth()
    const body  = await request.json() as unknown
    const input = CreateObjectiveSchema.parse(body)

    const db = createAdminClient()
    const { data, error } = await db
      .from('objectives')
      .insert({
        org_id:      orgId,
        created_by:  user.id,
        title:       input.title,
        is_personal: input.is_personal,
      })
      .select()
      .single()

    if (error) throw error

    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'objective.create',
      entityType: 'objectives',
      entityId:   data.id as string,
      after:      data as Record<string, unknown>,
    })

    return created(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
