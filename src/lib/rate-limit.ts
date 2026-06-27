// =============================================================================
// CardVault Pro — Rate limiting via Upstash Redis
// Degrades gracefully: if UPSTASH_REDIS_REST_URL is not set, all requests pass.
// This means rate limiting is optional in local dev but active in production.
//
// Singleton pattern: Redis connection and Ratelimit instances are created once
// at module level and reused across all requests in the same Node.js process.
// This prevents a new TCP connection on every API call.
//
// Usage in a route handler:
//   const limit = await rateLimit(request, 'ebay-price', { max: 20, window: '1m' })
//   if (!limit.success) return tooManyRequests()
// =============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { features } from '@/lib/env'

interface RateLimitConfig {
  /** Max requests allowed in the time window */
  max: number
  /** Time window: '10s' | '1m' | '10m' | '1h' | '1d' */
  window: '10s' | '1m' | '10m' | '1h' | '1d'
}

interface RateLimitResult {
  success:   boolean
  limit:     number
  remaining: number
  reset:     number  // Unix timestamp when the window resets
}

const WINDOW_SECONDS: Record<RateLimitConfig['window'], number> = {
  '10s': 10,
  '1m':  60,
  '10m': 600,
  '1h':  3600,
  '1d':  86400,
}

// ── Module-level singletons ────────────────────────────────────────────────────
// One Redis connection shared across all rate-limit calls in the process.
// Limiter instances are keyed by "identifier:max:window" so each unique
// config gets its own sliding-window counter without creating duplicate objects.

let _redis: import('@upstash/redis').Redis | null = null
const _limiters = new Map<string, import('@upstash/ratelimit').Ratelimit>()

async function getRedis(): Promise<import('@upstash/redis').Redis> {
  if (!_redis) {
    const { Redis } = await import('@upstash/redis')
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  }
  return _redis
}

async function getLimiter(
  identifier: string,
  config: RateLimitConfig,
): Promise<import('@upstash/ratelimit').Ratelimit> {
  const cacheKey = `${identifier}:${config.max}:${config.window}`
  const cached = _limiters.get(cacheKey)
  if (cached) return cached

  const { Ratelimit } = await import('@upstash/ratelimit')
  const redis         = await getRedis()
  const windowSeconds = WINDOW_SECONDS[config.window]

  const limiter = new Ratelimit({
    redis,
    limiter:   Ratelimit.slidingWindow(config.max, `${windowSeconds} s`),
    analytics: true,
    prefix:    'cardvault',
  })

  _limiters.set(cacheKey, limiter)
  return limiter
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Apply rate limiting to an API route.
 * The key is scoped per IP + identifier, so different routes have independent limits.
 */
export async function rateLimit(
  request: NextRequest,
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  // If Redis is not configured, allow everything (local dev / unconfigured)
  if (!features.redisEnabled) {
    return { success: true, limit: config.max, remaining: config.max, reset: 0 }
  }

  const limiter = await getLimiter(identifier, config)

  // Use the real IP address as the rate limit key. In production behind a proxy
  // (Vercel / Cloudflare), x-forwarded-for is set; fall back to a static string
  // in dev so localhost doesn't blow through limits during testing.
  const ip  = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? request.headers.get('x-real-ip')
           ?? '127.0.0.1'
  const key = `${identifier}:${ip}`

  const { success, limit, remaining, reset } = await limiter.limit(key)
  return { success, limit, remaining, reset }
}

/**
 * Standard 429 response with Retry-After header.
 */
export function tooManyRequests(retryAfterSeconds = 60) {
  return NextResponse.json(
    { error: 'Too many requests. Please slow down.' },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    }
  )
}
