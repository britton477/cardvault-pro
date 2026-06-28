// =============================================================================
// CardVault Pro — Zod Validation Schemas
// =============================================================================
import { z } from 'zod'

// ── Shared primitives ─────────────────────────────────────────────────────────

const uuid    = z.string().uuid()
const price   = z.number().min(0).max(999999)
const nonEmpty = z.string().min(1)

// ── Card schemas ──────────────────────────────────────────────────────────────

export const CardConditionSchema = z.enum(['NM', 'LP', 'MP', 'HP', 'Sealed'])
export const CardStatusSchema    = z.enum(['In Stock', 'Listed', 'Sold'])

export const CreateCardSchema = z.object({
  card_name:      nonEmpty.max(200),
  set_code:       z.string().max(50).default(''),
  card_number:    z.string().max(50).default(''),
  condition:      CardConditionSchema.default('NM'),
  foil_type:      z.string().max(50).default('Normal'),
  language:       z.string().max(10).default('EN'),
  is_graded:      z.boolean().default(false),
  grader:         z.string().max(50).nullish(),
  grade:          z.string().max(20).nullish(),
  qty:            z.number().int().min(1).max(9999).default(1),
  purchase_price: price,
  purchase_date:  z.string().date().nullish(),
  source:         z.string().max(200).default(''),
  notes:          z.string().max(2000).default(''),
  lot_id:         uuid.nullish(),
})

export const UpdateCardSchema = CreateCardSchema.partial().extend({
  status:           CardStatusSchema.optional(),
  listed_price:     price.nullish(),
  listed_on:        z.string().max(50).nullish(),
  ebay_listing_id:  z.string().max(50).nullish(),
  ebay_avg_sold:    price.nullish(),
  price_source:     z.string().max(20).nullish(),
  lot_id:           uuid.nullish(),
})

export const ListCardsSchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(200).default(100),
  search:    z.string().max(200).optional(),
  status:    CardStatusSchema.optional(),
  set_code:  z.string().max(50).optional(),
  condition: CardConditionSchema.optional(),
  sort:      z.enum(['card_name', 'card_number', 'created_at', 'purchase_price', 'listed_price', 'updated_at']).default('created_at'),
  order:     z.enum(['asc', 'desc']).default('desc'),
})

// ── Sale schemas ──────────────────────────────────────────────────────────────

export const SalePlatformSchema = z.enum(['eBay', 'Face to Face', 'Facebook', 'Other'])
export const SaleStatusSchema   = z.enum(['Sold', 'Shipped', 'Fulfilled'])

export const CreateSaleSchema = z.object({
  card_id:         uuid.optional(),
  card_name:       nonEmpty.max(200),
  set_code:        z.string().max(50).default(''),
  card_number:     z.string().max(50).default(''),
  condition:       z.string().max(20).default(''),
  platform:        SalePlatformSchema.default('eBay'),
  qty_sold:        z.number().int().min(1).max(9999).default(1),
  sold_price:      price.min(0.01),
  fees:            price.default(0),
  shipping:        price.default(0),
  purchase_price:  price.default(0),
  sale_date:       z.string().date().optional(),
  sale_status:     SaleStatusSchema.default('Sold'),
  tracking_number: z.string().max(100).nullish(),
  buyer_name:      z.string().max(200).optional(),
  buyer_id:        uuid.optional(),
})

export const UpdateSaleSchema = CreateSaleSchema.partial()

// ── Sealed product schemas ────────────────────────────────────────────────────

export const ProductTypeSchema = z.enum([
  'Booster Box', 'Elite Trainer Box', 'Booster Pack', 'Tin', 'Collection', 'Other',
])

export const CreateSealedProductSchema = z.object({
  product_name:  nonEmpty.max(200),
  set_code:      z.string().max(50).default(''),
  product_type:  ProductTypeSchema.default('Booster Box'),
  qty_bought:    z.number().int().min(1).max(9999),
  cost_per_unit: price,
  source:        z.string().max(200).default(''),
  notes:         z.string().max(2000).default(''),
})

export const UpdateSealedProductSchema = CreateSealedProductSchema.partial().extend({
  // Allow direct adjustment of qty_opened (e.g. undo an open, or inline +/- buttons)
  qty_opened: z.number().int().min(0).max(9999).optional(),
})

export const OpenProductSchema = z.object({
  qty: z.number().int().min(1).max(9999),
})

// ── Wishlist schemas ──────────────────────────────────────────────────────────

export const WishlistPrioritySchema = z.enum(['low', 'normal', 'high'])
export const WishlistStatusSchema   = z.enum(['wanted', 'found', 'purchased'])

export const CreateWishlistSchema = z.object({
  card_name:    nonEmpty.max(200),
  set_name:     z.string().max(200).default(''),
  variant:      z.string().max(100).default(''),
  target_price: price.nullable().optional(),
  priority:     WishlistPrioritySchema.default('normal'),
  notes:        z.string().max(2000).default(''),
})

export const UpdateWishlistSchema = z.object({
  card_name:    z.string().min(1).max(200).optional(),
  set_name:     z.string().max(200).optional(),
  variant:      z.string().max(100).optional(),
  target_price: price.nullable().optional(),
  priority:     WishlistPrioritySchema.optional(),
  status:       WishlistStatusSchema.optional(),
  notes:        z.string().max(2000).optional(),
})

// ── Calendar schemas ──────────────────────────────────────────────────────────

export const CalendarEventTypeSchema  = z.enum(['show', 'reminder', 'restock', 'follow_up', 'social_post', 'collection_buy', 'other'])
export const CalendarEventColorSchema = z.enum(['blue', 'green', 'amber', 'red', 'purple', 'gray'])

export const CreateEventSchema = z.object({
  title:       nonEmpty.max(200),
  description: z.string().max(2000).default(''),
  event_type:  CalendarEventTypeSchema.default('reminder'),
  event_date:  z.string().date(),
  end_date:    z.string().date().nullable().optional(),
  all_day:     z.boolean().default(true),
  start_time:  z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time:    z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  location:    z.string().max(200).default(''),
  color:       CalendarEventColorSchema.default('blue'),
})

export const UpdateEventSchema = CreateEventSchema.partial()

export const ListEventsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM').optional(),
  type:  CalendarEventTypeSchema.optional(),
})

// ── eBay schemas ──────────────────────────────────────────────────────────────

export const EbayListingInputSchema = z.object({
  card_id:    uuid,
  list_price: price.min(0.01),
})

export const EbayBulkListSchema = z.object({
  listings: z.array(EbayListingInputSchema).min(1).max(50),
})

export const EbayPriceQuerySchema = z.object({
  card_name:   nonEmpty.max(200),
  set_code:    z.string().max(50).optional(),
  card_number: z.string().max(50).optional(),
  condition:   z.enum(['NM', 'LP', 'MP', 'HP', 'Sealed']).optional(),
})

// ── Bulk card action schemas ──────────────────────────────────────────────────

const bulkIds = z.array(uuid).min(1).max(200)

export const BulkStatusSchema = z.object({
  action: z.literal('status'),
  ids:    bulkIds,
  status: CardStatusSchema,
})

export const BulkPriceSchema = z.object({
  action: z.literal('price'),
  ids:    bulkIds,
  mode:   z.enum(['fixed', 'markup']),
  value:  z.number().min(0).max(999999),  // £ for fixed; % for markup (0–500)
})

export const BulkDeleteSchema = z.object({
  action: z.literal('delete'),
  ids:    bulkIds,
})

export const BulkAssignLotSchema = z.object({
  action: z.literal('assign_lot'),
  ids:    bulkIds,
  lot_id: z.string().uuid(),
})

export const BulkCardActionSchema = z.discriminatedUnion('action', [
  BulkStatusSchema,
  BulkPriceSchema,
  BulkDeleteSchema,
  BulkAssignLotSchema,
])

export type BulkCardAction = z.infer<typeof BulkCardActionSchema>

// ── Objectives schemas ────────────────────────────────────────────────────────

export const CreateObjectiveSchema = z.object({
  title:       nonEmpty.max(500),
  is_personal: z.boolean().default(false),
})

export const UpdateObjectiveSchema = z.object({
  title:       z.string().min(1).max(500).optional(),
  is_personal: z.boolean().optional(),
  is_complete: z.boolean().optional(),
})

export const ListObjectivesSchema = z.object({
  scope: z.enum(['org', 'personal']).default('org'),
})

// ── Purchase Lot schemas ──────────────────────────────────────────────────────

export const CreateLotSchema = z.object({
  name:         nonEmpty.max(200),
  source:       z.string().max(200).default(''),
  total_cost:   price,
  purchased_at: z.string().date(),
  notes:        z.string().max(2000).default(''),
})

export const UpdateLotSchema = CreateLotSchema.partial()

export type CreateLotInput = z.infer<typeof CreateLotSchema>
export type UpdateLotInput = z.infer<typeof UpdateLotSchema>

// ── Buyer schemas ─────────────────────────────────────────────────────────────

export const CreateBuyerSchema = z.object({
  name:  nonEmpty.max(200),
  email: z.string().email().or(z.literal('')).default(''),
  phone: z.string().max(50).default(''),
  notes: z.string().max(2000).default(''),
})

export const UpdateBuyerSchema = CreateBuyerSchema.partial()

export type CreateBuyerInput = z.infer<typeof CreateBuyerSchema>
export type UpdateBuyerInput = z.infer<typeof UpdateBuyerSchema>

// ── Reports & Export schemas ──────────────────────────────────────────────────

const isoDate = z.string().date()

export const ReportQuerySchema = z.object({
  from: isoDate,
  to:   isoDate,
}).refine(d => d.from <= d.to, { message: 'from must be ≤ to' })

export const ExportQuerySchema = z.object({
  type: z.enum(['sales', 'cards', 'sealed']),
  from: isoDate.optional(),
  to:   isoDate.optional(),
})

// ── eBay bulk listing from BulkActionBar ─────────────────────────────────────
// Takes IDs only — prices are pulled from cards.listed_price in the DB.
// Cards without a listed_price are returned in the `skipped` bucket.

export const BulkEbayListSchema = z.object({
  card_ids: z.array(uuid).min(1).max(50),
})

export type BulkEbayListInput = z.infer<typeof BulkEbayListSchema>

// ── Image upload ──────────────────────────────────────────────────────────────

export const UploadImageSchema = z.object({
  card_id:  uuid,
  position: z.number().int().min(0).max(9).optional(),
})

// ── Settings ──────────────────────────────────────────────────────────────────

export const OrgSettingsSchema = z.object({
  markup_pct:                   z.number().min(0).max(500),
  shop_name:                    z.string().max(200),
  item_location:                z.string().max(100),
  ebay_username:                z.string().max(100),
  ebay_fulfillment_policy_id:      z.string().max(50).nullish(),
  ebay_fulfillment_policy_id_high: z.string().max(50).nullish(),
  ebay_payment_policy_id:          z.string().max(50).nullish(),
  ebay_return_policy_id:           z.string().max(50).nullish(),
})

export const EbayCredentialsSchema = z.object({
  app_id:  nonEmpty.max(200),
  secret:  nonEmpty.max(200),
  ru_name: nonEmpty.max(200),
})

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateCardInput   = z.infer<typeof CreateCardSchema>
export type UpdateCardInput   = z.infer<typeof UpdateCardSchema>
export type ListCardsQuery    = z.infer<typeof ListCardsSchema>
export type CreateSaleInput          = z.infer<typeof CreateSaleSchema>
export type UpdateSaleInput          = z.infer<typeof UpdateSaleSchema>
export type CreateSealedProductInput = z.infer<typeof CreateSealedProductSchema>
export type UpdateSealedProductInput = z.infer<typeof UpdateSealedProductSchema>
export type OpenProductInput         = z.infer<typeof OpenProductSchema>
export type EbayBulkListInput        = z.infer<typeof EbayBulkListSchema>
export type OrgSettingsInput         = z.infer<typeof OrgSettingsSchema>
export type EbayCredentialsInput     = z.infer<typeof EbayCredentialsSchema>
