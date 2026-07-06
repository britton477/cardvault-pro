// =============================================================================
// CardVault Pro — Shared TypeScript Types
// =============================================================================

// ── Enums (mirror DB enums) ──────────────────────────────────────────────────

export type OrgPlan            = 'free' | 'basic' | 'growth' | 'pro' | 'business'
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled'
export type UserRole      = 'owner' | 'member'
export type CardStatus    = 'In Stock' | 'Listed' | 'Sold'
export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'Sealed'
export type SaleStatus    = 'Sold' | 'Shipped' | 'Fulfilled'
export type SalePlatform  = 'eBay' | 'Face to Face' | 'Facebook' | 'Other'
export type ProductType   = 'Booster Box' | 'Elite Trainer Box' | 'Booster Pack' | 'Tin' | 'Collection' | 'Other'

// ── Core entities ─────────────────────────────────────────────────────────────

export interface Organization {
  id:         string
  name:       string
  slug:       string
  plan:       OrgPlan
  card_limit: number
  // Stripe billing (nullable until org has been through checkout)
  stripe_customer_id?:     string | null
  stripe_subscription_id?: string | null
  subscription_status?:    SubscriptionStatus | null
  trial_ends_at?:          string | null
  created_at: string
  updated_at: string
}

export interface User {
  id:         string
  org_id:     string
  name:       string
  avatar:     string
  role:       UserRole
  pin_hash:   string | null
  created_at: string
  updated_at: string
}

export interface OrgSettings {
  org_id:                       string
  markup_pct:                   number
  shop_name:                    string
  item_location:                string
  ebay_username:                string
  ebay_fulfillment_policy_id:      string | null
  ebay_fulfillment_policy_id_high: string | null
  ebay_payment_policy_id:          string | null
  ebay_return_policy_id:           string | null
  updated_at:                      string
}

export interface CardPhoto {
  id:         string
  card_id:    string
  url:        string
  thumb_url:  string | null
  position:   number
  created_at: string
}

export interface Card {
  id:               string
  org_id:           string
  card_name:        string
  set_code:         string
  card_number:      string
  condition:        CardCondition
  foil_type:        string
  language:         string
  is_graded:        boolean
  grader:           string | null
  grade:            string | null
  qty:              number
  status:           CardStatus
  purchase_price:   number
  purchase_date:    string | null
  source:           string
  notes:            string
  listed_price:     number | null
  listed_on:        string | null
  ebay_listing_id:  string | null
  ebay_avg_sold:    number | null
  price_source:     string | null
  added_by:         string | null
  last_edited_by:   string | null
  lot_id:           string | null
  created_at:       string
  updated_at:       string
  deleted_at:       string | null
  // Joined
  photos?:          CardPhoto[]
}

export interface Sale {
  id:             string
  org_id:         string
  card_id:        string | null
  card_name:      string
  set_code:       string
  card_number:    string
  condition:      string
  platform:       SalePlatform
  qty_sold:       number
  sold_price:     number
  fees:           number
  shipping:       number
  purchase_price: number
  profit:         number   // generated column
  sale_date:      string
  sale_status:    SaleStatus
  tracking_number: string | null
  sold_by:        string | null
  buyer_id:       string | null
  buyer_name:     string
  created_at:     string
  updated_at:     string
  deleted_at:     string | null
}

export interface SealedProduct {
  id:             string
  org_id:         string
  product_name:   string
  set_code:       string
  product_type:   ProductType
  qty_bought:     number
  cost_per_unit:  number
  qty_opened:     number
  qty_sold:       number
  qty_remaining:  number   // generated column
  source:         string
  notes:          string
  created_at:     string
  updated_at:     string
  deleted_at:     string | null
}

export interface PriceCache {
  query_hash:   string
  card_name:    string
  set_code:     string
  median_price: number | null
  price_count:  number | null
  prices:       number[]
  days_used:    number | null
  fetched_at:   string
  expires_at:   string
}

export type CalendarEventType  = 'show' | 'reminder' | 'restock' | 'follow_up' | 'social_post' | 'collection_buy' | 'other'
export type CalendarEventColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray'

export interface CalendarEvent {
  id:          string
  org_id:      string
  title:       string
  description: string
  event_type:  CalendarEventType
  event_date:  string              // YYYY-MM-DD start date
  end_date:    string | null       // YYYY-MM-DD end date (inclusive, for multi-day)
  all_day:     boolean
  start_time:  string | null       // HH:MM (only when all_day = false)
  end_time:    string | null       // HH:MM (only when all_day = false)
  location:    string
  color:       CalendarEventColor
  created_by:  string | null
  created_at:  string
  updated_at:  string
  deleted_at:  string | null
}

export interface CreateEventInput {
  title:       string
  description?: string
  event_type:  CalendarEventType
  event_date:  string
  end_date?:   string | null
  all_day?:    boolean
  start_time?: string | null
  end_time?:   string | null
  location?:   string
  color?:      CalendarEventColor
}

export interface UpdateEventInput extends Partial<CreateEventInput> {}

export type WishlistPriority = 'low' | 'normal' | 'high'
export type WishlistStatus  = 'wanted' | 'found' | 'purchased'

export interface WishlistItem {
  id:               string
  org_id:           string
  card_name:        string
  set_name:         string
  variant:          string
  target_price:     number | null
  priority:         WishlistPriority
  status:           WishlistStatus
  notes:            string
  added_by:         string | null
  // eBay price alert fields (added Sprint 12)
  last_ebay_price:  number | null
  price_checked_at: string | null
  created_at:       string
  updated_at:       string
  deleted_at:       string | null
}

export interface CreateWishlistInput {
  card_name:    string
  set_name?:    string
  variant?:     string
  target_price?: number | null
  priority?:    WishlistPriority
  notes?:       string
}

export interface UpdateWishlistInput {
  card_name?:    string
  set_name?:     string
  variant?:      string
  target_price?: number | null
  priority?:     WishlistPriority
  status?:       WishlistStatus
  notes?:        string
}

export interface ListWishlistQuery {
  page?:     number
  limit?:    number
  status?:   WishlistStatus | 'all'
  priority?: WishlistPriority | 'all'
  search?:   string
}

export type ObjectiveScope = 'org' | 'personal'

export interface Objective {
  id:           string
  org_id:       string
  created_by:   string
  title:        string
  is_personal:  boolean
  is_complete:  boolean
  completed_at: string | null
  completed_by: string | null
  position:     number
  created_at:   string
  updated_at:   string
  deleted_at:   string | null
}

export interface DashboardStats {
  org_id:            string
  active_card_count: number
  listed_count:      number
  inventory_cost:    number
  listed_value:      number
  to_ship:           number   // Sold — awaiting dispatch
  to_deliver:        number   // Shipped — awaiting delivery
  fulfilled_count:   number   // Completed orders
  pending_sales:     number   // to_ship + to_deliver (backwards compat)
  total_profit:      number
  total_revenue:     number
}

// ── eBay active listing (synced from GetMyeBaySelling) ───────────────────────

export interface EbayActiveListing {
  listingId:  string
  title:      string
  price:      number
  quantity:   number
  watchCount: number
  viewCount:  number
  startTime:  string
  endTime:    string
  listingUrl: string
  // Joined from cards table
  card_id?:       string | null
  card_name?:     string | null
  set_code?:      string | null
  condition?:     string | null
  purchase_price?: number | null
}

// ── API request / response types ─────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data:  T[]
  count: number
  page:  number
  limit: number
}

export interface ApiError {
  error:   string
  code?:   string
  status:  number
}

// ── Bulk Wizard ───────────────────────────────────────────────────────────────

/** Status of a single card in the Bulk Wizard scan pipeline */
export type BulkCardStatus = 'queued' | 'identifying' | 'pricing' | 'ready' | 'error'

/** The three UI phases of the Bulk Wizard */
export type BulkWizardPhase = 'scan' | 'cost' | 'import'

/**
 * One card in the Bulk Wizard session.
 * Client-only — never persisted as-is; imported cards go through /api/bulk-wizard/import.
 */
export interface BulkWizardCard {
  /** Stable client-only ID (crypto.randomUUID) */
  uid:           string
  /** Resized base64 JPEG (primary scan), held in memory only — NEVER sent to Supabase */
  imageDataUrl:  string
  /** Additional card photos (card back, edge close-ups, damage shots) — memory only */
  additionalImages: string[]

  // Pipeline state
  status: BulkCardStatus
  error?: string

  // AI-identified fields (defaults to empty strings until identified)
  card_name:   string
  set_code:    string
  card_number: string
  condition:   CardCondition
  foil_type:   string
  language:    string
  /** 0–1 confidence score from the vision model */
  confidence:  number

  /** User corrections applied on top of AI results */
  overrides: Partial<Pick<BulkWizardCard,
    'card_name' | 'set_code' | 'card_number' | 'condition' | 'foil_type'>>

  // eBay pricing (null until price lookup completes)
  ebay_avg_sold:     number | null
  ebay_sample_count: number

  // Computed from totalSpend (pure client-side, no API)
  proportional_cost: number | null
  profit_potential:  number | null
  roi_pct:           number | null

  /** Desired eBay list price — computed from markup % in Phase 3, overridable per card */
  listed_price: number | null
}

// Bulk Wizard API shapes

export interface BulkIdentifyRequest {
  /** Base64-encoded image (no data:// prefix) */
  image:      string
  /** If set, skip AI set detection and use this value */
  set_code?:  string
  /**
   * When true, use the retro prompt which identifies sets by symbol/design
   * rather than printed text code. For cards from WOTC era through BW (1999–2013).
   */
  retro_mode?: boolean
}

export interface BulkIdentifyResponse {
  card_name:   string
  set_code:    string
  card_number: string
  condition:   CardCondition
  foil_type:   string
  language:    string
  confidence:  number
}

export interface BulkPriceRequest {
  card_name:   string
  set_code?:   string
  card_number?: string
  condition?:  string
}

export interface BulkPriceResponse {
  avg_sold:     number
  median_sold:  number
  sample_count: number
}

export interface BulkImportCard {
  card_name:      string
  set_code:       string
  card_number:    string
  condition:      CardCondition
  foil_type:      string
  language:       string
  purchase_price: number
  ebay_avg_sold:  number | null
  listed_price?:  number | null
  lot_id?:        string | null
  source?:        string
  notes?:         string
}

export interface BulkImportRequest {
  cards:   BulkImportCard[]
  lot_id?: string | null
  source?: string
}

export interface BulkImportResponse {
  created:  number
  card_ids: string[]
}

// Cards
export interface CreateCardInput {
  card_name:      string
  set_code?:      string
  card_number?:   string
  condition?:     CardCondition
  foil_type?:     string
  language?:      string
  is_graded?:     boolean
  grader?:        string
  grade?:         string
  qty?:           number
  purchase_price: number
  purchase_date?: string
  source?:        string
  notes?:         string
  lot_id?:        string
}

export interface UpdateCardInput extends Partial<CreateCardInput> {
  status?:          CardStatus
  listed_price?:    number | null
  listed_on?:       string | null
  ebay_listing_id?: string | null
  ebay_avg_sold?:   number | null
  price_source?:    string | null
}

export interface ListCardsQuery {
  page?:      number
  limit?:     number
  search?:    string
  status?:    CardStatus
  set_code?:  string
  condition?: CardCondition
  sort?:      'card_name' | 'created_at' | 'purchase_price' | 'listed_price' | 'updated_at'
  order?:     'asc' | 'desc'
}

// Sales
export interface CreateSaleInput {
  card_id?:         string
  card_name:        string
  set_code?:        string
  card_number?:     string
  condition?:       string
  platform?:        SalePlatform
  qty_sold?:        number
  sold_price:       number
  fees?:            number
  shipping?:        number
  purchase_price?:  number
  sale_date?:       string
  sale_status?:     SaleStatus
  tracking_number?: string
  buyer_id?:        string
  buyer_name?:      string
}

// Images
export interface UploadImageResponse {
  url:       string
  thumb_url: string
  photo_id:  string
}

// eBay
export interface EbayListingInput {
  card_id:    string
  list_price: number
}

export interface EbayListingResult {
  card_id:    string
  success:    boolean
  listing_id?: string
  error?:     string
}

export interface EbayPriceResult {
  card_name:    string
  set_code:     string
  median_price: number | null
  prices:       number[]
  price_count:  number
  cached:       boolean
}

// ── UI state types ────────────────────────────────────────────────────────────

export interface StockFilters {
  search:    string
  status:    CardStatus | 'all'
  set_code:  string
  condition: CardCondition | 'all'
  sort:      'card_name' | 'card_number' | 'created_at' | 'purchase_price' | 'listed_price' | 'updated_at'
  order:     'asc' | 'desc'
  page:      number
}

export interface SaleFilters {
  search:   string
  platform: SalePlatform | 'all'
  status:   SaleStatus | 'all'
  from:     string
  to:       string
  page:     number
}

// ── Reports & Export types ────────────────────────────────────────────────────

/** P&L totals for a date range */
export interface ReportSummary {
  from:          string
  to:            string
  // Sales P&L
  total_revenue: number
  total_cost:    number
  total_fees:    number
  total_shipping: number
  total_profit:  number
  margin_pct:    number   // (profit / revenue) * 100
  units_sold:    number
  avg_sale_price: number
  avg_profit:    number
  // Breakdowns
  by_platform:   PlatformStat[]
  top_cards:     TopCard[]
  // Inventory (point-in-time)
  inventory:     InventorySnapshot
}

export interface PlatformStat {
  platform:  string
  revenue:   number
  cost:      number
  profit:    number
  fees:      number
  count:     number
  margin_pct: number
}

export interface TopCard {
  card_name:  string
  set_code:   string
  condition:  string
  units_sold: number
  revenue:    number
  cost:       number
  profit:     number
}

export interface InventorySnapshot {
  total_cards:     number
  in_stock:        number
  listed:          number
  sold_period:     number   // units sold in the selected range
  total_cost:      number   // sum of purchase_price for active cards
  listed_value:    number   // sum of listed_price for Listed cards
  potential_profit: number  // listed_value - total_cost (Listed only)
}

// ── Dashboard chart types ─────────────────────────────────────────────────────

/** One data point in the profit-over-time line chart */
export interface ProfitTrendPoint {
  date:    string  // YYYY-MM-DD
  profit:  number
  revenue: number
  count:   number  // number of sales on that day
}

/** Revenue / profit / count broken down per sales platform */
export interface PlatformSplit {
  platform: SalePlatform
  revenue:  number
  profit:   number
  count:    number
}

/** Single entry in the recent-activity feed */
export interface ActivityEntry {
  id:          string
  action:      string
  entity_type: string
  entity_id:   string | null
  created_at:  string
  changes:     Record<string, unknown> | null
  user_name:   string | null
}

/** Full payload returned by GET /api/dashboard/charts */
export interface DashboardChartData {
  profit_trend:   ProfitTrendPoint[]
  platform_split: PlatformSplit[]
  activity:       ActivityEntry[]
  days:           number
}

/** One card in the "sitting longest" list */
export interface SittingLongestItem {
  id:             string
  card_name:      string
  set_code:       string | null
  condition:      string
  purchase_price: number
  days_in_stock:  number
  thumb_url:      string | null
}

/** One card in the "price opportunities" list */
export interface PriceOpportunityItem {
  id:            string
  card_name:     string
  set_code:      string | null
  condition:     string
  listed_price:  number
  ebay_avg_sold: number
  gap:           number
  thumb_url:     string | null
}

/** One row in the "stock value by set" bar chart */
export interface StockBySetItem {
  set_code:    string
  total_value: number
  card_count:  number
}

/** Full payload returned by GET /api/dashboard/insights */
export interface DashboardInsights {
  sitting_longest:     SittingLongestItem[]
  price_opportunities: PriceOpportunityItem[]
  stock_by_set:        StockBySetItem[]
}

// ── Purchase Lots ─────────────────────────────────────────────────────────────

export interface PurchaseLot {
  id:             string
  org_id:         string
  name:           string
  source:         string
  total_cost:     number
  purchased_at:   string   // YYYY-MM-DD
  notes:          string
  created_by:     string | null
  created_at:     string
  updated_at:     string
  deleted_at:     string | null
  // Computed via join (returned by GET /api/lots)
  card_count?:    number
  allocated_cost?: number  // sum of purchase_price for all cards in this lot
}

// ── Buyers ────────────────────────────────────────────────────────────────────

export interface Buyer {
  id:          string
  org_id:      string
  name:        string
  email:       string
  phone:       string
  notes:       string
  created_by:  string | null
  created_at:  string
  updated_at:  string
  deleted_at:  string | null
  // Computed via join (returned by GET /api/buyers list)
  sale_count?:   number
  total_spent?:  number
  last_sale_at?: string | null
}

// ── Notification Centre ───────────────────────────────────────────────────────

export type NotificationType =
  | 'price_drop'      // wishlist item where eBay price ≤ target
  | 'event_today'     // calendar event happening today
  | 'event_tomorrow'  // calendar event happening tomorrow
  | 'stale_listing'   // aggregated count of Listed cards not updated in 30+ days

export type NotificationSeverity = 'info' | 'warning' | 'success'

export interface AppNotification {
  id:       string                 // deterministic e.g. `wishlist-${item.id}`
  type:     NotificationType
  title:    string
  body:     string
  href:     string                 // where to navigate on click
  severity: NotificationSeverity
}

// ── Auth context ──────────────────────────────────────────────────────────────

export interface AuthUser {
  id:     string
  email:  string
  profile: User
  org:     Organization
  settings: OrgSettings
}
