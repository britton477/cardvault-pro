// =============================================================================
// Supabase Auth callback
// Handles:
//   - OAuth sign-in (eBay OAuth uses /api/ebay/callback, not this route)
//   - Magic-link / email confirmation links (type=signup or type=recovery)
//
// Supabase sends the user here after they click the confirmation email link.
// The URL contains a `code` param (PKCE flow) which we exchange for a session.
// On success we redirect to /dashboard; on failure to /login with an error flag.
// =============================================================================
import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code     = searchParams.get('code')
  const type     = searchParams.get('type')   // 'signup' | 'recovery' | null
  const redirect = searchParams.get('redirect') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // For fresh email confirmations, show a welcome landing on the dashboard
      const destination = type === 'signup' ? '/dashboard?welcome=1' : redirect
      return NextResponse.redirect(`${origin}${destination}`)
    }
  }

  // Link expired or already used — send to login with a clear error
  const errorParam = type === 'signup' ? 'confirmation_expired' : 'auth_callback_failed'
  return NextResponse.redirect(`${origin}/login?error=${errorParam}`)
}
