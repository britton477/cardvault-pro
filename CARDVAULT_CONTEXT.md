# CardVault Pro — Project Context for Claudian

> **How to use this file in Claudian:** Pin this note as your system context. Reference it with `@CARDVAULT_CONTEXT` at the start of any session. Every technical decision made, every file touched, and every sprint completed is recorded here.

---

## 1. What We Are Building

**CardVault Pro** is a SaaS inventory and sales management platform for Pokémon TCG card traders. It is a B2B product aimed at sellers who list on eBay, sell at events, and want to track their P&L accurately.

**Core workflow:**
1. Scan / photograph cards → Bulk Wizard identifies them via TCG API + AI
2. Cards enter stock with purchase price, condition, set, card number
3. Cards are listed on eBay directly from the app (Trading API)
4. When sold, a sale is recorded with platform fees, shipping, buyer details
5. Dashboard shows P&L, price opportunities, inventory value in real time

**Business model:** Multi-tenant SaaS. Each organisation (org) has one owner and optional team members. Orgs pay monthly via Stripe.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ App Router |
| Auth | Supabase Auth (cookie-based sessions) |
| Database | Supabase (PostgreSQL + RLS) |
| ORM / client | Supabase JS SDK (admin client for server, user client for RLS) |
| Cache | Redis via Upstash (auth profile, eBay prices, dashboard stats) |
| File storage | Cloudflare R2 (card photos) |
| Payments | Stripe (subscriptions + webhooks) |
| eBay Browse API | Card sold-price lookups (client credentials — no user OAuth) |
| eBay Trading API | List / revise / end items (requires user OAuth token) |
| TCG API | Pokémon card identification in Bulk Wizard |
| Client state | TanStack Query (React Query v5) |
| Styling | Tailwind CSS + Radix UI primitives |
| Deployment | Vercel (region: lhr1 — UK) |
| Cron jobs | Vercel Cron (configured in vercel.json) |

---

## 3. Repository Location

```
F:\My Drive\CardVault Pro\app\
```

**Key config files:**
- `vercel.json` — deployment config, cron schedule
- `.env.local` — local secrets (never committed)
- `src/lib/env.ts` — typed env var access
- `package.json` — dependencies + scripts

---

## 4. Full File Structure

```
src/
├── app/
│   ├── (app)/                          ← Authenticated app shell
│   │   ├── layout.tsx                  ← Sidebar + TopBar layout
│   │   ├── dashboard/page.tsx          ← Dashboard (SSR stat cards + client charts)
│   │   ├── stock/page.tsx              ← Stock inventory
│   │   │   └── error.tsx
│   │   ├── sales/page.tsx              ← Sales log
│   │   ├── sealed/page.tsx             ← Sealed product inventory
│   │   ├── ebay-listings/page.tsx      ← Active eBay listing manager
│   │   ├── bulk-wizard/page.tsx        ← AI-assisted card scan + import
│   │   ├── buyers/page.tsx             ← Buyer CRM (Growth+)
│   │   ├── lots/page.tsx               ← Purchase lot tracker (Growth+)
│   │   ├── wishlist/page.tsx           ← Want list with eBay price alerts
│   │   ├── calendar/page.tsx           ← Event calendar + objectives board
│   │   ├── reports/page.tsx            ← P&L analytics (Basic+)
│   │   ├── billing/page.tsx            ← Plan selection + Stripe portal
│   │   ├── settings/page.tsx           ← Org settings + eBay credentials
│   │   ├── contact/page.tsx
│   │   └── info/page.tsx
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── api/
│   │   ├── cards/                      ← CRUD + bulk actions
│   │   │   ├── route.ts                ← GET (list) / POST (create)
│   │   │   ├── [id]/route.ts           ← GET / PATCH / DELETE single card
│   │   │   ├── bulk/route.ts           ← Bulk status/price updates
│   │   │   └── by-ids/route.ts         ← Fetch specific card IDs
│   │   ├── sales/
│   │   │   ├── route.ts                ← GET / POST
│   │   │   └── [id]/route.ts
│   │   ├── ebay/
│   │   │   ├── price/route.ts          ← GET: median eBay sold price (24h cache)
│   │   │   ├── listings/route.ts       ← GET: GetMyeBaySelling (user OAuth)
│   │   │   ├── listings/[id]/route.ts  ← PATCH (revise) / DELETE (end)
│   │   │   ├── list/route.ts           ← POST: list single card
│   │   │   ├── bulk-list/route.ts      ← POST: bulk list up to 50 cards
│   │   │   ├── auth/route.ts           ← eBay OAuth redirect
│   │   │   ├── callback/route.ts       ← eBay OAuth callback
│   │   │   └── status/route.ts         ← eBay connection status
│   │   ├── cron/
│   │   │   └── ebay-prices/route.ts    ← Daily 4am UTC price refresh (all orgs)
│   │   ├── bulk-wizard/
│   │   │   ├── identify/route.ts       ← AI card identification from photo
│   │   │   ├── price/route.ts          ← eBay price lookup for bulk wizard
│   │   │   └── import/route.ts         ← Batch import to stock
│   │   ├── billing/
│   │   │   ├── checkout/route.ts       ← Stripe checkout session
│   │   │   ├── portal/route.ts         ← Stripe customer portal
│   │   │   └── webhook/route.ts        ← Stripe webhook handler
│   │   ├── images/
│   │   │   ├── upload/route.ts         ← R2 upload
│   │   │   ├── reorder/route.ts        ← Photo order update
│   │   │   └── [photoId]/route.ts      ← DELETE photo
│   │   ├── team/
│   │   │   ├── members/route.ts        ← List members
│   │   │   ├── members/[id]/route.ts   ← Update role / remove
│   │   │   ├── invitations/route.ts    ← Send invite
│   │   │   ├── invitations/[id]/route.ts ← Cancel invite
│   │   │   └── accept/route.ts         ← Accept invite (token-based)
│   │   ├── settings/
│   │   │   ├── org/route.ts
│   │   │   └── ebay-credentials/route.ts
│   │   ├── dashboard/
│   │   │   ├── charts/route.ts
│   │   │   └── insights/route.ts       ← Price opportunities, sitting longest
│   │   ├── reports/summary/route.ts
│   │   ├── buyers/                     ← CRUD
│   │   ├── lots/                       ← CRUD + cards
│   │   ├── sealed/                     ← CRUD + open
│   │   ├── wishlist/                   ← CRUD
│   │   ├── wishlist/price-check/route.ts
│   │   ├── events/                     ← Calendar events CRUD
│   │   ├── objectives/                 ← Objectives CRUD
│   │   ├── export/csv/route.ts
│   │   ├── notifications/route.ts
│   │   ├── tcg/search/route.ts         ← Pokémon TCG API proxy
│   │   ├── auth/
│   │   │   ├── register/route.ts
│   │   │   └── me/route.ts
│   │   ├── contact/route.ts
│   │   └── health/route.ts
│   ├── auth/callback/route.ts          ← Supabase OAuth callback
│   ├── print/labels/page.tsx
│   └── show/page.tsx                   ← Public card preview
├── components/
│   ├── ui/                             ← Shared primitives
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Toast.tsx                   ← top-right viewport
│   │   ├── Badge.tsx                   ← ConditionBadge, StatusBadge
│   │   ├── SlideOver.tsx
│   │   ├── FeatureGate.tsx             ← Plan/role gate wrapper
│   │   └── index.ts
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   ├── PageHeaderContext.tsx
│   │   └── NotificationBell.tsx
│   ├── dashboard/
│   │   ├── DashboardCharts.tsx         ← Client-side charts shell
│   │   ├── DashboardHeader.tsx
│   │   ├── ProfitChart.tsx
│   │   ├── PlatformChart.tsx
│   │   ├── ActivityFeed.tsx
│   │   ├── PriceOpportunities.tsx      ← Underpriced card widget (links to /stock?search=)
│   │   ├── SittingLongest.tsx
│   │   ├── StockBySet.tsx
│   │   └── ProfitSnapshot.tsx
│   ├── stock/
│   │   ├── StockView.tsx               ← Main stock page (filters, sort, bulk actions)
│   │   ├── StockTable.tsx              ← Table with sortable headers, graded badge
│   │   ├── AddCardModal.tsx
│   │   ├── EditCardModal.tsx
│   │   ├── CardDetailSlideOver.tsx
│   │   ├── BulkActionBar.tsx
│   │   ├── BulkEbayModal.tsx
│   │   ├── BulkAssignLotModal.tsx
│   │   ├── BulkPriceModal.tsx
│   │   ├── EbayListModal.tsx
│   │   ├── ImageUpload.tsx
│   │   ├── CropModal.tsx
│   │   └── cardConstants.ts
│   ├── sales/
│   │   ├── SalesView.tsx
│   │   ├── SaleDetailSlideOver.tsx
│   │   └── RecordSaleModal.tsx         ← eBay fee auto-calc (12.8% + £0.30)
│   ├── ebay/
│   │   └── EbayListingsView.tsx        ← 3-state: not-connected CTA / error / table
│   ├── bulk-wizard/
│   │   ├── BulkWizardView.tsx          ← Multi-step: scan → price → review → import
│   │   ├── CardScanRow.tsx             ← Per-card edit row (set code full name, price refresh)
│   │   ├── ScanDropZone.tsx
│   │   ├── CostBreakdownTable.tsx
│   │   └── ImportPanel.tsx
│   ├── billing/
│   │   └── BillingActions.tsx
│   ├── settings/
│   │   ├── OrgSettingsForm.tsx
│   │   ├── EbayCredentialsForm.tsx
│   │   ├── EbayConnectionCard.tsx
│   │   └── PolicyIdsForm.tsx
│   ├── buyers/BuyersView.tsx
│   ├── lots/
│   │   ├── PurchaseLotsView.tsx
│   │   └── LotDetailSlideOver.tsx
│   ├── sealed/
│   │   ├── SealedView.tsx
│   │   ├── AddSealedModal.tsx
│   │   ├── EditSealedModal.tsx
│   │   └── SealedDetailSlideOver.tsx
│   ├── wishlist/
│   │   ├── WishlistView.tsx
│   │   └── AddWishlistModal.tsx
│   ├── calendar/
│   │   ├── CalendarView.tsx
│   │   ├── ObjectivesBoard.tsx
│   │   ├── AddEventModal.tsx
│   │   └── calendarConstants.ts
│   ├── reports/ReportsView.tsx
│   └── shared/Providers.tsx            ← QueryClientProvider + ToastProvider
├── hooks/
│   ├── useCards.ts
│   ├── useSales.ts
│   ├── useSealed.ts
│   ├── useLots.ts
│   ├── useBuyers.ts
│   ├── useWishlist.ts
│   ├── useEbayListings.ts              ← useEbayListings, useReviseListing, useEndListing, useBulkEbayList
│   ├── useDashboard.ts                 ← useDashboardCharts, useDashboardInsights
│   ├── usePermissions.ts               ← Client mirror of permissions.ts
│   ├── useSettings.ts
│   ├── useReports.ts
│   ├── useCalendarEvents.ts
│   ├── useObjectives.ts
│   ├── useNotifications.ts
│   ├── useBulkWizard.ts
│   └── usePermissions.ts
├── lib/
│   ├── permissions.ts                  ← Feature + Action registry (client-safe)
│   ├── permissions.server.ts           ← assertFeature, assertRole, assertUserLimit (server-only)
│   ├── api.ts                          ← requireAuth(), ok(), badRequest(), serverError()
│   ├── plans.ts                        ← PLAN_NAMES, PLAN_PRICES (client-safe)
│   ├── ebay.ts                         ← eBay API client (credentials, Trading API, Browse API)
│   ├── ebay-client.ts
│   ├── pokemon-sets.ts                 ← Set code → full name mapping (100+ sets)
│   ├── stripe.ts                       ← Stripe client + plan config (server-only)
│   ├── supabase/
│   │   ├── client.ts                   ← Browser Supabase client
│   │   └── server.ts                   ← createClient() [RLS] + createAdminClient() [service role]
│   ├── auth.ts                         ← getServerSession(), auth profile via Redis
│   ├── cache.ts                        ← withCache() — Redis + Postgres two-tier cache
│   ├── rate-limit.ts                   ← Sliding window rate limiter
│   ├── audit.ts                        ← writeAuditLog()
│   ├── storage.ts                      ← R2 upload/delete helpers
│   ├── image.ts                        ← resizeImageToBase64()
│   ├── fees.ts                         ← Platform fee calculation helpers
│   ├── utils.ts                        ← formatGBP, formatNumber, cn(), median()
│   └── env.ts                          ← Typed env vars
├── types/
│   ├── index.ts                        ← All shared TypeScript types
│   └── validation.ts                   ← Zod schemas for API inputs
└── middleware.ts                       ← Auth guard (protects /app routes)
```

---

## 5. Database Schema (Key Tables)

```
users             — id, email, org_id, role (owner|member), created_at
organisations     — id, name, plan (free|basic|growth|pro), stripe_customer_id
cards             — id, org_id, card_name, set_code, card_number, condition,
                    status (In Stock|Listed|Sold), purchase_price, listed_price,
                    ebay_avg_sold, ebay_listing_id, is_graded, grader, grade,
                    qty, language, deleted_at, created_at
card_photos       — id, card_id, url, position, created_at
sales             — id, org_id, card_id, sold_price, platform, platform_fees,
                    shipping_cost, buyer_id, sold_at, status (Sold|Shipped|Delivered)
buyers            — id, org_id, name, email, platform, notes
lots              — id, org_id, name, purchase_price, description
lot_cards         — lot_id, card_id
sealed            — id, org_id, name, type, purchase_price, status, qty
ebay_credentials  — org_id, app_id_enc, secret_enc, ru_name_enc,
                    access_token_enc, refresh_token_enc, token_expires_at
price_cache       — query_hash, card_name, set_code, median_price, prices[],
                    price_count, fetched_at, expires_at
wishlist          — id, org_id, card_name, set_code, target_price, notes
events            — id, org_id, title, date, type, notes
objectives        — id, org_id, title, target_value, current_value, period
notifications     — id, org_id, user_id, type, message, read, created_at
audit_log         — id, org_id, user_id, action, entity_type, entity_id, meta
org_dashboard_stats ← Postgres view (aggregated per org)
```

---

## 6. Plans & Pricing

| Plan | Price | Card Limit | Features |
|------|-------|-----------|---------|
| Free | £0/mo | 50 cards | Core stock + sales tracking |
| Basic | £15/mo | 500 cards | + eBay bulk list, Bulk Wizard, Reports, CSV export, Wishlist alerts |
| Growth | £35/mo | 2,000 cards | + Team management, Buyers CRM, Purchase lots |
| Pro | £85/mo | Unlimited | Everything in Growth |

---

## 7. Permissions Model (Two-Axis)

### Axis 1: Plan Features
Defined in `src/lib/permissions.ts`. Enforced server-side via `requireAuth({ feature })`.

```
Feature              Minimum plan
─────────────────────────────────
ebay.bulk_list       basic
bulk_wizard          basic
reports              basic
csv_export           basic
wishlist_alerts      basic
team_management      growth
buyers_crm           growth
purchase_lots        growth
```

### Axis 2: Role Actions
All sensitive actions are **owner-only**. Members have operational access (create/view cards, record sales) but cannot touch financial records, settings, billing, or team management.

```
Action               Who
──────────────────────────────────
cards.delete         owner
sales.delete         owner
settings.view        owner
settings.edit        owner
billing.view         owner
billing.manage       owner
team.invite          owner
team.manage          owner
export.csv           owner
```

### How It's Enforced
- **Server**: `requireAuth({ feature, action })` in every API route — throws 403 if check fails
- **Client**: `usePermissions()` hook → `can(action)` and `has(feature)` helpers
- **UI**: `<FeatureGate feature="...">` wraps anything that should be hidden/locked

---

## 8. eBay Integration Architecture

### Two APIs in use:

**Browse API** (no user OAuth needed)
- Used for: price lookups (`fetchSoldPrices`)
- Auth: Client credentials app token (auto-refreshed)
- Endpoint: `GET /buy/browse/v1/item_summary/search`
- Applied to: manual price refresh, cron job, bulk wizard

**Trading API** (requires user OAuth token)
- Used for: listing cards, revising prices, ending listings, fetching active listings (`GetMyeBaySelling`, `AddFixedPriceItem`, `ReviseFixedPriceItem`, `EndFixedPriceItem`)
- Auth: User access token (stored encrypted in `ebay_credentials`, auto-refreshed via refresh token)
- eBay credentials stored AES-256-GCM encrypted at rest

### Price Lookup — Grading-Aware Logic

**Raw cards**: Full exclusion keyword list applied (removes PSA/BGS/CGC/ACE slabs + bundles).

**Graded cards** (`is_graded=true`): 
- Grader + grade appended to search query (e.g. `"Jessie & James HIF ACE 10"`)
- Only bundle/lot keywords excluded — graded listing titles are allowed through
- Correct slab prices returned instead of raw card prices

### Cron Job
```json
{ "path": "/api/cron/ebay-prices", "schedule": "0 4 * * *" }
```
- Runs 4am UTC daily
- Pages through all In Stock + Listed cards in batches of 200
- Passes `is_graded`, `grader`, `grade` to `fetchSoldPrices`
- Secured by `CRON_SECRET` header
- ⚠️ Requires `CRON_SECRET` env var in Vercel project settings

---

## 9. Key Architectural Decisions

**Auth profile caching**: `requireAuth()` reads the user's profile (org_id, role, plan) from Redis on every request. This avoids a DB round-trip per API call. Cache is invalidated on plan/role changes.

**Two Supabase clients**:
- `createClient()` — uses the user's session cookie → RLS policies apply
- `createAdminClient()` — service role key, bypasses RLS → used for cross-org operations (cron, webhooks, admin routes)

**TanStack Query stale times**:
- Cards: invalidated on every mutation (immediate)
- eBay listings: 60s stale time
- Dashboard stats: 60s Redis TTL (invalidated on card/sale mutations)
- eBay prices: 24h cache (Redis + Postgres `price_cache` table)

**IQR-based outlier removal**: `fetchSoldPrices` uses interquartile range filtering to remove anomalous prices before computing the median. Fires when ≥4 results. Fence = 1.5× IQR (tighter than classic 3× because eBay active BIN listings skew high).

---

## 10. Completed Sprints & Bug Fixes

### Permission Model (Pre-session)
- `src/lib/permissions.ts` — Feature + Action registry
- `src/lib/permissions.server.ts` — Server-side guards with Next.js response throwing
- `src/lib/api.ts` extended — `requireAuth({ feature, action })` with Redis profile cache
- `usePermissions.ts` hook — client mirror
- `<FeatureGate>` component
- Team invite user-limit enforcement
- Members redirected away from `/settings`

### Bug Sprint (15 bugs fixed)

| # | Bug | Fix location |
|---|-----|-------------|
| 1 | Stat cards not clickable | `dashboard/page.tsx` — StatCard as `<Link>` |
| 2 | No "sort by eBay avg" | `StockView.tsx` + `validation.ts` |
| 3 | Column headers not sortable | `StockTable.tsx` — SortTh component |
| 4 | eBay prices never auto-refresh | `vercel.json` + `cron/ebay-prices/route.ts` |
| 5 | eBay listings tab broken (silent error) | `ebay/listings/route.ts` — 422 not-connected code; `EbayListingsView.tsx` — 3 distinct states |
| 6 | No shift-click multi-select | `StockView.tsx` lastSelectedId ref; `StockTable.tsx` passes e.shiftKey |
| 7 | No eBay price refresh after editing in Bulk Wizard | `CardScanRow.tsx` — refresh button + handleRefreshPrice() |
| 8 | Too few eBay price samples | `ebay.ts` — limit 50→200 |
| 9 | Graded card prices polluting raw averages | `ebay.ts` — expanded PRICE_EXCLUDE_KEYWORDS |
| 10 | Set code shows abbreviation not full name | `CardScanRow.tsx` + `lib/pokemon-sets.ts` (100+ mappings) |
| 11 | Toast X button unreachable | `Toast.tsx` — viewport bottom→top-right |
| 12 | eBay fees not calculated | `RecordSaleModal.tsx` — 12.8% + £0.30 |
| 13 | Dashboard layout cramped | `dashboard/page.tsx` — 4-col grid, compact cards |
| 14 | "Most Popular" badge wraps | `billing/page.tsx` — whitespace-nowrap |
| 15 | No bulk card backs workflow | `BulkWizardView.tsx` — batch backs drop zone |

### Post-Sprint Fixes
- **Price Opportunities widget**: Clicking a card now deep-links to `/stock?search=<card_name>`. `StockView` reads `?search=` on mount and seeds the search box.
- **Graded card display**: Stock table now shows a purple "ACE 10" / "PSA 9" grade badge in the Status column when `is_graded=true`.
- **Graded card eBay pricing**: `fetchSoldPrices` is now grading-aware — searches include grader+grade in query and skip the graded-slab exclusion filter.

---

## 11. Environment Variables Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Cloudflare R2
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_PUBLIC_URL=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_BASIC=
STRIPE_PRICE_GROWTH=
STRIPE_PRICE_PRO=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# eBay
EBAY_ENV=sandbox|production
EBAY_ENCRYPTION_KEY=             # 32-byte hex — AES-256-GCM for credential encryption
NEXT_PUBLIC_EBAY_ENV=sandbox|production

# Pokémon TCG API
POKEMON_TCG_API_KEY=

# Cron security
CRON_SECRET=                     # Must also be set in Vercel project settings

# App
NEXT_PUBLIC_APP_URL=
```

---

## 12. API Route Conventions

All API routes use helpers from `src/lib/api.ts`:

```typescript
requireAuth()                    // Gets session, org_id, role, plan from Redis cache
requireAuth({ feature: '...' })  // + asserts plan feature (throws 403 if missing)
requireAuth({ action: '...' })   // + asserts role action (throws 403 if not permitted)

ok(data)                         // 200 JSON
created(data)                    // 201 JSON
badRequest('message')            // 400 JSON
forbidden('message')             // 403 JSON
serverError(err)                 // 500 JSON + console.error

rateLimit(request, key, opts)    // Sliding window rate limiter
tooManyRequests(retryAfter)      // 429 JSON
```

Error handling pattern in every route:
```typescript
try {
  // ...
} catch (err) {
  if (err instanceof ZodError)   return validationError(err)
  if (err instanceof Response)   return err      // Re-throw requireAuth rejections
  return serverError(err)
}
```

---

## 13. Current Roadmap / Known Next Steps

### High Priority
- [ ] **eBay price — force refresh for specific card from stock table** (trigger `/api/ebay/price` with grading params from the card detail slide-over or bulk refresh)
- [ ] **Bulk Wizard grading support** — `CardScanRow` should detect graded cards and include grading params when calling the price API
- [ ] **Settings → eBay tab deep-link** — `EbayListingsView` "Connect eBay" CTA links to `/settings?tab=ebay`; ensure the settings page reads this param and auto-opens the eBay section

### Medium Priority
- [ ] **Audit log viewer** — expose `audit_log` table in settings (owner-only)
- [ ] **CSV export** — currently route exists, UI trigger not built
- [ ] **Label printing** — `/print/labels` page needs design pass
- [ ] **Notification centre** — bell icon exists, notification types need expanding
- [ ] **Wishlist price alert emails** — `/api/wishlist/price-check` runs manually; could be cron-driven

### Low Priority / Ideas
- [ ] **Mobile-responsive table** — StockTable is desktop-first; card layout on small screens
- [ ] **Dark/light theme toggle** — app is dark-only currently
- [ ] **Multi-currency** — currently GBP-only (site_id=3 eBay UK)
- [ ] **eBay sandbox → production switch** — requires user to flip `EBAY_ENV=production` in Vercel

---

## 14. Important Code Patterns

### Supabase RLS pattern
```typescript
// Always use createClient() for user-scoped reads (RLS enforced)
const supabase = await createClient()
const { data } = await supabase.from('cards').select('*')

// Use createAdminClient() only when you need to bypass RLS (cron, webhooks, admin)
const db = createAdminClient()
```

### eBay not-connected detection
The eBay listings route returns `{ error: 'ebay_not_connected' }` with HTTP 422 when credentials or OAuth token are missing. `EbayListingsView` checks `error?.message === 'ebay_not_connected'` to show the CTA vs a generic error.

### Graded card eBay pricing
```typescript
// Always pass grading params when known
fetchSoldPrices(orgId, cardName, setCode, condition, cardNumber,
  card.is_graded, card.grader, card.grade)
```

### Cache invalidation
```typescript
await invalidateCache(`dashboard:${orgId}`)    // After any card/sale mutation
await invalidateCache(`auth:${userId}`)        // After role/plan changes
```

### Shift-click selection (StockTable)
`lastSelectedId` ref in `StockView` tracks the last clicked row. On `shiftKey=true`, a range from last→current is added to `selectedIds`. Passed via `onToggleSelect(id, shiftKey)`.

---

## 15. Claudian Setup — Getting the Most Out of It

### Recommended Obsidian Vault Structure

```
CardVault Pro/
├── 00 - Context/
│   ├── CARDVAULT_CONTEXT.md         ← This file — pin as system context
│   ├── Architecture Decisions.md    ← ADRs as you make them
│   └── Env Variables.md             ← (never commit actual values)
├── 01 - Active Work/
│   ├── Current Sprint.md            ← What you're working on right now
│   └── Bug Log.md                   ← New issues as they appear
├── 02 - Features/
│   ├── eBay Integration.md
│   ├── Permissions Model.md
│   ├── Bulk Wizard.md
│   └── Dashboard.md
├── 03 - Completed/
│   ├── Sprint 1 - Permissions.md
│   └── Sprint 2 - Bug Fixes.md
└── 04 - Reference/
    ├── Supabase Schema.md
    ├── API Routes.md
    └── Tailwind Patterns.md
```

### Claudian Prompt Starters (copy-paste these)

**Starting a session:**
```
@CARDVAULT_CONTEXT

I'm working on CardVault Pro. [Describe what you're doing].

Constraints:
- Next.js 14 App Router (server components where possible)
- Supabase RLS — always use createClient() for user data, createAdminClient() only for admin ops
- All API routes must call requireAuth() first
- TypeScript strict — no any, no as unknown
- Tailwind only — no inline styles
- Think like a senior full-stack engineer
```

**Bug investigation:**
```
@CARDVAULT_CONTEXT

Bug: [describe what's wrong]
File(s) affected: [path]
Expected: [what should happen]
Actual: [what is happening]

Do root cause analysis before suggesting a fix.
```

**New feature:**
```
@CARDVAULT_CONTEXT

Feature request: [describe it]

Before writing code:
1. Identify which files need changing
2. Check if it needs a permission gate (feature or action)
3. Check if caching or rate limiting applies
4. Propose the approach, then implement
```

**Code review:**
```
@CARDVAULT_CONTEXT

Review this code for: correctness, security (auth/RLS), performance (N+1s, missing cache), and TypeScript quality.

[paste code]
```

### Key Context to Always Include in Prompts

1. The file path of what you're editing
2. Whether it's a server or client component
3. Which plan/role guard applies (if any)
4. What TanStack Query key is used (so invalidation is correct)

### Git Push Commands (PowerShell-safe)

```powershell
git add -A
git commit -m "feat: description"
git push origin main
```

If paths have parentheses (like `(app)`), wrap in double quotes:
```powershell
git add "src/app/(app)/stock/page.tsx"
```

---

## 16. Deployed URLs

- **Production**: (set your Vercel deployment URL here)
- **Supabase project**: (set your Supabase project URL here)
- **eBay Developer Portal**: https://developer.ebay.com/my/keys

---

*Last updated: July 2026. Updated after: eBay graded card pricing fix, grade badge in StockTable, Price Opportunities deep-link, eBay listings not-connected state fix.*
