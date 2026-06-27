-- =============================================================================
-- Sprint 11 — Wishlist table
-- Run this in Supabase > SQL editor before starting the app.
-- =============================================================================

-- Enums (idempotent)
DO $$ BEGIN
  CREATE TYPE wishlist_priority AS ENUM ('low', 'normal', 'high');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE wishlist_status AS ENUM ('wanted', 'found', 'purchased');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Table
CREATE TABLE IF NOT EXISTS wishlist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  card_name    text NOT NULL CHECK (char_length(card_name) BETWEEN 1 AND 200),
  set_name     text NOT NULL DEFAULT '' CHECK (char_length(set_name) <= 200),
  variant      text NOT NULL DEFAULT '' CHECK (char_length(variant) <= 100),
  target_price numeric(10,2) CHECK (target_price >= 0),
  priority     wishlist_priority NOT NULL DEFAULT 'normal',
  status       wishlist_status   NOT NULL DEFAULT 'wanted',
  notes        text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  added_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS wishlist_org_id_idx        ON wishlist (org_id);
CREATE INDEX IF NOT EXISTS wishlist_status_idx        ON wishlist (org_id, status)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wishlist_priority_idx      ON wishlist (org_id, priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wishlist_card_name_idx     ON wishlist USING gin (to_tsvector('english', card_name));

-- updated_at trigger (reuse or create helper fn)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wishlist_set_updated_at ON wishlist;
CREATE TRIGGER wishlist_set_updated_at
  BEFORE UPDATE ON wishlist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE wishlist ENABLE ROW LEVEL SECURITY;

-- Members of the org can read non-deleted items
CREATE POLICY "org members can read wishlist"
  ON wishlist FOR SELECT
  USING (
    deleted_at IS NULL
    AND org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Org members can insert (org_id set server-side)
CREATE POLICY "org members can insert wishlist"
  ON wishlist FOR INSERT
  WITH CHECK (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Org members can update non-deleted items
CREATE POLICY "org members can update wishlist"
  ON wishlist FOR UPDATE
  USING (
    deleted_at IS NULL
    AND org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );
