// =============================================================================
// GET /api/export/csv?type=sales|cards|sealed&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Streams a CSV file for download. Date range is only applied to sales.
// =============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { ZodError }                       from 'zod'
import { createAdminClient }              from '@/lib/supabase/server'
import { requireAuth, validationError, serverError } from '@/lib/api'
import { ExportQuerySchema }              from '@/types/validation'

// ── CSV builder ───────────────────────────────────────────────────────────────

function escape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Wrap in quotes if it contains comma, quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0]!)
  const lines   = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ]
  return lines.join('\r\n')
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // CSV export is a basic+ feature; owner-only (financial data)
    const { orgId } = await requireAuth({ role: 'owner', feature: 'csv_export' })
    const params    = Object.fromEntries(request.nextUrl.searchParams)
    const query     = ExportQuerySchema.parse(params)
    const db        = createAdminClient()
    const today     = new Date().toISOString().split('T')[0]!

    // ── Sales export ─────────────────────────────────────────────────────────
    if (query.type === 'sales') {
      let q = db
        .from('sales')
        .select('sale_date, card_name, set_code, card_number, condition, platform, qty_sold, sold_price, purchase_price, fees, shipping, profit, sale_status, tracking_number, created_at')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('sale_date', { ascending: false })

      if (query.from) q = q.gte('sale_date', query.from)
      if (query.to)   q = q.lte('sale_date', query.to)

      const { data, error } = await q
      if (error) throw error

      const rows = (data ?? []).map(s => ({
        'Sale Date':       s.sale_date,
        'Card Name':       s.card_name,
        'Set':             s.set_code,
        'Number':          s.card_number,
        'Condition':       s.condition,
        'Platform':        s.platform,
        'Qty':             s.qty_sold,
        'Sold Price (£)':  s.sold_price,
        'Cost (£)':        s.purchase_price,
        'Fees (£)':        s.fees,
        'Shipping (£)':    s.shipping,
        'Profit (£)':      s.profit,
        'Status':          s.sale_status,
        'Tracking':        s.tracking_number ?? '',
        'Created At':      s.created_at,
      }))

      const filename = `cardvault-sales-${query.from ?? 'all'}-to-${query.to ?? today}.csv`
      return csvResponse(toCSV(rows), filename)
    }

    // ── Cards (stock) export ──────────────────────────────────────────────────
    if (query.type === 'cards') {
      const { data, error } = await db
        .from('cards')
        .select('card_name, set_code, card_number, condition, foil_type, language, is_graded, grader, grade, qty, status, purchase_price, purchase_date, source, listed_price, listed_on, notes, created_at')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (error) throw error

      const rows = (data ?? []).map(c => ({
        'Card Name':         c.card_name,
        'Set':               c.set_code,
        'Number':            c.card_number,
        'Condition':         c.condition,
        'Foil Type':         c.foil_type,
        'Language':          c.language,
        'Graded':            c.is_graded ? 'Yes' : 'No',
        'Grader':            c.grader ?? '',
        'Grade':             c.grade  ?? '',
        'Qty':               c.qty,
        'Status':            c.status,
        'Purchase Price (£)': c.purchase_price,
        'Purchase Date':     c.purchase_date ?? '',
        'Source':            c.source,
        'Listed Price (£)':  c.listed_price  ?? '',
        'Listed On':         c.listed_on     ?? '',
        'Notes':             c.notes,
        'Added At':          c.created_at,
      }))

      return csvResponse(toCSV(rows), `cardvault-stock-${today}.csv`)
    }

    // ── Sealed export ─────────────────────────────────────────────────────────
    if (query.type === 'sealed') {
      const { data, error } = await db
        .from('sealed_products')
        .select('product_name, set_code, product_type, qty_bought, cost_per_unit, qty_opened, qty_sold, qty_remaining, source, notes, created_at')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (error) throw error

      const rows = (data ?? []).map(p => ({
        'Product Name':       p.product_name,
        'Set':                p.set_code,
        'Type':               p.product_type,
        'Qty Bought':         p.qty_bought,
        'Cost Per Unit (£)':  p.cost_per_unit,
        'Total Cost (£)':     Math.round(p.qty_bought * p.cost_per_unit * 100) / 100,
        'Qty Opened':         p.qty_opened,
        'Qty Sold':           p.qty_sold,
        'Qty Remaining':      p.qty_remaining,
        'Source':             p.source,
        'Notes':              p.notes,
        'Added At':           p.created_at,
      }))

      return csvResponse(toCSV(rows), `cardvault-sealed-${today}.csv`)
    }

    // Unreachable (Zod enum guards this)
    return new NextResponse('Invalid type', { status: 400 })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
