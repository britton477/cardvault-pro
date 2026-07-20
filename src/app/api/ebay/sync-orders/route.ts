// =============================================================================
// POST /api/ebay/sync-orders
//
// Manually pull recent eBay orders into sales. The hourly cron runs the same
// service; this exists so the user can force an immediate pull when they know
// something just sold.
//
// Body:    { lookback_days?: number }  — defaults to 7, max 90
// Returns: SyncOrdersResult
// =============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { syncEbayOrders } from '@/lib/ebay-orders'
import { invalidateCache } from '@/lib/cache'
import { writeAuditLog } from '@/lib/audit'

// Order sync can be slow: 90 days across several 30-day windows, each paginated.
export const maxDuration = 300

const BodySchema = z.object({
  // A wide window is safe — idempotency prevents double-import — but each extra
  // 30 days costs another round of eBay API calls, so it is capped.
  lookback_days: z.number().int().min(1).max(90).default(7),
})

const NOT_CONNECTED_PHRASES = [
  'not connected',
  'credentials not configured',
  'refresh token missing',
]

function isNotConnectedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  return NOT_CONNECTED_PHRASES.some(p => msg.includes(p))
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth({ feature: 'ebay.bulk_list' })

    // 5 syncs per minute — each is a heavy multi-page eBay call
    const limit = await rateLimit(request, `ebay-sync-orders:${orgId}`, { max: 5, window: '1m' })
    if (!limit.success) return tooManyRequests(60)

    const body  = await request.json().catch(() => ({})) as unknown
    const input = BodySchema.parse(body ?? {})

    const result = await syncEbayOrders(orgId, input.lookback_days, user.id)

    if (result.imported > 0) {
      void invalidateCache(`dashboard:${orgId}`)
      void writeAuditLog({
        orgId, userId: user.id,
        action:     'ebay.sync_orders',
        entityType: 'sales',
        after:      result as unknown as Record<string, unknown>,
      })
    }

    return ok(result)
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    if (isNotConnectedError(err)) {
      return NextResponse.json(
        { error: 'ebay_not_connected', message: 'eBay account not connected. Go to Settings → eBay to connect.' },
        { status: 422 },
      )
    }
    return serverError(err)
  }
}
