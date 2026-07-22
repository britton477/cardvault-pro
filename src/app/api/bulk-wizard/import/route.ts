// =============================================================================
// POST /api/bulk-wizard/import
//
// Batch-creates cards from a completed Bulk Wizard session, merging restocks
// into existing inventory rather than creating duplicate rows.
//
// Key properties vs the single-card POST /api/cards:
//   - Single DB insert for all NEW cards (one round-trip, not N)
//   - Restocks increment qty on the existing row with a weighted-average cost
//   - Restocked cards inside a set listing get their new qty pushed to eBay,
//     batched into ONE API call per set listing
//   - Enforces the plan card_limit against NEW rows only
//   - Invalidates the org's Redis dashboard cache
//   - Writes one consolidated audit log entry
//   - Rate limited: 5 imports/min (each import creates many cards)
//
// Body: { cards: BulkImportCard[], lot_id?, source?, merge_restocks? }
// Returns: { created, restocked, card_ids, new_card_ids, restocked_details, ebay_pushed }
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { createAdminClient }  from '@/lib/supabase/server'
import { requireAuth, ok, forbidden, serverError, validationError } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { writeAuditLog }   from '@/lib/audit'
import { invalidateCache } from '@/lib/cache'
import { pushQuantitiesWithRecovery } from '@/lib/ebay-sync'
import {
  buildRestockIndex, matchBatch, weightedAverageCost, needsStatusRevival, identityKey,
  type RestockCandidate,
} from '@/lib/restock'

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
  /** Target eBay list price — set when user chooses "Import + List on eBay" */
  listed_price:   z.number().min(0).max(999999).nullable().default(null),
  source:         z.string().max(200).default('Bulk Wizard'),
  notes:          z.string().max(2000).default(''),
})

const BodySchema = z.object({
  cards:  z.array(ImportCardSchema).min(1).max(500),
  lot_id: z.string().uuid().nullish(),
  source: z.string().max(200).optional(),
  /**
   * Merge scans that match existing stock into that stock (qty += 1) instead of
   * creating duplicate rows. Defaults on — duplicate rows fragment inventory and
   * leave set listings advertising stale quantities. The user can disable it in
   * the Import panel when they genuinely want separate line items.
   */
  merge_restocks: z.boolean().default(true),
})

interface RestockedDetail {
  card_id:    string
  card_name:  string
  qty_before: number
  qty_after:  number
  cost_before: number
  cost_after:  number
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'bulk_wizard' })

    // Rate limit: 5 imports per minute per org (each may create dozens of cards)
    const limit = await rateLimit(request, `bulk-import:${orgId}`, { max: 5, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const body  = await request.json() as unknown
    const input = BodySchema.parse(body)

    const db = createAdminClient()

    // ── Match incoming scans against existing stock ──────────────────────────
    // Uses the same helper as the preview endpoint so what the user was shown
    // in the Import panel is exactly what happens here.
    let matches = input.cards.map((_, i) => ({ inputIndex: i, existing: null as RestockCandidate | null }))

    if (input.merge_restocks) {
      const setCodes = [...new Set(input.cards.map(c => c.set_code).filter(Boolean))]

      // NOTE: Sold rows are deliberately NOT filtered out here. isRestockEligible()
      // decides — it admits sold-out set-listing variations so they can be revived
      // rather than duplicated. Filtering them in SQL would hide them from that check.
      let existingQuery = db
        .from('cards')
        .select('id, card_name, set_code, card_number, condition, foil_type, language, qty, purchase_price, status, is_graded, listing_type, ebay_set_listing_id')
        .eq('org_id', orgId)
        .is('deleted_at', null)

      if (setCodes.length > 0) existingQuery = existingQuery.in('set_code', setCodes)

      const { data: existingCards } = await existingQuery
      const index = buildRestockIndex((existingCards ?? []) as unknown as RestockCandidate[])
      matches = matchBatch(input.cards, index)
    }

    // Split into restocks and genuinely new cards
    const newIndices     = matches.filter(m => !m.existing).map(m => m.inputIndex)
    const restockMatches = matches.filter(m => m.existing) as Array<{ inputIndex: number; existing: RestockCandidate }>

    // ── Plan card-limit check — NEW ROWS only ────────────────────────────────
    //
    // Counts DISTINCT new cards, not scans. Restocks add units to rows that
    // already count against the limit, and identical scans collapse into one
    // row — charging per scan would block legitimate imports. Scanning eight
    // copies of one card consumes one slot, not eight.
    const distinctNewCount = new Set(
      newIndices.map(i => identityKey(input.cards[i]!)),
    ).size

    const cardLimit = user.org?.card_limit ?? 100
    if (cardLimit > 0 && distinctNewCount > 0) {
      const { count: currentCount } = await db
        .from('cards')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('deleted_at', null)

      const current = currentCount ?? 0
      if (current + distinctNewCount > cardLimit) {
        const remaining = Math.max(0, cardLimit - current)
        return forbidden(
          remaining === 0
            ? `You've reached the ${cardLimit}-card limit on your current plan. Upgrade to import more cards.`
            : `This import would exceed your ${cardLimit}-card plan limit. You can import up to ${remaining} more new card${remaining !== 1 ? 's' : ''}.`
        )
      }
    }

    const now    = new Date().toISOString()
    const source = input.source ?? 'Bulk Wizard'

    // ── Apply restocks ───────────────────────────────────────────────────────
    // Group by target row first: two identical scans in one batch must become a
    // single +2 update, not two racing +1 updates that lose one another.
    const restockAgg = new Map<string, { row: RestockCandidate; addQty: number; costSum: number }>()

    for (const { inputIndex, existing } of restockMatches) {
      const card = input.cards[inputIndex]!
      const agg  = restockAgg.get(existing.id)
      if (agg) {
        agg.addQty  += 1
        agg.costSum += card.purchase_price
      } else {
        restockAgg.set(existing.id, { row: existing, addQty: 1, costSum: card.purchase_price })
      }
    }

    const restockedDetails: RestockedDetail[] = []

    for (const { row, addQty, costSum } of restockAgg.values()) {
      const addedAvgPrice = addQty > 0 ? costSum / addQty : 0
      const qtyAfter      = row.qty + addQty
      const costAfter     = weightedAverageCost(row.qty, row.purchase_price, addQty, addedAvgPrice)

      await db
        .from('cards')
        .update({
          qty:            qtyAfter,
          purchase_price: costAfter,
          // A sold-out set-listing variation coming back into stock must return
          // to 'Listed' — it is a live eBay variation again, not a sold record.
          ...(needsStatusRevival(row) ? { status: 'Listed' as const } : {}),
          last_edited_by: user.id,
          updated_at:     now,
        })
        .eq('id', row.id)
        .eq('org_id', orgId)

      restockedDetails.push({
        card_id:     row.id,
        card_name:   row.card_name,
        qty_before:  row.qty,
        qty_after:   qtyAfter,
        cost_before: row.purchase_price,
        cost_after:  costAfter,
      })
    }

    // ── Collapse identical scans within this batch ───────────────────────────
    //
    // Restock matching compares each scan against EXISTING stock. It says
    // nothing about two scans in the same batch matching each other, so five
    // copies of a card you've never held before used to insert five rows at
    // qty 1 rather than one row at qty 5.
    //
    // That fragmented inventory and, because eBay requires variation values to
    // be unique, made those cards impossible to put in a set listing at all.
    const newGroups = new Map<string, { indices: number[]; card: typeof input.cards[number] }>()
    for (const i of newIndices) {
      const card = input.cards[i]!
      const key  = identityKey(card)
      const g    = newGroups.get(key)
      if (g) g.indices.push(i)
      else   newGroups.set(key, { indices: [i], card })
    }

    // ── Build insert rows — one per distinct card, qty = copies scanned ───────
    const groupList = [...newGroups.values()]

    const rows = groupList.map(({ indices, card }) => ({
      org_id:         orgId,
      added_by:       user.id,
      card_name:      card.card_name,
      set_code:       card.set_code,
      card_number:    card.card_number,
      condition:      card.condition,
      foil_type:      card.foil_type,
      language:       card.language,
      qty:            indices.length,
      status:         'In Stock' as const,
      // Proportional costs can differ slightly between copies, so average them
      // across the group rather than taking the first arbitrarily.
      purchase_price: Math.round(
        (indices.reduce((s, i) => s + (input.cards[i]!.purchase_price ?? 0), 0) / indices.length) * 100,
      ) / 100,
      purchase_date:  now.split('T')[0],
      ebay_avg_sold:  card.ebay_avg_sold,
      price_source:   card.ebay_avg_sold ? 'ebay' : null,
      // listed_price is stored so the eBay bulk-list route can use it immediately
      listed_price:   card.listed_price ?? null,
      source:         card.source || source,
      notes:          card.notes || '',
      lot_id:         input.lot_id ?? null,
      created_at:     now,
      updated_at:     now,
    }))

    // ── Single batch insert for new cards ────────────────────────────────────
    let newCardIds: string[] = []

    if (rows.length > 0) {
      const { data, error } = await db
        .from('cards')
        .insert(rows)
        .select('id')

      if (error) return serverError(error)
      newCardIds = (data ?? []).map(r => r.id as string)
    }

    // ── card_ids in ORIGINAL INPUT ORDER ─────────────────────────────────────
    //
    // The client maps scanned photos to card IDs positionally, so this array
    // must stay the same length and order as the input.
    //
    // Several input indices can now share one card id, because identical scans
    // collapse into a single row. A positional cursor would drift as soon as
    // that happened — the group's index list is the authority instead.
    const card_ids: string[] = new Array<string>(input.cards.length).fill('')

    groupList.forEach((group, groupIdx) => {
      const newId = newCardIds[groupIdx] ?? ''
      for (const inputIndex of group.indices) card_ids[inputIndex] = newId
    })

    for (const { inputIndex, existing } of matches) {
      if (existing) card_ids[inputIndex] = existing.id
    }

    // ── Push restocked quantities to eBay, batched per set listing ───────────
    // Restocked cards inside a "Complete Your Set" listing must have their new
    // quantity reflected on eBay or the listing under-advertises stock you hold.
    //
    // Grouped by set listing so ten restocks in one set cost ONE eBay API call
    // rather than ten. Fire-and-forget: inventory is already correct in the DB
    // and a failed push is recoverable from the Set Listings sync panel.
    let ebayPushGroups = 0

    const bySetListing = new Map<string, Array<{ sku: string; quantity: number }>>()
    for (const detail of restockedDetails) {
      const row = restockAgg.get(detail.card_id)?.row
      if (!row?.ebay_set_listing_id || row.listing_type !== 'variation') continue

      const group = bySetListing.get(row.ebay_set_listing_id) ?? []
      group.push({ sku: detail.card_id, quantity: detail.qty_after })
      bySetListing.set(row.ebay_set_listing_id, group)
    }

    ebayPushGroups = bySetListing.size

    if (bySetListing.size > 0) {
      void (async () => {
        for (const [setListingId, updates] of bySetListing) {
          // Failures flag the listing sync_pending rather than disappearing
          await pushQuantitiesWithRecovery(orgId, setListingId, updates)
        }
      })()
    }

    // ── Side effects (fire-and-forget) ───────────────────────────────────────
    void invalidateCache(`dashboard:${orgId}`)
    void db.rpc('refresh_dashboard_cache', { p_org_id: orgId })
    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'bulk_wizard.import',
      entityType: 'cards',
      after:      {
        created:    newCardIds.length,
        restocked:  restockedDetails.length,
        card_ids,
        restocked_details: restockedDetails,
        lot_id:     input.lot_id ?? null,
        source,
      } as unknown as Record<string, unknown>,
    })

    return ok({
      created:           newCardIds.length,
      restocked:         restockedDetails.length,
      card_ids,
      new_card_ids:      newCardIds,
      restocked_details: restockedDetails,
      ebay_pushed:       ebayPushGroups,
    })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
