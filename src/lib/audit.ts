// =============================================================================
// CardVault Pro — Audit logging helper
// All writes use the admin client (service role) because audit_log has no
// INSERT policy — org members can read but only the server can write.
// Never await audit writes on the critical path; fire-and-forget is fine here.
// =============================================================================
import { createAdminClient } from '@/lib/supabase/server'

export type AuditAction =
  | 'card.create'
  | 'card.update'
  | 'card.delete'
  | 'sale.create'
  | 'sale.update'
  | 'sale.delete'
  | 'sealed.create'
  | 'sealed.update'
  | 'sealed.delete'
  | 'sealed.open'
  | 'wishlist.create'
  | 'wishlist.update'
  | 'wishlist.delete'
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'objective.create'
  | 'objective.complete'
  | 'objective.delete'
  | 'bulk.status'
  | 'bulk.price'
  | 'bulk.delete'
  | 'ebay.bulk_list'
  | 'lot.create'
  | 'lot.update'
  | 'lot.delete'
  | 'buyer.create'
  | 'buyer.update'
  | 'buyer.delete'
  | 'image.upload'
  | 'settings.update'
  | 'ebay.credentials.update'

interface AuditPayload {
  orgId:      string
  userId:     string
  action:     AuditAction
  entityType: string
  entityId?:  string
  before?:    Record<string, unknown>
  after?:     Record<string, unknown>
}

/**
 * Write an audit log entry. Fire-and-forget — never throws.
 * Use void writeAuditLog(...) or await it if you need confirmation.
 */
export async function writeAuditLog(payload: AuditPayload): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('audit_log').insert({
      org_id:      payload.orgId,
      user_id:     payload.userId,
      action:      payload.action,
      entity_type: payload.entityType,
      entity_id:   payload.entityId ?? null,
      changes:     payload.before || payload.after
        ? { before: payload.before ?? null, after: payload.after ?? null }
        : null,
    })
  } catch (err) {
    // Audit failures must never break the main request
    console.error('[CardVault Audit] Failed to write audit log:', err)
  }
}
