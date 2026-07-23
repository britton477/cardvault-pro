// =============================================================================
// CardVault Pro — eBay order → sale synchronisation
//
// Pulls completed eBay orders and turns them into sale records, drawing stock
// down as it goes. Shared by the manual "Sync eBay orders" button and the
// hourly cron.
//
// Idempotency is the whole ballgame here: this runs repeatedly over overlapping
// date ranges, so importing the same order twice would silently double a user's
// reported revenue. Every sale carries (ebay_order_id, ebay_transaction_id) and
// a partial unique index enforces it at the database level — the code checks
// first for a clean skip, and the constraint catches anything that races.
// =============================================================================
import { createAdminClient } from '@/lib/supabase/server'
import { getOrders, type EbayOrderTransaction } from '@/lib/ebay'
import { pushQuantitiesWithRecovery } from '@/lib/ebay-sync'

export interface SyncOrdersResult {
  scanned:    number   // transactions returned by eBay
  imported:   number   // new sales created
  skipped:    number   // already imported
  linked:     number   // matched an existing manual sale and claimed it
  unmatched:  number   // imported but flagged needs_review
  cancelled:  number   // skipped because the order was cancelled
  errors:     string[]
}

/**
 * How many days either side of the eBay sale date to search for a manually
 * recorded sale of the same card.
 *
 * Sellers commonly log a sale when they post the parcel rather than when the
 * order landed, so a same-day-only match would miss most of them. Three days
 * covers normal handling time without being loose enough to swallow a genuine
 * second sale of the same card.
 */
const DUPLICATE_WINDOW_DAYS = 3

/** eBay order states that should never become a sale. */
const NON_SALE_STATUSES = new Set(['Cancelled', 'Inactive', 'Invalid'])

/**
 * Find or create the buyer behind an eBay order, returning their id.
 *
 * Keyed on the eBay username rather than the display name: names repeat, get
 * changed, and arrive formatted inconsistently from shipping addresses, so
 * matching on them would silently merge distinct people or split one person
 * across several rows. The username is stable and unique per account.
 *
 * Runs regardless of plan. The Buyers UI is a Growth feature, but capturing the
 * data costs nothing and means the history is already there on upgrade rather
 * than starting empty.
 *
 * Returns null when eBay gave us nothing usable, or on any failure — buyer
 * attribution is a bonus, and must never block a sale from importing.
 */
async function resolveBuyer(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
  tx: EbayOrderTransaction,
): Promise<{ id: string; name: string } | null> {
  const username = tx.buyerUserId?.trim()
  const name     = (tx.buyerName?.trim() || username) ?? ''

  if (!username && !name) return null

  try {
    if (username) {
      const { data: existing } = await db
        .from('buyers')
        .select('id, name')
        .eq('org_id', orgId)
        .eq('ebay_username', username)
        .is('deleted_at', null)
        .maybeSingle()

      if (existing) {
        // Backfill a real name onto a buyer we previously only knew by username
        if (name && name !== username && existing['name'] === username) {
          await db.from('buyers').update({ name, updated_at: new Date().toISOString() })
            .eq('id', existing['id'])
        }
        return { id: existing['id'] as string, name: name || (existing['name'] as string) }
      }
    }

    const { data: created, error } = await db
      .from('buyers')
      .insert({
        org_id:        orgId,
        name:          name || username,
        ebay_username: username || null,
        email:         '',
        phone:         '',
        notes:         'Added automatically from an eBay order.',
      })
      .select('id, name')
      .single()

    // 23505 = another concurrent sync created them first; re-read rather than fail
    if (error?.code === '23505' && username) {
      const { data: raced } = await db
        .from('buyers')
        .select('id, name')
        .eq('org_id', orgId)
        .eq('ebay_username', username)
        .is('deleted_at', null)
        .maybeSingle()
      return raced ? { id: raced['id'] as string, name: raced['name'] as string } : null
    }

    if (error || !created) return null
    return { id: created['id'] as string, name: created['name'] as string }
  } catch (err) {
    console.error('[ebay-orders] buyer resolution failed:', err)
    return null
  }
}

interface CardRow {
  id:                  string
  card_name:           string
  set_code:            string
  card_number:         string
  condition:           string
  qty:                 number
  purchase_price:      number
  ebay_listing_id:     string | null
  listing_type:        string | null
  ebay_set_listing_id: string | null
}

/**
 * Resolve which card an eBay transaction refers to.
 *
 * Three strategies in descending order of confidence:
 *
 *   1. SKU — we set SKU to card.id on every listing we create, for both singles
 *      and variations. An exact hit here is unambiguous.
 *   2. Listing ID — covers single listings created before SKUs were set, and
 *      any listing made outside CardVault that was later linked.
 *   3. Nothing — the order is still imported so revenue is captured, but flagged
 *      needs_review so the cost basis gets a human decision rather than a guess.
 *
 * Deliberately does NOT fall back to fuzzy title matching. A wrong match writes
 * a wrong cost basis and silently corrupts profit reporting, which is worse than
 * an honest "needs review" flag.
 */
function resolveCard(
  tx: EbayOrderTransaction,
  byId: Map<string, CardRow>,
  byListingId: Map<string, CardRow>,
): CardRow | null {
  if (tx.sku && byId.has(tx.sku)) return byId.get(tx.sku)!
  if (tx.listingId && byListingId.has(tx.listingId)) return byListingId.get(tx.listingId)!
  return null
}

/**
 * Sync eBay orders into sales for one org.
 *
 * @param lookbackDays How far back to scan. Overlap is safe and intentional —
 *   idempotency handles re-seeing orders, and a wide window catches late
 *   payments that only became sales after the previous run.
 */
export async function syncEbayOrders(
  orgId: string,
  lookbackDays = 7,
  userId: string | null = null,
): Promise<SyncOrdersResult> {
  const db = createAdminClient()
  const result: SyncOrdersResult = {
    scanned: 0, imported: 0, skipped: 0, linked: 0, unmatched: 0, cancelled: 0, errors: [],
  }

  const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  const transactions = await getOrders(orgId, from)
  result.scanned = transactions.length

  if (transactions.length === 0) return result

  // ── Already-imported set, for a cheap in-memory skip ──────────────────────
  const orderIds = [...new Set(transactions.map(t => t.orderId))]
  const { data: existingSales } = await db
    .from('sales')
    .select('ebay_order_id, ebay_transaction_id')
    .eq('org_id', orgId)
    .in('ebay_order_id', orderIds)

  const alreadyImported = new Set(
    (existingSales ?? []).map(s => `${s['ebay_order_id']}:${s['ebay_transaction_id']}`),
  )

  // ── Candidate cards, indexed both ways ────────────────────────────────────
  const { data: cards } = await db
    .from('cards')
    .select('id, card_name, set_code, card_number, condition, qty, purchase_price, ebay_listing_id, listing_type, ebay_set_listing_id')
    .eq('org_id', orgId)
    .is('deleted_at', null)

  const allCards = (cards ?? []) as unknown as CardRow[]
  const byId          = new Map(allCards.map(c => [c.id, c]))
  const byListingId   = new Map(
    allCards.filter(c => c.ebay_listing_id).map(c => [c.ebay_listing_id!, c]),
  )

  // Quantity changes to push to eBay, grouped by set listing so a multi-card
  // order costs one API call per listing rather than one per card.
  const setListingPushes = new Map<string, Array<{ sku: string; quantity: number }>>()

  for (const tx of transactions) {
    const key = `${tx.orderId}:${tx.transactionId}`

    if (alreadyImported.has(key)) { result.skipped++; continue }
    if (NON_SALE_STATUSES.has(tx.orderStatus)) { result.cancelled++; continue }

    const card = resolveCard(tx, byId, byListingId)

    try {
      // ── Claim an existing manual sale rather than duplicating it ──────────
      //
      // Idempotency only stops the same eBay order importing twice. It cannot
      // see a sale the user already typed in by hand, because those carry no
      // order ID — so without this check, anyone who has been recording eBay
      // sales manually gets a full set of duplicates on their first sync.
      //
      // When a manual sale of the same card exists near the same date, stamp
      // the eBay identifiers onto it instead of creating a second row. The
      // user's own figures win (they reflect what actually landed, including
      // postage), and the order is marked as handled so it never re-imports.
      if (card) {
        const saleDateIso = tx.saleDate
          ? tx.saleDate.slice(0, 10)
          : new Date().toISOString().slice(0, 10)
        const windowMs = DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000
        const from = new Date(new Date(saleDateIso).getTime() - windowMs).toISOString().slice(0, 10)
        const to   = new Date(new Date(saleDateIso).getTime() + windowMs).toISOString().slice(0, 10)

        const { data: candidates } = await db
          .from('sales')
          .select('id, sold_price, sale_date, buyer_name, buyer_id, tracking_number')
          .eq('org_id', orgId)
          .eq('card_id', card.id)
          .is('ebay_order_id', null)     // manual entries only
          .is('deleted_at', null)
          .gte('sale_date', from)
          .lte('sale_date', to)
          .order('sale_date', { ascending: true })
          .limit(1)

        const existing = candidates?.[0]
        if (existing) {
          // Enrich the record you typed with what eBay knows about the buyer.
          // This is the main reason to claim rather than skip: buyer details
          // are tedious to enter by hand and rarely get filled in manually.
          const buyer = await resolveBuyer(db, orgId, tx)

          await db
            .from('sales')
            .update({
              ebay_order_id:       tx.orderId,
              ebay_transaction_id: tx.transactionId,
              // Only fill blanks — anything you typed yourself wins, since you
              // may have recorded a detail eBay doesn't carry.
              ...(buyer && !existing['buyer_id']   ? { buyer_id:   buyer.id }   : {}),
              ...(buyer && !existing['buyer_name'] ? { buyer_name: buyer.name } : {}),
              ...(tx.trackingNumber && !existing['tracking_number']
                ? { tracking_number: tx.trackingNumber } : {}),
              updated_at:          new Date().toISOString(),
            })
            .eq('id', existing['id'])
            .eq('org_id', orgId)

          result.linked++
          continue
        }
      }

      // Cost basis comes from the matched card. Unmatched orders get 0 and are
      // flagged — an invented cost would quietly distort profit.
      const purchasePrice = card ? card.purchase_price : 0
      const saleDate      = tx.saleDate ? tx.saleDate.slice(0, 10) : new Date().toISOString().slice(0, 10)

      // Attribute the buyer on new imports too, so both paths build the same
      // customer history rather than only claimed sales carrying it.
      const buyer = await resolveBuyer(db, orgId, tx)

      const { error: insertErr } = await db.from('sales').insert({
        org_id:              orgId,
        card_id:             card?.id ?? null,
        card_name:           card?.card_name ?? (tx.variationName || tx.title),
        set_code:            card?.set_code    ?? '',
        card_number:         card?.card_number ?? '',
        condition:           card?.condition   ?? '',
        platform:            'eBay',
        qty_sold:            tx.quantity,
        sold_price:          tx.linePrice,
        fees:                tx.feeAmount,
        // The buyer's postage payment is revenue to us, not a cost. The seller's
        // own label cost is unknown to eBay, so shipping starts at 0 and the
        // user fills it in — guessing would misstate profit.
        shipping:            0,
        purchase_price:      purchasePrice,
        sale_date:           saleDate,
        sale_status:         tx.shippedStatus === 'Shipped' ? 'Shipped' : 'Sold',
        tracking_number:     tx.trackingNumber || null,
        buyer_name:          buyer?.name || tx.buyerName || tx.buyerUserId || '',
        buyer_id:            buyer?.id ?? null,
        sold_by:             userId,
        ebay_order_id:       tx.orderId,
        ebay_transaction_id: tx.transactionId,
        needs_review:        !card,
      })

      if (insertErr) {
        // 23505 = unique violation: a concurrent run already imported this.
        // Not an error — the outcome we wanted either way.
        if (insertErr.code === '23505') { result.skipped++; continue }
        throw insertErr
      }

      result.imported++
      if (!card) { result.unmatched++; continue }

      // ── Draw stock down ───────────────────────────────────────────────────
      const qtyAfter = Math.max(0, card.qty - tx.quantity)

      await db
        .from('cards')
        .update({
          qty: qtyAfter,
          ...(qtyAfter === 0 ? { status: 'Sold' as const } : {}),
        })
        .eq('id', card.id)
        .eq('org_id', orgId)

      // Keep the in-memory copy current so a second transaction for the same
      // card in this batch draws down from the already-reduced quantity.
      card.qty = qtyAfter

      // eBay already decremented its own count for the sold listing, but a
      // variation card may have other stock movements pending — queue a push so
      // eBay and the DB agree after the batch.
      if (card.listing_type === 'variation' && card.ebay_set_listing_id) {
        const group = setListingPushes.get(card.ebay_set_listing_id) ?? []
        // Replace any earlier entry for this SKU with the latest quantity
        const filtered = group.filter(g => g.sku !== card.id)
        filtered.push({ sku: card.id, quantity: qtyAfter })
        setListingPushes.set(card.ebay_set_listing_id, filtered)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`Order ${tx.orderId}/${tx.transactionId}: ${msg}`)
    }
  }

  // ── Push reconciled quantities, one call per set listing ──────────────────
  for (const [setListingId, updates] of setListingPushes) {
    await pushQuantitiesWithRecovery(orgId, setListingId, updates)
  }

  return result
}
