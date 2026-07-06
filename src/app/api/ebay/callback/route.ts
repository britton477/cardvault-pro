// =============================================================================
// GET /api/ebay/callback
// eBay redirects here after the user approves OAuth permissions.
// Query params: ?code=...&expires_in=...
// Exchanges the code for access + refresh tokens, encrypts and persists them,
// then redirects to /settings with a success or error flag.
// =============================================================================
import { type NextRequest } from 'next/server'
import { redirect }         from 'next/navigation'
import { requireAuth }      from '@/lib/api'
import {
  getCredentials,
  exchangeCodeForTokens,
  saveTokens,
} from '@/lib/ebay'

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth({ role: 'owner' })

    const code  = request.nextUrl.searchParams.get('code')
    const error = request.nextUrl.searchParams.get('error')

    // User denied consent on eBay
    if (error || !code) {
      redirect('/settings?ebay_error=access_denied')
    }

    const creds = await getCredentials(orgId)

    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForTokens(
      code,
      creds.appId,
      creds.secret,
      creds.ruName,
    )

    await saveTokens(orgId, accessToken, refreshToken, expiresIn)

    redirect('/settings?ebay_connected=1')
  } catch (err) {
    if (err instanceof Response) return err
    // redirect() throws — let it propagate
    throw err
  }
}
