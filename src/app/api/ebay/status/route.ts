// =============================================================================
// GET /api/ebay/status
// Returns eBay OAuth connection status for the org. Never returns raw tokens.
// =============================================================================
import { requireAuth, ok, serverError } from '@/lib/api'
import { getCredentials, EBAY_IS_SANDBOX } from '@/lib/ebay'

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const creds     = await getCredentials(orgId).catch(() => null)

    const hasToken    = !!creds?.accessToken
    const hasRefresh  = !!creds?.refreshToken
    const expiresAt   = creds?.tokenExpiresAt ?? null
    const isExpired   = expiresAt ? expiresAt < new Date() : true
    const expiresInMs = expiresAt ? expiresAt.getTime() - Date.now() : null

    return ok({
      connected:      hasToken && hasRefresh,
      has_token:      hasToken,
      has_refresh:    hasRefresh,
      is_expired:     isExpired,
      expires_at:     expiresAt?.toISOString() ?? null,
      expires_in_ms:  expiresInMs,
      is_sandbox:     EBAY_IS_SANDBOX,
      has_credentials: !!(creds?.appId && creds?.secret && creds?.ruName),
    })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
