// =============================================================================
// GET  /api/lots  — list purchase lots for the org
// POST /api/lots  — create a new purchase lot
//
// GET includes computed card_count and allocated_cost via Supabase aggregate.
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError, z }      from 'zod'
import { createAdminClient }                            from '@/lib/supabase/server'
import { requireAuth, ok, created, serverError, validationError } from '@/lib/api'
import { CreateLotSchema }                              from '@/types/validation'
import { writeAuditLog }                                from '@/lib/audit'

const ListLotsSchema = z.object({
  search: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const params    = Object.fromEntries(request.nextUrl.searchParams)
    const { search } = ListLotsSchema.parse(params)

    const db = createAdminClient()

    // Fetch lots + a count + sum of card purchase_prices for each lot
    let q = db
      .from('purchase_lots')
      .select(`
        *,
        cards(purchase_price)
      `)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('purchased_at', { ascending: false })

    if (search) q = q.ilike('name', `%${search}%`)

    const { data, error } = await q
    if (error) throw error

    // Compute card_count and allocated_cost in JS (avoids complex SQL)
    const lots = (data ?? []).map(lot => {
      const cards          = (lot.cards ?? []) as Array<{ purchase_price: number }>
      const card_count     = cards.length
      const allocated_cost = cards.reduce((sum, c) => sum + (c.purchase_price ?? 0), 0)
      const { cards: _cards, ...rest } = lot
      return { ...rest, card_count, allocated_cost }
    })

    return ok({ data: lots, count: lots.length })
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
    const input = CreateLotSchema.parse(body)

    const db = createAdminClient()
    const { data, error } = await db
      .from('purchase_lots')
      .insert({ org_id: orgId, created_by: user.id, ...input })
      .select()
      .single()

    if (error) throw error

    void writeAuditLog({
      orgId, userId: user.id,
      action: 'lot.create', entityType: 'purchase_lot', entityId: data.id,
      after: input as Record<string, unknown>,
    })

    return created({ ...data, card_count: 0, allocated_cost: 0 })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
