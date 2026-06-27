// =============================================================================
// CardVault Pro — Server-side Redis cache (Upstash)
// Degrades gracefully: if Redis is not configured, fetcher is called directly
// and nothing is cached. Safe in local dev and on the free tier.
//
// Usage:
//   const stats = await withCache(
//     `dashboard:${orgId}`,
//     60,                         // TTL in seconds
//     () => fetchDashboardStats(orgId)
//   )
// =============================================================================
import { features } from '@/lib/env'

let redisClient: import('@upstash/redis').Redis | null = null

async function getRedis() {
  if (!features.redisEnabled) return null
  if (redisClient) return redisClient

  const { Redis } = await import('@upstash/redis')
  redisClient = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
  return redisClient
}

/**
 * Cache-aside pattern. Returns cached value if present, otherwise calls
 * fetcher, stores the result, and returns it.
 *
 * @param key    Unique cache key (use org-scoped keys to prevent data leakage)
 * @param ttlSec Time-to-live in seconds
 * @param fetcher Async function that returns the data to cache
 */
export async function withCache<T>(
  key: string,
  ttlSec: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const redis = await getRedis()

  if (redis) {
    try {
      const cached = await redis.get<T>(key)
      if (cached !== null) return cached
    } catch (err) {
      // Redis errors must never break the app — fall through to the fetcher
      console.error('[CardVault Cache] Redis GET failed, falling back to DB:', err)
    }
  }

  const data = await fetcher()

  if (redis) {
    try {
      await redis.setex(key, ttlSec, JSON.stringify(data))
    } catch (err) {
      console.error('[CardVault Cache] Redis SET failed:', err)
    }
  }

  return data
}

/**
 * Invalidate a specific cache key. Call this after mutations.
 * Safe to call even if Redis is not configured.
 */
export async function invalidateCache(key: string): Promise<void> {
  const redis = await getRedis()
  if (!redis) return
  try {
    await redis.del(key)
  } catch (err) {
    console.error('[CardVault Cache] Redis DEL failed:', err)
  }
}

/**
 * Invalidate all cache keys matching a pattern (e.g. "dashboard:*").
 * Uses Redis SCAN — safe for large keyspaces (no KEYS command).
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  const redis = await getRedis()
  if (!redis) return
  try {
    let cursor = 0
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: `cardvault:${pattern}`, count: 100 })
      cursor = Number(nextCursor)
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } while (cursor !== 0)
  } catch (err) {
    console.error('[CardVault Cache] Pattern invalidation failed:', err)
  }
}
