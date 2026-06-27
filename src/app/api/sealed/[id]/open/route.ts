// =============================================================================
// POST /api/sealed/:id/open  — record opening N units of a sealed product
// Body: { qty: number }
// Increments qty_opened; qty_remaining is a generated column in DB.
// Validates that qty does not exceed units remaining.
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, ok, notFound, badRequest, serverError, validationError, conflict } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { OpenProductSchema } from '@/types/validation'
import { writeAuditLog } from '@/lib/audit'

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, user } = await requireAuth()

    // Rate limit: 20 open-product actions per minute per IP
    const limit = await rateLimit(request, 'sealed-open', { max: 20, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const { id }  = await params
    const body    = await request.json() as unknown
    const input   = OpenProductSchema.parse(body)

    const supabase = await createClient()

    // Fetch current state — used for the friendly error message and audit log
    const { data: product } = await supabase
      .from('sealed_products')
      .select('id, org_id, qty_bought, qty_opened, qty_remaining')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()

    if (!product) return notFound('Sealed product not found')

    const remaining    = product.qty_remaining as number
    const qtyOpened    = product.qty_opened as number

    if (input.qty > remaining) {
      return badRequest(
        `Cannot open ${input.qty} unit${input.qty !== 1 ? 's' : ''} — only ${remaining} remaining`,
      )
    }

    const newQtyOpened = qtyOpened + input.qty

    // Atomic write: the .gte guard is evaluated at UPDATE time in the DB, not at
    // SELECT time. If a concurrent request already decremented qty_remaining below
    // input.qty between our SELECT and this UPDATE, the WHERE clause fails and
    // zero rows are affected — which we detect below. This prevents double-opening
    // under concurrent requests without requiring a stored procedure.
    // .maybeSingle() returns null (not an error) when 0 rows match.
    // If the gte guard rejects the write between our SELECT and this UPDATE,
    // data will be null and we return a meaningful conflict response.
    const { data, error } = await supabase
      .from('sealed_products')
      .update({ qty_opened: newQtyOpened })
      .eq('id', id)
      .eq('org_id', orgId)
      .gte('qty_remaining', input.qty)   // ← atomic guard
      .select()
      .maybeSingle()

    if (error) return serverError(error)

    if (!data) {
      return conflict('Insufficient units remaining — another request may have opened units simultaneously. Please refresh and try again.')
    }

    void writeAuditLog({
      orgId, userId: user.id,
      action:     'sealed.open',
      entityType: 'sealed_product',
      entityId:   id,
      before:     { qty_opened: product.qty_opened, qty_remaining: remaining },
      after:      { qty_opened: newQtyOpened, qty: input.qty },
    })

    return ok(data)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
