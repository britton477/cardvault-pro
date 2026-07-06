// =============================================================================
// GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns a P&L summary for the given date range:
//   - Overall totals (revenue, cost, fees, shipping, profit, units)
//   - Platform breakdown
//   - Top 10 cards by profit
//   - Inventory snapshot (point-in-time, not date-filtered)
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                   from '@/lib/supabase/server'
import { requireAuth, ok, badRequest, serverError, validationError } from '@/lib/api'
import { ReportQuerySchema }                                   from '@/types/validation'
import type { ReportSummary, PlatformStat, TopCard, InventorySnapshot } from '@/types'

// ── Helper ────────────────────────────────────────────────────────────────────

function pct(profit: number, revenue: number): number {
  return revenue === 0 ? 0 : Math.round((profit / revenue) * 10000) / 100
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth({ feature: 'reports' })
    const params    = Object.fromEntries(request.nextUrl.searchParams)
    const query     = ReportQuerySchema.parse(params)
    const { from, to } = query

    const db = createAdminClient()

    // ── 1. Sales in range ────────────────────────────────────────────────────
    const { data: sales, error: salesError } = await db
      .from('sales')
      .select('platform, sold_price, purchase_price, fees, shipping, profit, qty_sold, card_name, set_code, condition')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .gte('sale_date', from)
      .lte('sale_date', to)

    if (salesError) throw salesError

    // ── 2. Aggregate overall totals ──────────────────────────────────────────
    let total_revenue  = 0
    let total_cost     = 0
    let total_fees     = 0
    let total_shipping = 0
    let total_profit   = 0
    let units_sold     = 0

    // Platform map: platform → running totals
    const platformMap = new Map<string, { revenue: number; cost: number; profit: number; fees: number; count: number }>()

    // Card map: key → running totals
    const cardMap = new Map<string, { card_name: string; set_code: string; condition: string; units_sold: number; revenue: number; cost: number; profit: number }>()

    for (const s of sales ?? []) {
      const revenue  = s.sold_price      ?? 0
      const cost     = s.purchase_price  ?? 0
      const fees     = s.fees            ?? 0
      const shipping = s.shipping        ?? 0
      const profit   = s.profit          ?? (revenue - cost - fees - shipping)
      const qty      = s.qty_sold        ?? 1

      total_revenue  += revenue
      total_cost     += cost
      total_fees     += fees
      total_shipping += shipping
      total_profit   += profit
      units_sold     += qty

      // Platform
      const pf = s.platform ?? 'Other'
      const existing = platformMap.get(pf) ?? { revenue: 0, cost: 0, profit: 0, fees: 0, count: 0 }
      platformMap.set(pf, {
        revenue: existing.revenue + revenue,
        cost:    existing.cost    + cost,
        profit:  existing.profit  + profit,
        fees:    existing.fees    + fees,
        count:   existing.count   + qty,
      })

      // Card
      const key = `${s.card_name}|${s.set_code}|${s.condition}`
      const ec  = cardMap.get(key) ?? { card_name: s.card_name, set_code: s.set_code ?? '', condition: s.condition ?? '', units_sold: 0, revenue: 0, cost: 0, profit: 0 }
      cardMap.set(key, {
        ...ec,
        units_sold: ec.units_sold + qty,
        revenue:    ec.revenue    + revenue,
        cost:       ec.cost       + cost,
        profit:     ec.profit     + profit,
      })
    }

    // ── 3. By-platform array (sorted by revenue desc) ────────────────────────
    const by_platform: PlatformStat[] = Array.from(platformMap.entries())
      .map(([platform, t]) => ({
        platform,
        revenue:    Math.round(t.revenue    * 100) / 100,
        cost:       Math.round(t.cost       * 100) / 100,
        profit:     Math.round(t.profit     * 100) / 100,
        fees:       Math.round(t.fees       * 100) / 100,
        count:      t.count,
        margin_pct: pct(t.profit, t.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue)

    // ── 4. Top 10 cards by profit ────────────────────────────────────────────
    const top_cards: TopCard[] = Array.from(cardMap.values())
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10)
      .map(c => ({
        card_name:  c.card_name,
        set_code:   c.set_code,
        condition:  c.condition,
        units_sold: c.units_sold,
        revenue:    Math.round(c.revenue * 100) / 100,
        cost:       Math.round(c.cost    * 100) / 100,
        profit:     Math.round(c.profit  * 100) / 100,
      }))

    // ── 5. Inventory snapshot (point-in-time) ────────────────────────────────
    const { data: cards, error: cardsError } = await db
      .from('cards')
      .select('status, purchase_price, listed_price, qty')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .neq('status', 'Sold')

    if (cardsError) throw cardsError

    let inv_total_cost    = 0
    let inv_listed_value  = 0
    let in_stock          = 0
    let listed            = 0

    for (const c of cards ?? []) {
      const qty = c.qty ?? 1
      inv_total_cost += (c.purchase_price ?? 0) * qty
      if (c.status === 'Listed') {
        listed++
        inv_listed_value += (c.listed_price ?? 0) * qty
      } else {
        in_stock++
      }
    }

    const inventory: InventorySnapshot = {
      total_cards:      (cards ?? []).length,
      in_stock,
      listed,
      sold_period:      units_sold,
      total_cost:       Math.round(inv_total_cost   * 100) / 100,
      listed_value:     Math.round(inv_listed_value * 100) / 100,
      potential_profit: Math.round((inv_listed_value - inv_total_cost) * 100) / 100,
    }

    // ── 6. Build response ────────────────────────────────────────────────────
    const n = (sales ?? []).length

    const summary: ReportSummary = {
      from,
      to,
      total_revenue:  Math.round(total_revenue  * 100) / 100,
      total_cost:     Math.round(total_cost     * 100) / 100,
      total_fees:     Math.round(total_fees     * 100) / 100,
      total_shipping: Math.round(total_shipping * 100) / 100,
      total_profit:   Math.round(total_profit   * 100) / 100,
      margin_pct:     pct(total_profit, total_revenue),
      units_sold,
      avg_sale_price: n === 0 ? 0 : Math.round((total_revenue  / n) * 100) / 100,
      avg_profit:     n === 0 ? 0 : Math.round((total_profit   / n) * 100) / 100,
      by_platform,
      top_cards,
      inventory,
    }

    return ok(summary)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
