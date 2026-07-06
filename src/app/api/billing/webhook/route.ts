// =============================================================================
// POST /api/billing/webhook
//
// Handles Stripe webhook events to keep subscription state in sync with our DB.
//
// ── Security ─────────────────────────────────────────────────────────────────
// This route is in PUBLIC_PATHS (middleware.ts) — it bypasses CSRF protection
// because Stripe sends no Origin or Cookie header. Instead, we verify the
// Stripe-Signature header using stripe.webhooks.constructEvent(). If the
// signature is invalid, we return 400 and discard the event. Never trust the
// payload without verifying the signature first.
//
// ── Raw body requirement ──────────────────────────────────────────────────────
// Stripe signs the raw request body. We MUST read it as text (not parsed JSON)
// because even minor whitespace differences break the HMAC signature check.
// Do NOT call request.json() anywhere in this handler.
//
// ── Idempotency ──────────────────────────────────────────────────────────────
// Stripe retries webhooks on non-2xx responses (up to 3 days). All DB writes
// here are idempotent UPDATE statements — safe to replay. We return 200 even
// after internal processing errors to prevent infinite retries, then alert via
// console.error so the issue can be investigated separately.
//
// ── Events handled ───────────────────────────────────────────────────────────
//   checkout.session.completed        → persist customer ID
//   customer.subscription.created     → activate plan
//   customer.subscription.updated     → handle plan changes / trial end
//   customer.subscription.deleted     → downgrade to free
//   invoice.payment_failed            → mark past_due (show banner in UI)
//   invoice.payment_succeeded         → clear past_due
// =============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, getPlanByPriceId, PLAN_CARD_LIMITS } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/server'

// Stripe POSTs directly — no Supabase session, no CSRF cookie
export const dynamic = 'force-dynamic'

// ── Helpers ───────────────────────────────────────────────────────────────────

type DB = ReturnType<typeof createAdminClient>

/**
 * Update org plan, card limit, and subscription status from a Stripe Subscription.
 * Used by both subscription.created and subscription.updated.
 */
async function syncSubscription(db: DB, orgId: string, sub: Stripe.Subscription) {
  const priceId = sub.items.data[0]?.price.id ?? ''
  const planId  = getPlanByPriceId(priceId) ?? 'free'

  await db
    .from('organizations')
    .update({
      plan:                   planId,
      card_limit:             PLAN_CARD_LIMITS[planId] ?? 100,
      stripe_subscription_id: sub.id,
      subscription_status:    sub.status,   // 'active' | 'trialing' | 'past_due' | etc.
    })
    .eq('id', orgId)
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── 1. Read raw body and verify signature ─────────────────────────────────
  const rawBody = await request.text()
  const sig     = request.headers.get('stripe-signature') ?? ''
  const secret  = process.env.STRIPE_WEBHOOK_SECRET

  if (!secret) {
    console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret)
  } catch (err) {
    console.error('[Stripe webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // ── 2. Process event ──────────────────────────────────────────────────────
  const db = createAdminClient()

  try {
    switch (event.type) {
      // ── Checkout completed ────────────────────────────────────────────────
      // The subscription.created event handles plan activation. Here we just
      // ensure the customer ID is stored in case it wasn't during /checkout.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const orgId   = session.metadata?.org_id
        if (!orgId || !session.customer) break

        await db
          .from('organizations')
          .update({ stripe_customer_id: session.customer as string })
          .eq('id', orgId)
        break
      }

      // ── Subscription created / updated ────────────────────────────────────
      // Primary event for keeping plan state in sync. Fires on:
      //   - Initial checkout completion (created)
      //   - Plan upgrade/downgrade via portal (updated)
      //   - Trial period end (updated, status changes to 'active' or 'past_due')
      //   - Renewal (updated)
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub   = event.data.object as Stripe.Subscription
        const orgId = sub.metadata?.org_id
        if (!orgId) {
          console.warn('[Stripe webhook] subscription event missing org_id metadata:', sub.id)
          break
        }
        await syncSubscription(db, orgId, sub)
        break
      }

      // ── Subscription cancelled ────────────────────────────────────────────
      // Fires when: user cancels via portal, payment fails too many times,
      // or we manually cancel via Stripe dashboard.
      case 'customer.subscription.deleted': {
        const sub   = event.data.object as Stripe.Subscription
        const orgId = sub.metadata?.org_id
        if (!orgId) break

        await db
          .from('organizations')
          .update({
            plan:                   'free',
            card_limit:             100,
            stripe_subscription_id: null,
            subscription_status:    'cancelled',
          })
          .eq('id', orgId)
        break
      }

      // ── Payment failed ────────────────────────────────────────────────────
      // Mark past_due so the UI can show a "update payment method" banner.
      // Stripe will retry several times over a few days before cancelling.
      case 'invoice.payment_failed': {
        const invoice  = event.data.object as Stripe.Invoice
        const customer = invoice.customer as string
        if (!customer) break

        await db
          .from('organizations')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', customer)
        break
      }

      // ── Payment recovered ─────────────────────────────────────────────────
      // Clears past_due status after a previously failed invoice is paid.
      case 'invoice.payment_succeeded': {
        const invoice  = event.data.object as Stripe.Invoice
        const customer = invoice.customer as string
        if (!customer) break

        await db
          .from('organizations')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', customer)
        break
      }

      default:
        // Unhandled event types — safe to ignore.
        break
    }
  } catch (err) {
    // Log but return 200. Returning 4xx/5xx causes Stripe to retry, which
    // can cause duplicate processing if the error is transient.
    console.error(`[Stripe webhook] Error handling ${event.type}:`, err)
  }

  // ── 3. Acknowledge receipt ────────────────────────────────────────────────
  return NextResponse.json({ received: true })
}
