// =============================================================================
// Sentry — Browser (client) configuration
// This file runs in the user's browser.
// Keep it minimal: only the DSN and session replay are needed here.
// =============================================================================
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of sessions in production; 100% in dev for easier debugging
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session replay: record what the user was doing when an error occurred.
  // Free tier: 50 replays/month. Only runs on errors, not every session.
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0,

  // Don't report errors in dev unless SENTRY_DSN is set
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Scrub sensitive fields from breadcrumbs and event data
  beforeSend(event) {
    // Never send auth tokens or credentials
    if (event.request?.cookies) {
      event.request.cookies = '[Scrubbed]'
    }
    return event
  },
})
