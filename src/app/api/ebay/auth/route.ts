// =============================================================================
// GET /api/ebay/auth
// Generates the eBay OAuth consent URL and redirects the user to it.
// The user approves permissions on eBay, then eBay redirects to /api/ebay/callback.
// =============================================================================
import { redirect }         from 'next/navigation'
import { requireAuth }      from '@/lib/api'
import { getCredentials, buildConsentUrl } from '@/lib/ebay'

export async function GET() {
  try {
    const { orgId } = await requireAuth({ role: 'owner' })
    const creds     = await getCredentials(orgId)

    if (!creds.appId || !creds.ruName) {
      redirect('/settings?ebay_error=missing_credentials')
    }

    const consentUrl = buildConsentUrl(creds.appId, creds.ruName)
    redirect(consentUrl)
  } catch (err) {
    // requireAuth throws a NextResponse on 401 — let it propagate
    if (err instanceof Response) return err
    // redirect() throws internally — let it propagate
    throw err
  }
}
