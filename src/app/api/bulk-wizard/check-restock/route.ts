// =============================================================================
// POST /api/bulk-wizard/check-restock
//
// Preview which scanned cards already exist in stock, before importing.
//
// Read-only. Lets the Import panel tell the user "3 of these will restock
// existing cards" rather than silently creating duplicate rows — restocking
// changes cost basis via weighted average, so the user should see it coming.
//
// Body:    { cards: CardIdentity[] }
// Returns: { matches: RestockPreview[], new_count, restock_count }
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { createClient }     from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import {
  buildRestockIndex, matchBatch, weightedAverageCost,
  type RestockCandidate,
} from '@/lib/restock'

const IdentitySchema = z.object({
  card_name:      z.string().min(1).max(200),
  set_code:       z.string().max(50).default(''),
  card_number:    z.string().max(50).default(''),
  condition:      z.string().max(20).default('NM'),
  foil_type:      z.string().max(50).default('Normal'),
  language:       z.string().max(10).default('EN'),
  /** Proportional cost for this scan — used to preview the new blended cost */
  purchase_price: z.number().min(0).max(999999).default(0),
})

const BodySchema = z.object({
  cards: z.array(IdentitySchema).min(1).max(500),
})

export interface RestockPreview {
  input_index:      number
  card_name:        string
  is_restock:       boolean
  existing_card_id: string | null
  qty_before:       number | null
  qty_after:        number | null
  cost_before:      number | null
  cost_after:       number | null
  in_set_listing:   boolean
}

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireAuth({ feature: 'bulk_wizard' })

    const limit = await rateLimit(request, `restock-check:${orgId}`, { max: 30, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const body  = await request.json() as unknown
    const input = BodySchema.parse(body)

    const supabase = await createClient()

    // Narrow the candidate set to the set codes actually being scanned — avoids
    // pulling the whole inventory for a 10-card scan.
    const setCodes = [...new Set(input.cards.map(c => c.set_code).filter(Boolean))]

    // Sold rows are intentionally included — isRestockEligible() admits sold-out
    // set-listing variations so they can be revived. Must match the import
    // route's query exactly or the preview would show a different outcome.
    let query = supabase
      .from('cards')
      .select('id, card_name, set_code, card_number, condition, foil_type, language, qty, purchase_price, status, is_graded, listing_type, ebay_listing_id, ebay_set_listing_id')
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (setCodes.length > 0) query = query.in('set_code', setCodes)

    const { data: existing, error } = await query
    if (error) return serverError(error)

    const index   = buildRestockIndex((existing ?? []) as unknown as RestockCandidate[])
    const matches = matchBatch(input.cards, index)

    // Accumulate per existing row so two identical scans in one batch preview
    // as a single +2, matching what import will actually do.
    const pendingQty = new Map<string, number>()

    const previews: RestockPreview[] = matches.map(({ inputIndex, existing: match }) => {
      const card = input.cards[inputIndex]!

      if (!match) {
        return {
          input_index:      inputIndex,
          card_name:        card.card_name,
          is_restock:       false,
          existing_card_id: null,
          qty_before:       null,
          qty_after:        null,
          cost_before:      null,
          cost_after:       null,
          in_set_listing:   false,
        }
      }

      const alreadyPending = pendingQty.get(match.id) ?? 0
      const qtyBefore      = match.qty + alreadyPending
      pendingQty.set(match.id, alreadyPending + 1)

      return {
        input_index:      inputIndex,
        card_name:        card.card_name,
        is_restock:       true,
        existing_card_id: match.id,
        qty_before:       qtyBefore,
        qty_after:        qtyBefore + 1,
        cost_before:      match.purchase_price,
        cost_after:       weightedAverageCost(qtyBefore, match.purchase_price, 1, card.purchase_price),
        in_set_listing:   match.listing_type === 'variation' && !!match.ebay_set_listing_id,
      }
    })

    const restockCount = previews.filter(p => p.is_restock).length

    return ok({
      matches:       previews,
      restock_count: restockCount,
      new_count:     previews.length - restockCount,
    })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
