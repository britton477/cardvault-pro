// =============================================================================
// POST /api/billing/checkout
//
// Creates a Stripe Checkout session for upgrading the org's plan.
// Redirects the user to Stripe's hosted payment page.
//
// Flow:
//   1. Validate the requested plan
//   2. Look up or create a Stripe Customer for this org
//   3. Create a Checkout session (subscription mode)
//   4. Return the session URL for client-side redirect
//
// Returns: { url: string }
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { requireAuth, ok, badRequest, serverError, validationError } from '@/lib/api'
import { getStripe, PLANS } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/server'

const BodySchema = z.object({
  plan_id: z.enum(['basic', 'growth', 'pro']),
})

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()

    const body    = await request.json() as unknown
    const { plan_id } = BodySchema.parse(body)

    const plan = PLANS[plan_id]
    if (!plan.stripePriceId) {
      return badRequest(
        `${plan.name} plan is not available. ` +
        'Ensure STRIPE_PRICE_' + plan_id.toUpperCase() + ' is configured.'
      )
    }

    const admin  = createAdminClient()
    const stripe = getStripe()

    // ── Load org ──────────────────────────────────────────────────────────────
    const { data: org } = await admin
      .from('organizations')
      .select('name, stripe_customer_id, plan')
      .eq('id', orgId)
      .single()

    if (!org) return serverError(new Error('Organisation not found'))

    // ── Get or create Stripe customer ─────────────────────────────────────────
    // We store customer ID on the org so repeat checkouts reuse the same
    // Stripe customer — this keeps payment history together and avoids
    // creating orphaned customers.
    let customerId = org.stripe_customer_id as string | null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    user.email,
        name:     org.name as string,
        metadata: { org_id: orgId },
      })
      customerId = customer.id

      // Persist immediately — if the checkout is abandoned we still want the
      // customer ID so the next attempt reuses the same Stripe customer.
      await admin
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', orgId)
    }

    // ── Create Checkout session ───────────────────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: plan.stripePriceId, quantity: 1 }],
      // Pass org_id and plan_id in metadata — webhook uses this to update the org
      metadata:    { org_id: orgId, plan_id },
      subscription_data: {
        metadata: { org_id: orgId, plan_id },
      },
      success_url:          `${appUrl}/billing?success=1`,
      cancel_url:           `${appUrl}/billing?cancelled=1`,
      allow_promotion_codes: true,
      // Billing address collection for VAT compliance (UK/EU sellers)
      billing_address_collection: 'auto',
    })

    return ok({ url: session.url })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
