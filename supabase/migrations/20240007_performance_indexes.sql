-- =============================================================================
-- CardVault Pro — Performance Indexes + Dashboard Cache Table
-- Migration: 20240007_performance_indexes.sql
-- =============================================================================

-- 1. pg_trgm extension (fuzzy card name search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. cards indexes
CREATE INDEX IF NOT EXISTS idx_cards_org_name_trgm
  ON cards USING gin (card_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cards_lot_id_org
  ON cards (org_id, lot_id)
  WHERE deleted_at IS NULL AND lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cards_org_created
  ON cards (org_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cards_org_condition
  ON cards (org_id, condition)
  WHERE deleted_at IS NULL;

-- 3. sales indexes
CREATE INDEX IF NOT EXISTS idx_sales_org_date
  ON sales (org_id, sale_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_buyer_id_org
  ON sales (org_id, buyer_id)
  WHERE deleted_at IS NULL AND buyer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_org_platform
  ON sales (org_id, platform)
  WHERE deleted_at IS NULL;

-- 4. purchase_lots indexes
CREATE INDEX IF NOT EXISTS idx_purchase_lots_org_date
  ON purchase_lots (org_id, purchased_at DESC)
  WHERE deleted_at IS NULL;

-- 5. buyers indexes
CREATE INDEX IF NOT EXISTS idx_buyers_org_created
  ON buyers (org_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 6. calendar_events indexes
CREATE INDEX IF NOT EXISTS idx_events_org_date
  ON calendar_events (org_id, event_date ASC)
  WHERE deleted_at IS NULL;

-- 7. wishlist indexes
CREATE INDEX IF NOT EXISTS idx_wishlist_org_created
  ON wishlist (org_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 8. objectives indexes
CREATE INDEX IF NOT EXISTS idx_objectives_org_complete
  ON objectives (org_id, is_complete)
  WHERE deleted_at IS NULL;

-- 9. Dashboard stats cache table
-- Replaces the O(n²) org_dashboard_stats VIEW for high-scale deployments.
-- Written by server-side refresh; read by /api/dashboard/charts with fallback.
CREATE TABLE IF NOT EXISTS org_dashboard_cache (
  org_id          uuid          PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  total_cards     integer       NOT NULL DEFAULT 0,
  total_invested  numeric(10,2) NOT NULL DEFAULT 0,
  total_revenue   numeric(10,2) NOT NULL DEFAULT 0,
  total_profit    numeric(10,2) NOT NULL DEFAULT 0,
  cards_sold      integer       NOT NULL DEFAULT 0,
  active_listings integer       NOT NULL DEFAULT 0,
  refreshed_at    timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE org_dashboard_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read their own cache"
  ON org_dashboard_cache FOR SELECT
  USING (org_id = (
    SELECT org_id FROM users WHERE id = auth.uid() LIMIT 1
  ));

-- 10. Function to refresh dashboard cache for one org
CREATE OR REPLACE FUNCTION refresh_dashboard_cache(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO org_dashboard_cache (
    org_id,
    total_cards,
    total_invested,
    total_revenue,
    total_profit,
    cards_sold,
    active_listings,
    refreshed_at
  )
  SELECT
    p_org_id,
    COALESCE(c.total_cards, 0),
    COALESCE(c.total_invested, 0),
    COALESCE(s.total_revenue, 0),
    COALESCE(s.total_revenue, 0) - COALESCE(c.total_invested, 0),
    COALESCE(s.cards_sold, 0),
    0,
    now()
  FROM
    (SELECT
       COUNT(*)::integer              AS total_cards,
       SUM(purchase_price * qty)      AS total_invested
     FROM cards
     WHERE org_id = p_org_id AND deleted_at IS NULL) c
  CROSS JOIN
    (SELECT
       COUNT(*)::integer AS cards_sold,
       SUM(sold_price)   AS total_revenue
     FROM sales
     WHERE org_id = p_org_id AND deleted_at IS NULL) s
  ON CONFLICT (org_id) DO UPDATE SET
    total_cards     = EXCLUDED.total_cards,
    total_invested  = EXCLUDED.total_invested,
    total_revenue   = EXCLUDED.total_revenue,
    total_profit    = EXCLUDED.total_profit,
    cards_sold      = EXCLUDED.cards_sold,
    active_listings = EXCLUDED.active_listings,
    refreshed_at    = now();
END;
$$;
