-- =============================================================================
-- Sprint 22: Buyer Profiles
--
-- Tracks repeat customers so you can see purchase history, total spend,
-- and who your best buyers are. buyer_name is denormalized on sales for
-- fast display without a join. buyer_id is the FK for full profile lookup.
-- =============================================================================

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buyers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  email       text        NOT NULL DEFAULT '',
  phone       text        NOT NULL DEFAULT '',
  notes       text        NOT NULL DEFAULT '',
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ── Extend sales ──────────────────────────────────────────────────────────────
-- buyer_name: denormalized for quick display (no join needed in most views)
-- buyer_id:   FK for full profile — nullable, set when buyer is in system

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS buyer_id   uuid REFERENCES buyers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buyer_name text NOT NULL DEFAULT '';

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_buyers_org
  ON buyers(org_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_buyers_name
  ON buyers(org_id, lower(name)) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_buyer_id
  ON sales(buyer_id) WHERE buyer_id IS NOT NULL;

-- ── Updated-at trigger ────────────────────────────────────────────────────────

CREATE TRIGGER set_buyers_updated_at
  BEFORE UPDATE ON buyers
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_buyers" ON buyers
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "org_members_insert_buyers" ON buyers
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "org_members_update_buyers" ON buyers
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );
