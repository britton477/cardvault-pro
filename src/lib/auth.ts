// =============================================================================
// CardVault Pro — Server-side auth helpers for Server Components + Layouts
// =============================================================================
//
// WHY TWO DIFFERENT AUTH FUNCTIONS?
//
//   requireAuth()       — in lib/api.ts  — used by API Route Handlers
//   requireServerSession() — here       — used by Server Components / Layouts
//
// The key difference is getUser() vs getSession():
//
//   getUser()     → makes a live HTTP request to Supabase to validate the JWT.
//                   This is CORRECT for API routes (data security).
//                   WRONG for server components — causes cold-TCP hang on every
//                   page load because the TCP connection to Supabase isn't warm yet.
//
//   getSession()  → reads the session from the encrypted cookie. No network call.
//                   Safe for server components because:
//                   1. Middleware already handles route protection via getSession().
//                   2. Real data-access security lives in API routes via getUser().
//                   3. Server components only decide WHAT to render, not what data
//                      to expose — the API routes enforce that.
//
// RULE: Never call supabase.auth.getUser() in a layout, page, or server component.
//       Always use getServerSession() or requireServerSession() from this file.
//
// =============================================================================

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Session } from '@supabase/supabase-js'

/**
 * Read the current session from the encrypted cookie.
 * No network call — safe to call on every server component render.
 * Returns null if the user is not logged in or the session has expired.
 */
export async function getServerSession(): Promise<Session | null> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

/**
 * Like getServerSession() but redirects to /login if not authenticated.
 * Use this in layouts and pages that require a logged-in user.
 *
 * Returns the session (never null — the redirect handles the null case).
 */
export async function requireServerSession(): Promise<Session> {
  const session = await getServerSession()
  if (!session?.user) redirect('/login')
  return session
}
