// =============================================================================
// POST /api/bulk-wizard/import
//
// Batch-creates cards from a completed Bulk Wizard session.
//
// Key properties vs the single-card POST /api/cards:
//   - Single DB insert for all N cards (one round-trip, not N)
//   - Still enforces the plan card_limit before inserting
//   - Invalidates the org's Redis dashboard cache
//   - Writes one consolidated audit log entry
//   - Rate limited: 5 imports/min (each import creates many cards)
//
// Body: { cards: BulkImportCard[], lot_id?, source? }
// Returns: { created: number, card_ids: string[] }
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { createAdminClient }  from '@/lib/supabase/server'
import { requireAuth, ok, forbidden, serverError, validationError } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { writeAuditLog }   from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'

const CardConditionSchema = z.enum(['NM', 'LP', 'MP', 'HP', 'Sealed'])

const ImportCardSchema = z.object({
  card_name:      z.string().min(1).max(200),
  set_code:       z.string().max(50).default(''),
  card_number:    z.string().max(50).default(''),
  condition:      CardConditionSchema.default('NM'),
  foil_type:      z.string().max(50).default('Normal'),
  language:       z.string().max(10).default('EN'),
  purchase_price: z.number().min(0).max(999999).default(0),
  ebay_avg_sold:  z.number().min(0).max(999999).nullable().default(null),
  source:         z.string().max(200).default('Bulk Wizard'),
  notes:          z.string().max(2000).default(''),
})

const BodySchema = z.object({
  cards:  z.array(ImportCardSchema).min(1).max(500),
  lot_id: z.string().uuid().nullish(),
  source: z.string().max(200).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()

    // Rate limit: 5 imports per minute per org (each may create dozens of cards)
    const limit = await rateLimit(request, `bulk-import:${orgId}`, { max: 5, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const body  = await request.json() as unknown
    const input = BodySchema.parse(body)

    const db = createAdminClient()

    // ── Plan card-limit check ────────────────────────────────────────────────
    const cardLimit = user.org?.card_limit ?? 100
    if (cardLimit > 0) {
      const { count: currentCount } = await db
        .from('cards')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('deleted_at', null)

      const current = currentCount ?? 0
      if (current + input.cards.length > cardLimit) {
        const remaining = Math.max(0, cardLimit - current)
        return forbidden(
          remaining === 0
            ? `You've reached the ${cardLimit}-card limit on your current plan. Upgrade to import more cards.`
            : `This import would exceed your ${cardLimit}-card plan limit. You can import up to ${remaining} more card${remaining !== 1 ? 's' : ''}.`
        )
      }
    }

    // ── Build insert rows ────────────────────────────────────────────────────
    const now    = new Date().toISOString()
    const source = input.source ?? 'Bulk Wizard'

    const rows = input.cards.map(card => ({
      org_id:         orgId,
      added_by:       user.id,
      card_name:      card.card_name,
      set_code:       card.set_code,
      card_number:    card.card_number,
      condition:      card.condition,
      foil_type:      card.foil_type,
      language:       card.language,
      qty:            1,
      status:         'In Stock' as const,
      purchase_price: card.purchase_price,
      purchase_date:  now.split('T')[0],
      ebay_avg_sold:  card.ebay_avg_sold,
      price_source:   card.ebay_avg_sold ? 'ebay' : null,
      source:         card.source || source,
      notes:          card.notes || '',
      lot_id:         input.lot_id ?? null,
      created_at:     now,
      updated_at:     now,
    }))

    // ── Single batch insert ──────────────────────────────────────────────────
    const { data, error } = await db
      .from('cards')
      .insert(rows)
      .select('id')

    if (error) return serverError(error)

    const card_ids = (data ?? []).map(r => r.id as string)

    // ── Side effects (fire-and-forget) ───────────────────────────────────────
    void invalidateCache(`dashboard:${orgId}`)
    void db.rpc('refresh_dashboard_cache', { p_org_id: orgId })
    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'bulk_wizard.import',
      entityType: 'cards',
      after:      {
        count:     card_ids.length,
        card_ids,
        lot_id:    input.lot_id ?? null,
        source,
      },
    })

    return ok({ created: card_ids.length, card_ids })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
