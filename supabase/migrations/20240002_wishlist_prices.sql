-- =============================================================================
-- Sprint 12 — Add eBay price alert columns to wishlist
-- Run in Supabase SQL editor.
-- =============================================================================

ALTER TABLE wishlist
  ADD COLUMN IF NOT EXISTS last_ebay_price  numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_checked_at timestamptz;

-- Index for efficient "items due for price check" query
CREATE INDEX IF NOT EXISTS wishlist_price_check_idx
  ON wishlist (org_id, status, target_price)
  WHERE deleted_at IS NULL
    AND status = 'wanted'
    AND target_price IS NOT NULL;
