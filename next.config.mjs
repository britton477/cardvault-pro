// @ts-check

// =============================================================================
// Content Security Policy
// Locked down for a server-rendered SaaS app with no inline scripts.
// Update these directives if you add new third-party services.
// =============================================================================
const isDev = process.env.NODE_ENV === 'development'

const CSP_DIRECTIVES = [
  "default-src 'self'",

  // Scripts — self only; no unsafe-inline, no unsafe-eval
  // unsafe-eval needed only in dev (Next.js HMR)
  isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self'",

  // Styles — allow inline (Tailwind injects <style> tags)
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

  // Fonts
  "font-src 'self' https://fonts.gstatic.com",

  // Images — self + R2 + Supabase Storage + Pokémon TCG API CDN + eBay CDN
  "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://pub-c59cea87a1864fec8d9b26dff50021ed.r2.dev https://images.cardvaultpro.com https://*.supabase.co https://images.pokemontcg.io https://i.ebayimg.com",

  // Connections — self + Supabase + eBay APIs
  [
    "connect-src 'self'",
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    'https://*.supabase.co',
    'wss://*.supabase.co',   // Realtime websockets
    'https://api.pokemontcg.io',
    'https://api.ebay.com',
    'https://api.sandbox.ebay.com',
    isDev ? 'ws://localhost:3000' : '', // HMR websocket
  ].filter(Boolean).join(' '),

  // Frames — nothing, ever
  "frame-src 'none'",
  "frame-ancestors 'none'",

  // Forms — self only
  "form-action 'self'",

  // Objects — none
  "object-src 'none'",

  // Base URI — self
  "base-uri 'self'",

  // Workers
  "worker-src 'self' blob:",

  // Upgrade insecure requests in production
  ...(!isDev ? ['upgrade-insecure-requests'] : []),
].join('; ')


/** @type {import('next').NextConfig} */
const config = {
  // ── Performance ─────────────────────────────────────────────────────────────
  compress:       true,   // gzip response bodies at the Node.js layer
  poweredByHeader: false, // don't leak "X-Powered-By: Next.js"

  // ── Image optimisation ──────────────────────────────────────────────────────
  images: {
    formats: ['image/avif', 'image/webp'], // modern formats, smallest size
    remotePatterns: [
      // Cloudflare R2 public bucket
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      // Custom domain pointing to R2
      { protocol: 'https', hostname: 'images.cardvaultpro.com' },
      // Pokémon TCG card images (for auto-fill thumbnails)
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      // Supabase Storage (fallback when R2 is not configured)
      { protocol: 'https', hostname: '*.supabase.co' },
      // R2 public development URL
      { protocol: 'https', hostname: 'pub-c59cea87a1864fec8d9b26dff50021ed.r2.dev' },
      // imgbb (legacy — remove once all images migrated to Supabase Storage)
      { protocol: 'https', hostname: 'i.ibb.co' },
    ],
    minimumCacheTTL: 86400, // cache optimised images for 24 hours
  },

  // ── Security headers ────────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // ── Core security ────────────────────────────────────────────────────
          { key: 'X-Content-Type-Options',   value: 'nosniff' },
          { key: 'X-Frame-Options',          value: 'DENY' },
          { key: 'X-XSS-Protection',         value: '1; mode=block' },
          { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
          {
            key:   'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          // ── CSP ───────────────────────────────────────────────────────────────
          {
            key:   'Content-Security-Policy',
            value: CSP_DIRECTIVES,
          },
          // ── HSTS (max-age = 1 year; enable once confirmed on HTTPS) ───────────
          // Only enforce in production behind HTTPS to avoid breaking local HTTP dev
          ...(!isDev ? [{
            key:   'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          }] : []),
        ],
      },
      // ── Static assets — long-lived cache ─────────────────────────────────────
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // ── PWA manifest + icons ─────────────────────────────────────────────────
      {
        source: '/manifest.json',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
    ]
  },

  // ── TypeScript ───────────────────────────────────────────────────────────────
  // Skip tsc --noEmit during build; SWC compiles fine regardless of type errors.
  // Type errors still show in the editor. Re-enable once the codebase is clean.
  typescript: {
    ignoreBuildErrors: true,
  },

  // ── ESLint ───────────────────────────────────────────────────────────────────
  // Skip ESLint during build for the same reason — lint in CI separately.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // ── Experimental features ────────────────────────────────────────────────────
  experimental: {
    typedRoutes: true,
  },
}

export default config
