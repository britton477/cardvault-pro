-- =============================================================================
-- 20240013  Rarity, seller-model fees, and Bulk Wizard batch defaults
--
-- Additive + nullable/defaulted only — safe to run against live data. No backfill
-- here; existing cards get rarity via the background TCG lookup script.
-- =============================================================================

-- ── Cards: authoritative rarity, kept SEPARATE from foil_type ────────────────
-- foil_type stays as the holo/pattern descriptor; rarity is the Bulbapedia
-- rarity class (Common … Double Rare … Special Illustration Rare … Hyper Rare).
alter table cards add column if not exists rarity text;

-- ── Org settings: seller model for net-proceeds maths ────────────────────────
-- 'private'  → buyer pays the eBay Buyer Protection fee on top; you receive list.
-- 'business' → you pay a final value fee (pct + fixed) out of the sale.
alter table org_settings add column if not exists seller_model text not null default 'private'
  check (seller_model in ('private', 'business'));
alter table org_settings add column if not exists fvf_pct   numeric(5,2)  not null default 0;
alter table org_settings add column if not exists fvf_fixed numeric(10,2) not null default 0;

-- ── Org settings: Bulk Wizard batch defaults (all user-adjustable) ───────────
-- markup_pct already exists (cost-plus markup). These add the market strategy
-- knobs and the per-batch defaults that were previously hardcoded in the wizard.
alter table org_settings add column if not exists pricing_mode text not null default 'market'
  check (pricing_mode in ('market', 'cost', 'fixed'));
alter table org_settings add column if not exists pricing_adjustment_pct numeric(6,2) not null default 10;
alter table org_settings add column if not exists default_condition card_condition not null default 'NM';
alter table org_settings add column if not exists default_source   text not null default 'Bulk Wizard';
alter table org_settings add column if not exists default_language text not null default 'EN';
alter table org_settings add column if not exists rarity_source text not null default 'tcg'
  check (rarity_source in ('tcg', 'vision'));
alter table org_settings add column if not exists pairing_mode  text not null default 'pairs'
  check (pairing_mode in ('pairs', 'fronts_then_backs', 'manual'));
