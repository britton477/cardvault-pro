// =============================================================================
// POST /api/cards/bulk
//
// Single endpoint for all bulk card operations:
//   { action: 'status', ids, status }
//   { action: 'price',  ids, mode: 'fixed'|'markup', value }
//   { action: 'delete', ids }
//
// All operations:
//   - Require auth
//   - Filter by org_id (users can only act on their own cards)
//   - Return { affected: number }
//   - Write a single audit log entry
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }                                              from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError }                   from '@/lib/api'
import { assertRole }                                                      from '@/lib/permissions.server'
import { writeAuditLog }                                                  from '@/lib/audit'
import { BulkCardActionSchema }                                           from '@/types/validation'
import { derivePrice, type PricingStrategy }                              from '@/lib/pricing'

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()
    const body  = await request.json() as unknown
    const input = BulkCardActionSchema.parse(body)

    // Bulk delete is owner-only — assertRole throws 403 for members
    if (input.action === 'delete') {
      assertRole(user, 'owner')
    }
    const db    = createAdminClient()
    const now   = new Date().toISOString()
    let affected = 0

    // ── Status change ────────────────────────────────────────────────────────
    if (input.action === 'status') {
      const { data, error } = await db
        .from('cards')
        .update({ status: input.status, updated_at: now })
        .in('id', input.ids)
        .eq('org_id', orgId)
        .select('id')

      if (error) throw error
      affected = (data ?? []).length

      void writeAuditLog({
        orgId, userId: user.id,
        action:     'bulk.status',
        entityType: 'cards',
        after:      { ids: input.ids, count: affected, status: input.status },
      })
    }

    // ── Price update ─────────────────────────────────────────────────────────
    else if (input.action === 'price') {

      if (input.mode === 'fixed') {
        // Single query — set listed_price = value for all selected cards
        const { data, error } = await db
          .from('cards')
          .update({ listed_price: input.value, updated_at: now })
          .in('id', input.ids)
          .eq('org_id', orgId)
          .select('id')

        if (error) throw error
        affected = (data ?? []).length

      } else {
        // Derived pricing — needs each card's cost and market value.
        //
        // The arithmetic lives in lib/pricing.ts, shared with the Bulk Wizard,
        // so pricing a card here and pricing it during import produce the same
        // number. This route previously had its own inline formula, which is
        // how "markup" came to mean different things on different screens.
        const { data: cards, error: fetchError } = await db
          .from('cards')
          .select('id, purchase_price, ebay_avg_sold')
          .in('id', input.ids)
          .eq('org_id', orgId)
          .is('deleted_at', null)

        if (fetchError) throw fetchError

        // Org markup is the fallback when a card has no eBay comparables
        const { data: settings } = await db
          .from('org_settings')
          .select('markup_pct')
          .eq('org_id', orgId)
          .single()

        const orgMarkup = (settings?.['markup_pct'] as number | null) ?? 40

        const strategy: PricingStrategy = input.mode === 'market'
          ? { mode: 'market', adjustmentPct: input.value }
          : { mode: 'cost',   markupPct:     input.value }

        const updates = (cards ?? [])
          .map(c => {
            const { price } = derivePrice(
              {
                purchase_price: c['purchase_price'] as number | null,
                ebay_avg_sold:  c['ebay_avg_sold']  as number | null,
              },
              strategy,
              orgMarkup,
            )
            return price == null ? null : { id: c.id, listed_price: price, updated_at: now }
          })
          // Cards with neither a cost nor market data can't be priced. Skip them
          // rather than writing a zero, which would look like a deliberate £0.
          .filter((u): u is { id: string; listed_price: number; updated_at: string } => u !== null)

        if (updates.length > 0) {
          const { error: upsertError } = await db
            .from('cards')
            .upsert(updates, { onConflict: 'id' })

          if (upsertError) throw upsertError
        }

        affected = updates.length
      }

      void writeAuditLog({
        orgId, userId: user.id,
        action:     'bulk.price',
        entityType: 'cards',
        after:      { ids: input.ids, count: affected, mode: input.mode, value: input.value },
      })
    }

    // ── Assign to lot ────────────────────────────────────────────────────────
    else if (input.action === 'assign_lot') {
      const { data, error } = await db
        .from('cards')
        .update({ lot_id: input.lot_id, updated_at: now })
        .in('id', input.ids)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .select('id')

      if (error) throw error
      affected = (data ?? []).length

      void writeAuditLog({
        orgId, userId: user.id,
        action:     'bulk.assign_lot',
        entityType: 'cards',
        after:      { ids: input.ids, count: affected, lot_id: input.lot_id },
      })
    }

    // ── Delete (soft) ────────────────────────────────────────────────────────
    else if (input.action === 'delete') {
      const { data, error } = await db
        .from('cards')
        .update({ deleted_at: now, updated_at: now })
        .in('id', input.ids)
        .eq('org_id', orgId)
        .is('deleted_at', null)   // idempotent — don't re-delete
        .select('id')

      if (error) throw error
      affected = (data ?? []).length

      void writeAuditLog({
        orgId, userId: user.id,
        action:     'bulk.delete',
        entityType: 'cards',
        before:     { ids: input.ids, count: affected },
      })
    }

    return ok({ affected })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
