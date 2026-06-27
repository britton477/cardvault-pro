// =============================================================================
// Next.js instrumentation hook — runs once at server startup
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
// =============================================================================

export async function register() {
  // Validate environment variables first — throws immediately if anything is missing
  await import('@/lib/env')

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')

    if (process.env.NODE_ENV === 'development') {
      console.log('[CardVault] Server started. Environment validated ✓')
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}
