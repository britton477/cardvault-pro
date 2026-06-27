-- =============================================================================
-- CardVault Pro — Production Schema v2.0
-- =============================================================================
-- Run order: extensions → tables → indexes → RLS → functions → triggers
-- =============================================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";       -- trigram search on card names

-- =============================================================================
-- ENUMS
-- =============================================================================

create type org_plan        as enum ('free', 'pro', 'business');
create type user_role       as enum ('owner', 'member');
create type card_status     as enum ('In Stock', 'Listed', 'Sold');
create type card_condition  as enum ('NM', 'LP', 'MP', 'HP', 'Sealed');
create type sale_status     as enum ('Sold', 'Shipped', 'Fulfilled');
create type sale_platform   as enum ('eBay', 'Face to Face', 'Facebook', 'Other');
create type product_type    as enum ('Booster Box', 'Elite Trainer Box', 'Booster Pack', 'Tin', 'Collection', 'Other');

-- =============================================================================
-- ORGANIZATIONS  (multi-tenancy root)
-- =============================================================================

create table organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  plan        org_plan not null default 'free',
  -- Soft limits enforced at API layer
  card_limit  int  not null default 100,   -- free: 100, pro: unlimited
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- =============================================================================
-- USERS  (extends Supabase auth.users)
-- =============================================================================

create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null default '',
  avatar      text not null default '🃏',
  role        user_role not null default 'member',
  pin_hash    text,         -- bcrypt hash of 4-digit PIN, nullable = no PIN
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index users_org_id_idx on users(org_id);

-- =============================================================================
-- ORG SETTINGS
-- =============================================================================

create table org_settings (
  org_id          uuid primary key references organizations(id) on delete cascade,
  markup_pct      numeric(5,2) not null default 40,
  shop_name       text not null default '',
  item_location   text not null default 'United Kingdom',
  ebay_username   text not null default '',
  -- Fulfillment/payment/return policy IDs cached from eBay
  ebay_fulfillment_policy_id  text,
  ebay_payment_policy_id      text,
  ebay_return_policy_id       text,
  updated_at      timestamptz not null default now()
);

-- =============================================================================
-- EBAY CREDENTIALS  (encrypted at rest — never exposed to client)
-- =============================================================================

create table ebay_credentials (
  org_id              uuid primary key references organizations(id) on delete cascade,
  -- AES-256-GCM encrypted values (iv:tag:ciphertext in hex, joined with '.')
  app_id_enc          text,
  secret_enc          text,
  ru_name_enc         text,
  access_token_enc    text,
  refresh_token_enc   text,
  token_expires_at    timestamptz,
  updated_at          timestamptz not null default now()
);

-- =============================================================================
-- CARDS
-- =============================================================================

create table cards (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references organizations(id) on delete cascade,

  -- Core fields
  card_name         text not null,
  set_code          text not null default '',
  card_number       text not null default '',
  condition         card_condition not null default 'NM',
  foil_type         text not null default 'Normal',
  language          text not null default 'EN',

  -- Grading
  is_graded         boolean not null default false,
  grader            text,    -- PSA, BGS, CGC, ACE, Arkezon
  grade             text,    -- 10, 9.5, 9 …

  -- Inventory
  qty               int not null default 1 check (qty >= 0),
  status            card_status not null default 'In Stock',
  purchase_price    numeric(10,2) not null default 0,
  purchase_date     date,
  source            text not null default '',
  notes             text not null default '',

  -- Listing
  listed_price      numeric(10,2),
  listed_on         text,           -- platform label
  ebay_listing_id   text,
  ebay_avg_sold     numeric(10,2),
  price_source      text,           -- 'eBay' | 'est.'

  -- Authorship
  added_by          uuid references users(id) on delete set null,
  last_edited_by    uuid references users(id) on delete set null,

  -- Timestamps
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz   -- soft delete
);

-- Indexes
create index cards_org_id_idx       on cards(org_id) where deleted_at is null;
create index cards_status_idx       on cards(org_id, status) where deleted_at is null;
create index cards_name_trgm_idx    on cards using gin(card_name gin_trgm_ops);
create index cards_set_idx          on cards(org_id, set_code) where deleted_at is null;
create index cards_created_at_idx   on cards(org_id, created_at desc) where deleted_at is null;

-- =============================================================================
-- CARD PHOTOS  (separate table — cards can have many photos)
-- =============================================================================

create table card_photos (
  id          uuid primary key default uuid_generate_v4(),
  card_id     uuid not null references cards(id) on delete cascade,
  url         text not null,         -- Cloudflare R2 / CDN URL
  thumb_url   text,                  -- resized thumbnail URL
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

create index card_photos_card_id_idx on card_photos(card_id);

-- =============================================================================
-- SALES
-- =============================================================================

create table sales (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  card_id         uuid references cards(id) on delete set null,  -- nullable (card may be deleted)

  -- Denormalized card info (snapshot at time of sale — preserved even if card deleted)
  card_name       text not null,
  set_code        text not null default '',
  card_number     text not null default '',
  condition       text not null default '',

  -- Sale details
  platform        sale_platform not null default 'eBay',
  qty_sold        int not null default 1,
  sold_price      numeric(10,2) not null,
  fees            numeric(10,2) not null default 0,
  shipping        numeric(10,2) not null default 0,
  purchase_price  numeric(10,2) not null default 0,   -- cost basis at time of sale
  profit          numeric(10,2) generated always as (sold_price - fees - shipping - purchase_price) stored,

  sale_date       date not null default current_date,
  sale_status     sale_status not null default 'Sold',
  tracking_number text,

  -- Authorship
  sold_by         uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index sales_org_id_idx     on sales(org_id) where deleted_at is null;
create index sales_date_idx       on sales(org_id, sale_date desc) where deleted_at is null;
create index sales_status_idx     on sales(org_id, sale_status) where deleted_at is null;
create index sales_card_id_idx    on sales(card_id) where deleted_at is null;

-- =============================================================================
-- SEALED PRODUCTS
-- =============================================================================

create table sealed_products (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,

  product_name    text not null,
  set_code        text not null default '',
  product_type    product_type not null default 'Booster Box',
  qty_bought      int not null default 1,
  cost_per_unit   numeric(10,2) not null default 0,
  qty_opened      int not null default 0,
  qty_sold        int not null default 0,
  qty_remaining   int generated always as (qty_bought - qty_opened - qty_sold) stored,
  source          text not null default '',
  notes           text not null default '',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index sealed_org_id_idx on sealed_products(org_id) where deleted_at is null;

-- =============================================================================
-- PRICE CACHE  (shared across all orgs — keyed by card name + set)
-- =============================================================================

create table price_cache (
  query_hash      text primary key,   -- md5(lower(card_name || '|' || set_code))
  card_name       text not null,
  set_code        text not null,
  median_price    numeric(10,2),
  price_count     int,
  prices          numeric[] not null default '{}',
  days_used       int,
  fetched_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours')
);

create index price_cache_expires_idx on price_cache(expires_at);

-- =============================================================================
-- CALENDAR EVENTS
-- =============================================================================

create table calendar_events (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references organizations(id) on delete cascade,
  title       text not null,
  event_date  date not null,
  event_type  text not null default 'event',
  notes       text not null default '',
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index calendar_org_id_idx on calendar_events(org_id, event_date);

-- =============================================================================
-- WISHLIST ITEMS  (per user, not per org)
-- =============================================================================

create table wishlist_items (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  card_name       text not null,
  set_code        text not null default '',
  card_number     text not null default '',
  target_price    numeric(10,2),
  ebay_avg        numeric(10,2),
  last_checked    timestamptz,
  notes           text not null default '',
  created_at      timestamptz not null default now()
);

create index wishlist_user_id_idx on wishlist_items(user_id);

-- =============================================================================
-- AUDIT LOG
-- =============================================================================

create table audit_log (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  action        text not null,         -- 'card.create' | 'card.update' | 'sale.create' …
  entity_type   text not null,
  entity_id     uuid,
  changes       jsonb,                  -- {before: {}, after: {}}
  created_at    timestamptz not null default now()
);

create index audit_org_id_idx on audit_log(org_id, created_at desc);

-- =============================================================================
-- UPDATED_AT TRIGGER  (auto-set updated_at on any row change)
-- =============================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cards_updated_at          before update on cards           for each row execute function set_updated_at();
create trigger sales_updated_at          before update on sales           for each row execute function set_updated_at();
create trigger sealed_updated_at         before update on sealed_products for each row execute function set_updated_at();
create trigger users_updated_at          before update on users           for each row execute function set_updated_at();
create trigger organizations_updated_at  before update on organizations   for each row execute function set_updated_at();
create trigger org_settings_updated_at   before update on org_settings    for each row execute function set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Helper: get current user's org_id
create or replace function current_org_id()
returns uuid language sql stable security definer as $$
  select org_id from users where id = auth.uid()
$$;

-- Helper: is current user owner of their org?
create or replace function is_org_owner()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from users
    where id = auth.uid() and role = 'owner'
  )
$$;

-- Enable RLS on all tables
alter table organizations     enable row level security;
alter table users             enable row level security;
alter table org_settings      enable row level security;
alter table ebay_credentials  enable row level security;
alter table cards             enable row level security;
alter table card_photos       enable row level security;
alter table sales             enable row level security;
alter table sealed_products   enable row level security;
alter table calendar_events   enable row level security;
alter table wishlist_items    enable row level security;
alter table audit_log         enable row level security;
-- price_cache: no RLS (public read, server-only write via service role)

-- Organizations: members see only their own org
create policy "org_select" on organizations for select
  using (id = current_org_id());

create policy "org_update" on organizations for update
  using (id = current_org_id() and is_org_owner());

-- Users: members see only users in their org
create policy "users_select" on users for select
  using (org_id = current_org_id());

create policy "users_update_own" on users for update
  using (id = auth.uid());

create policy "users_update_owner" on users for update
  using (org_id = current_org_id() and is_org_owner());

-- Org settings
create policy "org_settings_select" on org_settings for select
  using (org_id = current_org_id());

create policy "org_settings_upsert" on org_settings for all
  using (org_id = current_org_id() and is_org_owner());

-- eBay credentials: owner only, and only via service role from API
create policy "ebay_creds_owner_only" on ebay_credentials for all
  using (org_id = current_org_id() and is_org_owner());

-- Cards: all org members read; all org members write
create policy "cards_select" on cards for select
  using (org_id = current_org_id());

create policy "cards_insert" on cards for insert
  with check (org_id = current_org_id());

create policy "cards_update" on cards for update
  using (org_id = current_org_id());

create policy "cards_delete" on cards for delete
  using (org_id = current_org_id());

-- Card photos: via card ownership
create policy "card_photos_select" on card_photos for select
  using (card_id in (select id from cards where org_id = current_org_id()));

create policy "card_photos_insert" on card_photos for insert
  with check (card_id in (select id from cards where org_id = current_org_id()));

create policy "card_photos_delete" on card_photos for delete
  using (card_id in (select id from cards where org_id = current_org_id()));

-- Sales
create policy "sales_select" on sales for select
  using (org_id = current_org_id());

create policy "sales_insert" on sales for insert
  with check (org_id = current_org_id());

create policy "sales_update" on sales for update
  using (org_id = current_org_id());

create policy "sales_delete" on sales for delete
  using (org_id = current_org_id());

-- Sealed products
create policy "sealed_select" on sealed_products for select
  using (org_id = current_org_id());

create policy "sealed_all" on sealed_products for all
  using (org_id = current_org_id());

-- Calendar events
create policy "calendar_select" on calendar_events for select
  using (org_id = current_org_id());

create policy "calendar_all" on calendar_events for all
  using (org_id = current_org_id());

-- Wishlist: user sees only their own items
create policy "wishlist_select" on wishlist_items for select
  using (user_id = auth.uid());

create policy "wishlist_all" on wishlist_items for all
  using (user_id = auth.uid());

-- Audit log: read-only for org members
create policy "audit_select" on audit_log for select
  using (org_id = current_org_id());

-- =============================================================================
-- DASHBOARD VIEW  (pre-computed stats per org — fast for dashboard queries)
-- =============================================================================

create or replace view org_dashboard_stats as
select
  o.id                                                       as org_id,
  count(c.id) filter (where c.status in ('In Stock','Listed')
    and c.deleted_at is null)                                as active_card_count,
  count(c.id) filter (where c.status = 'Listed'
    and c.deleted_at is null)                                as listed_count,
  coalesce(sum(c.purchase_price * c.qty) filter (
    where c.deleted_at is null
    and c.status in ('In Stock','Listed')), 0)               as inventory_cost,
  coalesce(sum(c.listed_price) filter (
    where c.status = 'Listed'
    and c.deleted_at is null), 0)                            as listed_value,
  count(s.id) filter (where s.sale_status != 'Fulfilled'
    and s.deleted_at is null)                                as pending_sales,
  coalesce(sum(s.profit) filter (where s.deleted_at is null), 0) as total_profit,
  coalesce(sum(s.sold_price) filter (where s.deleted_at is null), 0) as total_revenue
from organizations o
left join cards c on c.org_id = o.id
left join sales s on s.org_id = o.id
group by o.id;
