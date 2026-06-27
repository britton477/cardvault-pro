# CardVault Pro — Production Readiness Plan
> Senior Engineering Review · June 2026

---

## 1. Executive Summary

CardVault Pro is a multi-tenant TCG inventory and sales management platform targeting independent card sellers and small shops in the UK and European markets. The core product is solid — Next.js 14 App Router, Supabase with RLS, TanStack Query, Redis rate-limiting, and a well-structured API layer. The following plan identifies the gaps standing between the current build and a production-ready, scalable SaaS product, then prioritises them into execution sprints.

---

## 2. Competitor Landscape

### 2.1 BinderPOS (now TCGplayer BinderPOS)
- **Price:** $100–$150 USD/month + 2% online sales commission + Shopify subscription required
- **Strengths:** TCGplayer marketplace integration, automatic price updates every 12h, Shopify storefront, event management, buylist system, store credit module
- **Critical weakness:** Currently **on a WAITLIST** — new signups paused. US-centric. Requires Shopify. No eBay integration. No mobile show-mode.
- **Our opportunity:** Hit the market *now* while their waitlist grows. eBay-first approach directly addresses the UK/EU market where TCGplayer has no traction.

### 2.2 TCGPlayer Pro
- **Price:** Commission-based, locked to TCGplayer marketplace
- **Strengths:** Price data from millions of daily transactions, barcode scanning, mobile app
- **Weakness:** Only works if you sell on TCGplayer. No eBay, no Facebook, no F2F. US-only.

### 2.3 CollX
- **Focus:** Collection scanning / portfolio tracking (consumer, not seller-focused)
- **Strengths:** Camera-scan to identify cards, automatic pricing
- **Weakness:** Not a POS or sales management tool. No P&L tracking.

### 2.4 Dragon Shield Card Manager / Moxfield
- **Focus:** Collection management (hobbyist, not commercial seller)
- **No direct competition** in the B2B seller tooling space

### 2.5 Card Conduit
- Not a competitor — they are a B2C consignment service, not tooling

### 2.6 Market Gap We Fill
| Feature | BinderPOS | TCGPlayer Pro | CollX | **CardVault Pro** |
|---|---|---|---|---|
| eBay integration | ✗ | ✗ | ✗ | ✅ Bulk listing + price fetch |
| Facebook Marketplace | ✗ | ✗ | ✗ | ✅ Sales tracked |
| UK / EU market | Partial | ✗ | ✗ | ✅ Primary |
| Show Mode (mobile POS) | ✗ | ✗ | ✗ | ✅ Unique |
| Multi-platform P&L | ✗ | ✗ | ✗ | ✅ All in one |
| No commission on sales | ✗ | ✗ | ✅ | ✅ Fixed subscription |
| Available now | WAITLIST | ✅ | ✅ | ✅ |
| Card barcode scan | ✗ | ✅ | ✅ | Roadmap |
| Automatic price sync | ✅ 12h | ✅ | ✅ | Roadmap |

**The big insight:** BinderPOS is on a waitlist. There is an acute demand signal for POS tooling in the TCG space. CardVault Pro can capture that market *right now* with an eBay-first, UK-focused pitch.

---

## 3. Current Architecture Assessment

### 3.1 What's Working Well
- **Multi-tenant RLS** — proper org-scoped data isolation with Supabase RLS
- **Zod validation everywhere** — all inputs validated server-side before DB write
- **Audit log** — fire-and-forget audit trail on all mutations
- **Redis rate limiting** — sliding window, per-IP, per-endpoint (Upstash)
- **Redis caching** — `withCache` / `invalidateCache` pattern for dashboard stats
- **Soft deletes** — `deleted_at` on all mutable tables, no hard deletes
- **Generated columns** — `profit` on sales, `qty_remaining` on sealed, computed server-side
- **CSRF protection** — Origin header validation in middleware
- **Graceful Redis degradation** — app works without Redis (falls back to DB)

### 3.2 Critical Gaps (P0 — Block Launch)

#### G1: No Sign-Up Flow
The `/login` page only supports existing users. There is no `/register` page and no `/api/auth/register` route. Nobody can create a new account. **This is a launch blocker.**

#### G2: requireAuth() Makes 2 DB Calls Per API Request
Every API call to `requireAuth()` executes:
1. `supabase.auth.getUser()` — JWT validation via Supabase network call
2. Admin query: `users JOIN organizations JOIN org_settings`

At 100 concurrent users making 5 API calls/second = 1,000 DB queries/second just for auth. Fix: cache the profile in Redis with a 60s TTL.

#### G3: Type Bugs Breaking Lots + Buyers Features
- `CreateCardInput` is missing `lot_id?: string` — the form submits it but the type strips it
- `CreateSaleInput` is missing `buyer_name?: string` and `buyer_id?: string`

#### G4: DB Migrations Not Applied
`20240005_purchase_lots.sql` and `20240006_buyers.sql` have been written but not executed against the live DB. The Lots and Buyers pages will 500 error until these run.

#### G5: org_dashboard_stats VIEW is O(n²) at Scale
The view does `organizations LEFT JOIN cards LEFT JOIN sales` without partitioning. With 10,000 orgs and 100,000 cards, this is a full table scan. Needs to be a materialised view refreshed on write, or replaced with a per-org function call.

### 3.3 Important Gaps (P1 — Ship in First 2 Weeks)

#### G6: No Stripe Billing / Plan Enforcement
The `org_plan` and `card_limit` columns exist but there's no Stripe integration, no subscription management, no payment flow, and the card limit is never enforced in the API. The free tier would be unlimited by accident.

#### G7: No TCG Card Database Integration
Adding a card requires typing the full name, set code, and card number manually. Competitors auto-populate from a card database. The Pokémon TCG API (pokemontcg.io) is free and has 20,000+ cards. This is a significant UX gap.

#### G8: No Team Invitation System
Users can only join an org if a developer manually creates their profile. There's no email invite flow, no invitation link, nothing. Multi-user shops can't onboard their staff.

#### G9: Missing CSP Header
The `next.config.ts` has basic security headers but no `Content-Security-Policy`. Without CSP, XSS attacks on user data are possible.

#### G10: No PWA Manifest
The app has an excellent mobile Show Mode page but it can't be installed on a phone's home screen. A `manifest.json` makes it installable in 30 minutes.

### 3.4 Growth Gaps (P2 — Month 1+)

- **Barcode scanner** — Camera scan for sealed products and card identification
- **Automatic price sync** — Scheduled job to refresh eBay prices for all listed stock
- **CSV/bulk import** — Import existing inventory from spreadsheet
- **Advanced tax reporting** — HMRC-compatible P&L export, VAT tracking
- **Buylist tool** — Let customers submit want lists; compare against stock
- **Store credit system** — Reward repeat buyers, track credits vs. cash payments
- **API for third-party integrations** — Webhook delivery on sale events
- **GDPR compliance** — Account deletion, data export endpoint

---

## 4. System Architecture (Target State for 1M Users)

```
                    ┌─────────────────────────────────┐
                    │         Cloudflare CDN           │
                    │  (edge caching, DDoS, WAF, R2)  │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │         Vercel Edge              │
                    │   Next.js 14 (ISR + SSR)        │
                    │   Middleware (Auth + CSRF)       │
                    └──────┬─────────────┬────────────┘
                           │             │
               ┌───────────▼──┐   ┌─────▼──────────┐
               │  Upstash     │   │  Supabase       │
               │  Redis       │   │  (Postgres)     │
               │  - Rate limit│   │  - Multi-tenant │
               │  - Auth cache│   │  - RLS          │
               │  - Dashboard │   │  - Realtime     │
               └──────────────┘   └─────────────────┘
                                         │
                    ┌────────────────────▼────────────┐
                    │     Cloudflare R2               │
                    │   (Card photos, cheap egress)   │
                    └─────────────────────────────────┘
```

### Scaling Path
| Users | Action |
|---|---|
| 0–1,000 | Current architecture (Supabase free/pro, Vercel hobby) |
| 1,000–10,000 | Upstash Redis caching, Supabase Pro, Vercel Pro |
| 10,000–100,000 | Read replicas on Supabase, materialized views, connection pooling via PgBouncer |
| 100,000–1M | Supabase Enterprise, dedicated Postgres cluster, read-through cache for card prices |

### Key Database Performance Rules
1. **Auth cache in Redis** — Never hit DB for user profile on every API call
2. **Trigram index on card_name** — Already exists; queries MUST use `%term%` format for GIN to activate
3. **Composite indexes** — All queries filter by `org_id` first; all indexes lead with `org_id`
4. **Soft deletes with partial indexes** — `WHERE deleted_at IS NULL` in every index so deleted rows don't bloat active scans
5. **Materialized dashboard stats** — Refresh on write, never compute on read
6. **Connection pooling** — Use Supabase's Transaction Mode pooler URL for API routes (not Session Mode)

---

## 5. Database Schema — Additions Needed

```sql
-- Subscription tracking (for Stripe)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial'; 
-- trial | active | past_due | cancelled
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');

-- Team invitations
CREATE TABLE org_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        user_role NOT NULL DEFAULT 'member',
  token       text NOT NULL UNIQUE,  -- secure random token in invite link
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_invitations_token_idx ON org_invitations(token) WHERE accepted_at IS NULL;
CREATE INDEX org_invitations_org_idx ON org_invitations(org_id);

-- Materialized dashboard stats (replaces the VIEW)
CREATE TABLE org_dashboard_cache (
  org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  active_card_count int NOT NULL DEFAULT 0,
  listed_count      int NOT NULL DEFAULT 0,
  inventory_cost    numeric(12,2) NOT NULL DEFAULT 0,
  listed_value      numeric(12,2) NOT NULL DEFAULT 0,
  pending_sales     int NOT NULL DEFAULT 0,
  total_profit      numeric(12,2) NOT NULL DEFAULT 0,
  total_revenue     numeric(12,2) NOT NULL DEFAULT 0,
  refreshed_at      timestamptz NOT NULL DEFAULT now()
);
```

---

## 6. API Architecture

### 6.1 Endpoints to Add

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account + org + settings in one transaction |
| GET | `/api/tcg/search` | Pokémon TCG API proxy (cached 7 days) |
| POST | `/api/invitations` | Send team invitation email |
| GET | `/api/invitations/[token]` | Validate invitation token |
| POST | `/api/invitations/[token]/accept` | Accept invite + create user profile |
| POST | `/api/billing/checkout` | Stripe Checkout session |
| POST | `/api/billing/portal` | Stripe Customer Portal session |
| POST | `/api/billing/webhook` | Stripe webhook handler |
| GET | `/api/export/gdpr` | Full data export for GDPR |

### 6.2 Performance Targets
- API P95 latency: < 200ms (after auth cache)
- Dashboard load: < 300ms (cached stats + client-side chart data)
- Card search: < 100ms (trigram index, 50ms budget per query)
- Show Mode search: < 150ms (indexed, limited to 8 results)

---

## 7. UI Architecture

### 7.1 Pages to Add
| Route | Priority | Description |
|---|---|---|
| `/register` | P0 | Sign-up flow |
| `/register/verify` | P0 | Email verification pending screen |
| `/onboarding` | P1 | Post-registration: shop name + first card wizard |
| `/invitations/[token]` | P1 | Accept team invite |
| `/billing` | P1 | Plan management + upgrade |
| `/account` | P1 | Personal settings (name, avatar, PIN) |

### 7.2 Component Improvements
- **AddCardModal** — TCG card search dropdown (auto-fill name, set, number)
- **Show Mode** — Barcode scanner button (P1)
- **Stock table** — Virtual scrolling for 1,000+ cards (react-virtual)
- **Reports** — Year-over-year comparison chart
- **Sidebar** — Collapse to icon-only mode for small screens

---

## 8. Pricing Strategy

Competitor analysis supports this model:

| Plan | Price | Limits | Target |
|---|---|---|---|
| **Free** | £0/mo | 100 cards, 1 user, no eBay bulk listing | Try before buy |
| **Solo** | £12/mo | 2,000 cards, 1 user, all features | Single sellers |
| **Shop** | £29/mo | Unlimited cards, 5 users, priority support | Small shops |
| **Pro** | £79/mo | Unlimited, 20 users, API access, custom domain | Serious retailers |

**Positioning:** BinderPOS is $100/month + Shopify + 2% sales commission. We can win on price, eBay integration, and UK focus at less than a third of the cost.

---

## 9. Execution Roadmap

### Sprint 23 — Production Foundations (This Sprint)
- [x] Apply DB migrations (lots + buyers)
- [x] Fix type bugs (lot_id, buyer fields)  
- [x] Auth caching in requireAuth() — Redis profile cache
- [x] Sign-up / registration flow
- [x] Pokémon TCG card auto-fill in AddCardModal
- [x] PWA manifest
- [x] Harden next.config.ts
- [x] DB performance indexes

### Sprint 24 — Go-to-Market Ready
- [ ] Stripe billing integration (checkout, portal, webhook)
- [ ] Plan limit enforcement (card_limit check in POST /api/cards)
- [ ] Team invitation flow
- [ ] Onboarding wizard (post-registration)
- [ ] Email templates (welcome, invite, billing)

### Sprint 25 — UX Polish & Growth
- [ ] Barcode scanner (ZXing via WebRTC, no native app needed)
- [ ] Automatic eBay price sync (Vercel Cron, daily per org)
- [ ] CSV bulk import for inventory
- [ ] Virtual scrolling in StockTable (react-virtual)
- [ ] Advanced reports (YoY, tax export)

### Sprint 26 — Retention & Scale
- [ ] Buylist tool (customers submit want lists)
- [ ] Store credit system
- [ ] Webhook API for integrations
- [ ] GDPR data export + account deletion
- [ ] Multi-language (French, German — EU expansion)

---

## 10. Infrastructure Checklist (Pre-Launch)

- [ ] Vercel project + custom domain (`cardvaultpro.com`)
- [ ] Supabase Pro tier (5GB storage, daily backups, PITR)
- [ ] Upstash Redis (pay-as-you-go, $0 until needed)
- [ ] Cloudflare R2 bucket for card photos (cheap egress vs. S3)
- [ ] Sentry DSN configured (error monitoring)
- [ ] Stripe account + webhook endpoint
- [ ] Transactional email (Resend.com — 3,000 free emails/month)
- [ ] Analytics (PostHog — open source, GDPR-friendly)
- [ ] `NEXT_PUBLIC_APP_URL` set to production domain
- [ ] All `LOCAL_ONLY_KEYS` confirmed not in Supabase
- [ ] eBay production app approved (separate from sandbox)
- [ ] `robots.txt` + `sitemap.xml` for SEO

---

## 11. Security Checklist

- [x] CSRF protection (Origin header validation)
- [x] Rate limiting (Upstash, per-IP)
- [x] RLS on all tables
- [x] Service role key server-side only
- [x] eBay credentials AES-256-GCM encrypted at rest
- [x] Soft deletes (no hard data loss)
- [x] Audit log on all mutations
- [ ] Content-Security-Policy header
- [ ] HSTS header (Strict-Transport-Security)
- [ ] Sentry error monitoring active
- [ ] Dependabot / npm audit in CI
- [ ] Penetration test before Series A

---

*Last updated: June 2026 — CardVault Pro Engineering*
