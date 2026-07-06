// =============================================================================
// POST /api/billing/portal
//
// Creates a Stripe Customer Portal session for managing an existing subscription.
// The portal lets users: update payment method, view invoices, cancel, upgrade/
// downgrade, and update billing address.
//
// Requires: org must have a stripe_customer_id (i.e. has been through checkout).
//
// Returns: { url: string }
// =============================================================================
import { requireAuth, ok, badRequest, serverError } from '@/lib/api'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const { orgId } = await requireAuth({ role: 'owner' })

    const admin  = createAdminClient()
    const stripe = getStripe()

    const { data: org } = await admin
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', orgId)
      .single()

    if (!org?.stripe_customer_id) {
      return badRequest(
        'No billing account found. Complete a checkout first to create your subscription.'
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    const session = await stripe.billingPortal.sessions.create({
      customer:   org.stripe_customer_id as string,
      return_url: `${appUrl}/billing`,
    })

    return ok({ url: session.url })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
