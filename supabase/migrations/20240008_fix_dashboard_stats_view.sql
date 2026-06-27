-- =============================================================================
-- CardVault Pro — Fix org_dashboard_stats view
-- Migration: 20240008_fix_dashboard_stats_view.sql
--
-- BUG: The original view joined cards and sales directly to organizations
-- without a relationship between cards and sales. This produced a Cartesian
-- product (N cards × M sales rows) before GROUP BY, inflating every metric:
--
--   total_profit      = actual_profit  × card_count
--   pending_sales     = actual_pending × card_count
--   active_card_count = actual_count   × sale_count
--   inventory_cost    = actual_cost    × sale_count
--
-- FIX: Aggregate each table independently in subqueries, then LEFT JOIN the
-- pre-aggregated results to organizations. No cross-multiplication possible.
--
-- ALSO: Split the single pending_sales bucket into two meaningful states:
--   to_ship    — sale_status = 'Sold'      (sold, not yet dispatched)
--   to_deliver — sale_status = 'Shipped'   (dispatched, not yet received)
--   pending_sales kept as to_ship + to_deliver for backwards compatibility
-- =============================================================================

DROP VIEW IF EXISTS org_dashboard_stats;

CREATE VIEW org_dashboard_stats AS
SELECT
  o.id                                                       AS org_id,

  -- Cards metrics (aggregated independently — no fan-out)
  COALESCE(c.active_card_count, 0)                           AS active_card_count,
  COALESCE(c.listed_count,      0)                           AS listed_count,
  COALESCE(c.inventory_cost,    0)                           AS inventory_cost,
  COALESCE(c.listed_value,      0)                           AS listed_value,

  -- Sales metrics split by fulfilment state
  COALESCE(s.to_ship,         0)                             AS to_ship,
  COALESCE(s.to_deliver,      0)                             AS to_deliver,
  COALESCE(s.fulfilled_count, 0)                             AS fulfilled_count,
  COALESCE(s.to_ship, 0) + COALESCE(s.to_deliver, 0)        AS pending_sales,
  COALESCE(s.total_profit,    0)                             AS total_profit,
  COALESCE(s.total_revenue,   0)                             AS total_revenue

FROM organizations o

-- Pre-aggregate cards per org — no fan-out possible
LEFT JOIN (
  SELECT
    org_id,
    COUNT(*)    FILTER (WHERE status IN ('In Stock', 'Listed')
                          AND deleted_at IS NULL)             AS active_card_count,
    COUNT(*)    FILTER (WHERE status = 'Listed'
                          AND deleted_at IS NULL)             AS listed_count,
    COALESCE(
      SUM(purchase_price * qty) FILTER (
        WHERE status IN ('In Stock', 'Listed')
          AND deleted_at IS NULL
      ), 0)                                                   AS inventory_cost,
    COALESCE(
      SUM(listed_price) FILTER (
        WHERE status = 'Listed'
          AND deleted_at IS NULL
      ), 0)                                                   AS listed_value
  FROM cards
  GROUP BY org_id
) c ON c.org_id = o.id

-- Pre-aggregate sales per org — no fan-out possible
LEFT JOIN (
  SELECT
    org_id,
    COUNT(*) FILTER (WHERE sale_status = 'Sold'      AND deleted_at IS NULL) AS to_ship,
    COUNT(*) FILTER (WHERE sale_status = 'Shipped'   AND deleted_at IS NULL) AS to_deliver,
    COUNT(*) FILTER (WHERE sale_status = 'Fulfilled' AND deleted_at IS NULL) AS fulfilled_count,
    COALESCE(SUM(profit)     FILTER (WHERE deleted_at IS NULL), 0)           AS total_profit,
    COALESCE(SUM(sold_price) FILTER (WHERE deleted_at IS NULL), 0)           AS total_revenue
  FROM sales
  GROUP BY org_id
) s ON s.org_id = o.id;
