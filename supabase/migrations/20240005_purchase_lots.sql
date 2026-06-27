-- =============================================================================
-- Sprint 21: Purchase Lot Tracking
--
-- A purchase lot represents a batch of cards bought together (e.g. a collection
-- purchased for a single price). Cards can be assigned to a lot so the total
-- cost is visible and cost-per-card allocation is tracked.
-- =============================================================================

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_lots (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text         NOT NULL DEFAULT '',
  source        text         NOT NULL DEFAULT '',
  total_cost    numeric(10,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  purchased_at  date         NOT NULL DEFAULT CURRENT_DATE,
  notes         text         NOT NULL DEFAULT '',
  created_by    uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- ── Link cards to lots ────────────────────────────────────────────────────────

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES purchase_lots(id) ON DELETE SET NULL;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_purchase_lots_org
  ON purchase_lots(org_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cards_lot_id
  ON cards(lot_id) WHERE lot_id IS NOT NULL;

-- ── Updated-at trigger ────────────────────────────────────────────────────────

CREATE TRIGGER set_purchase_lots_updated_at
  BEFORE UPDATE ON purchase_lots
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_lots" ON purchase_lots
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "org_members_insert_lots" ON purchase_lots
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "org_members_update_lots" ON purchase_lots
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );
