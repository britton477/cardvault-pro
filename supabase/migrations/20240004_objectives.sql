-- =============================================================================
-- Sprint 15 — Objectives
-- Run PART 1 first, then PART 2 separately if needed.
-- =============================================================================

-- ── PART 1: Function, table, indexes, trigger ────────────────────────────────

CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS objectives (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by   uuid        NOT NULL REFERENCES users(id),
  title        text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  is_personal  boolean     NOT NULL DEFAULT false,
  is_complete  boolean     NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by uuid        REFERENCES users(id),
  position     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS objectives_org_idx
  ON objectives (org_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS objectives_created_by_idx
  ON objectives (created_by) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS objectives_incomplete_idx
  ON objectives (org_id, is_complete, position) WHERE deleted_at IS NULL;

CREATE OR REPLACE TRIGGER objectives_updated_at
  BEFORE UPDATE ON objectives
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── PART 2: RLS ──────────────────────────────────────────────────────────────

ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "objectives_select" ON objectives
  FOR SELECT USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND deleted_at IS NULL
    AND (is_personal = false OR created_by = auth.uid())
  );

CREATE POLICY "objectives_insert" ON objectives
  FOR INSERT WITH CHECK (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "objectives_update" ON objectives
  FOR UPDATE USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND deleted_at IS NULL
    AND (is_personal = false OR created_by = auth.uid())
  );

CREATE POLICY "objectives_delete" ON objectives
  FOR DELETE USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND (is_personal = false OR created_by = auth.uid())
  );
