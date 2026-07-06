// =============================================================================
// CardVault Pro — Environment variable validation
// Imported by src/instrumentation.ts so it runs at server startup.
// Throws immediately if any required variable is missing or clearly wrong.
// =============================================================================

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value || value.startsWith('PASTE_')) {
    throw new Error(
      `[CardVault] Missing required environment variable: ${key}\n` +
      `Check your .env.local file and restart the dev server.`
    )
  }
  return value
}

function optionalEnv(key: string): string | undefined {
  const value = process.env[key]
  if (value?.startsWith('PASTE_')) return undefined
  return value
}

// ── Validated env object (import this instead of process.env directly) ────────

export const env = {
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL:    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY:   requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  // Encryption
  EBAY_ENCRYPTION_KEY:         requireEnv('EBAY_ENCRYPTION_KEY'),

  // App
  NEXT_PUBLIC_APP_URL:         requireEnv('NEXT_PUBLIC_APP_URL'),
  NODE_ENV:                    (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',

  // Cloudflare R2 (optional until configured)
  R2_ACCOUNT_ID:     optionalEnv('R2_ACCOUNT_ID'),
  R2_ACCESS_KEY_ID:  optionalEnv('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: optionalEnv('R2_SECRET_ACCESS_KEY'),
  R2_BUCKET_NAME:    optionalEnv('R2_BUCKET_NAME'),
  R2_PUBLIC_URL:     optionalEnv('R2_PUBLIC_URL'),

  // Anthropic (optional until AI features are built)
  ANTHROPIC_API_KEY: optionalEnv('ANTHROPIC_API_KEY'),

  // Upstash Redis (optional until Sprint 3)
  UPSTASH_REDIS_REST_URL:   optionalEnv('UPSTASH_REDIS_REST_URL'),
  UPSTASH_REDIS_REST_TOKEN: optionalEnv('UPSTASH_REDIS_REST_TOKEN'),

  // Sentry (optional until Sprint 2)
  NEXT_PUBLIC_SENTRY_DSN: optionalEnv('NEXT_PUBLIC_SENTRY_DSN'),

  // Stripe billing (optional until billing is configured)
  STRIPE_SECRET_KEY:        optionalEnv('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET:    optionalEnv('STRIPE_WEBHOOK_SECRET'),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'),
  // Price IDs from Stripe dashboard (one per plan tier)
  STRIPE_PRICE_BASIC:       optionalEnv('STRIPE_PRICE_BASIC'),
  STRIPE_PRICE_GROWTH:      optionalEnv('STRIPE_PRICE_GROWTH'),
  STRIPE_PRICE_PRO:         optionalEnv('STRIPE_PRICE_PRO'),
} as const

// ── Feature flags (safe to check anywhere) ────────────────────────────────────

export const features = {
  r2Enabled:      !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY),
  aiEnabled:      !!env.ANTHROPIC_API_KEY,
  redisEnabled:   !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
  sentryEnabled:  !!env.NEXT_PUBLIC_SENTRY_DSN,
  stripeEnabled:  !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
} as const
