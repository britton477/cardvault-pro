// =============================================================================
// Next.js Middleware — Auth route protection + CSRF + Supabase session refresh
// =============================================================================
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that don't require a logged-in session
const PUBLIC_PATHS = ['/login', '/register', '/auth/callback', '/api/health', '/api/auth/register', '/register/check-email']

// HTTP methods that mutate state — require CSRF Origin check
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

// =============================================================================
// CSRF: verify the Origin header on all state-changing API requests.
// This prevents cross-site request forgery where an attacker's page
// submits a form to our API using the victim's cookies.
// =============================================================================
function verifyCsrf(request: NextRequest): NextResponse | null {
  const { pathname, method } = request.nextUrl

  // Only enforce on API mutation routes
  if (!pathname.startsWith('/api/') || !MUTATION_METHODS.has(method)) {
    return null // pass through
  }

  // These public endpoints don't need CSRF protection
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return null
  }

  const origin = request.headers.get('origin')
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  // Allow requests with no Origin header only from same-host server-side calls
  // (e.g. curl from localhost in dev). In production this would be blocked.
  if (!origin) {
    if (process.env['NODE_ENV'] === 'development') return null
    return NextResponse.json({ error: 'Missing Origin header' }, { status: 403 })
  }

  // Normalise both URLs to just origin (scheme + host) for comparison
  let expectedOrigin: string
  try {
    expectedOrigin = new URL(appUrl).origin
  } catch {
    expectedOrigin = appUrl
  }

  if (origin !== expectedOrigin) {
    return NextResponse.json(
      { error: 'CSRF: Origin mismatch' },
      { status: 403 }
    )
  }

  return null // origin matched — pass through
}

// =============================================================================
// Main middleware
// =============================================================================
export async function middleware(request: NextRequest) {
  // 1. CSRF check (fast, no async I/O)
  const csrfError = verifyCsrf(request)
  if (csrfError) return csrfError

  // 2. Supabase session check (cookie-local — no network call)
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: Use getSession() here instead of getUser().
  //
  // getUser() makes a network call to Supabase on every request to validate
  // the JWT server-side. On cold start (first TCP connection from Node.js to
  // Supabase), this call can hang for 5–30 seconds, breaking every page load.
  //
  // getSession() reads the session directly from the encrypted cookie — no
  // network round-trip. This is intentional: middleware's job is route
  // protection only (decide whether to show the page). Actual data security
  // is enforced in API route handlers via requireAuth() → getUser().
  //
  // Security note: a sufficiently motivated attacker could forge a session
  // cookie to bypass middleware. They would still be blocked by the API
  // routes, so they'd see the UI shell but receive no data.
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  // 3. Auth guard — redirect unauthenticated users to login
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // 4. Redirect authenticated users away from login page
  if (user && pathname === '/login') {
    const dashUrl = request.nextUrl.clone()
    dashUrl.pathname = '/dashboard'
    dashUrl.searchParams.delete('redirect')
    return NextResponse.redirect(dashUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Match all request paths except static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
