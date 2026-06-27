// =============================================================================
// GET /api/notifications
//
// Computed notification feed — no persistent table.
// Aggregates three live data sources into a single ranked list:
//   1. Wishlist price drops  (last_ebay_price ≤ target_price)
//   2. Calendar events today / tomorrow
//   3. Stale eBay listings   (Listed cards, updated_at > 30 days ago)
//
// Responses are lightweight and safe to poll every 5 minutes.
// =============================================================================
import { requireAuth, ok, serverError } from '@/lib/api'
import { createAdminClient }            from '@/lib/supabase/server'
import type { AppNotification }         from '@/types'

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const db        = createAdminClient()

    const today    = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    const todayStr    = today.toISOString().slice(0, 10)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)
    const staleCutoff = new Date(today)
    staleCutoff.setDate(today.getDate() - 30)

    // ── Parallel data fetches ──────────────────────────────────────────────────
    const [wishlistRes, eventsRes, staleRes] = await Promise.all([
      // 1. Wishlist items where eBay price has dropped to/below target
      db
        .from('wishlist')
        .select('id, card_name, set_name, target_price, last_ebay_price')
        .eq('org_id', orgId)
        .eq('status', 'wanted')
        .is('deleted_at', null)
        .not('last_ebay_price', 'is', null)
        .not('target_price',    'is', null),

      // 2. Calendar events today and tomorrow
      db
        .from('calendar_events')
        .select('id, title, event_date, start_time, event_type')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .in('event_date', [todayStr, tomorrowStr])
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false }),

      // 3. Listed cards not updated in 30+ days (stale listings)
      db
        .from('cards')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'Listed')
        .is('deleted_at', null)
        .lt('updated_at', staleCutoff.toISOString()),
    ])

    const notifications: AppNotification[] = []

    // ── 1. Price drops ─────────────────────────────────────────────────────────
    for (const item of wishlistRes.data ?? []) {
      const ebay   = item.last_ebay_price as number
      const target = item.target_price    as number
      if (ebay <= target) {
        notifications.push({
          id:       `wishlist-${item.id}`,
          type:     'price_drop',
          title:    `Price alert: ${item.card_name as string}`,
          body:     `eBay avg £${ebay.toFixed(2)} — target £${target.toFixed(2)}`,
          href:     '/wishlist',
          severity: 'success',
        })
      }
    }

    // ── 2. Calendar events ────────────────────────────────────────────────────
    for (const ev of eventsRes.data ?? []) {
      const isToday = ev.event_date === todayStr
      const when    = isToday ? 'Today' : 'Tomorrow'
      const time    = ev.start_time ? ` at ${ev.start_time as string}` : ''
      notifications.push({
        id:       `event-${ev.id}`,
        type:     isToday ? 'event_today' : 'event_tomorrow',
        title:    ev.title as string,
        body:     `${when}${time}`,
        href:     '/calendar',
        severity: isToday ? 'warning' : 'info',
      })
    }

    // ── 3. Stale listings ─────────────────────────────────────────────────────
    const staleCount = staleRes.count ?? 0
    if (staleCount > 0) {
      notifications.push({
        id:       'stale-listings',
        type:     'stale_listing',
        title:    `${staleCount} listing${staleCount !== 1 ? 's' : ''} over 30 days old`,
        body:     'Consider repricing or relisting',
        href:     '/stock?status=Listed',
        severity: 'warning',
      })
    }

    return ok({ notifications, count: notifications.length })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
