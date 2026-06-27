-- =============================================================================
-- Sprint 13: calendar_events — upgrade existing table to full schema
--
-- The table already exists with a minimal schema. This migration adds all
-- missing columns, replaces indexes, wires up RLS, and adds the updated_at
-- trigger. Safe to re-run (all statements are idempotent).
-- =============================================================================

-- ── Add missing columns to the existing table ────────────────────────────────

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS description  text        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS end_date     date,
  ADD COLUMN IF NOT EXISTS all_day      boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS start_time   time,
  ADD COLUMN IF NOT EXISTS end_time     time,
  ADD COLUMN IF NOT EXISTS location     text        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS color        text        NOT NULL DEFAULT 'blue',
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at   timestamptz;

-- Rename 'notes' → 'description' if the old column still exists
-- (safe no-op if already renamed or never existed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_events' AND column_name = 'notes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_events' AND column_name = 'description'
  ) THEN
    ALTER TABLE calendar_events RENAME COLUMN notes TO description;
  END IF;
END $$;

-- Add CHECK constraints (skip if already present — Postgres will error on duplicate names)
DO $$
BEGIN
  -- event_type constraint (drop + recreate so adding new types works cleanly)
  ALTER TABLE calendar_events
    DROP CONSTRAINT IF EXISTS calendar_events_event_type_check;
  ALTER TABLE calendar_events
    ADD CONSTRAINT calendar_events_event_type_check
    CHECK (event_type IN ('show', 'reminder', 'restock', 'follow_up', 'social_post', 'collection_buy', 'other'));

  -- color constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_events_color_check' AND conrelid = 'calendar_events'::regclass
  ) THEN
    ALTER TABLE calendar_events
      ADD CONSTRAINT calendar_events_color_check
      CHECK (color IN ('blue', 'green', 'amber', 'red', 'purple', 'gray'));
  END IF;
END $$;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS calendar_events_org_date_idx
  ON calendar_events (org_id, event_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS calendar_events_org_end_date_idx
  ON calendar_events (org_id, end_date)
  WHERE deleted_at IS NULL AND end_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_events_type_idx
  ON calendar_events (org_id, event_type)
  WHERE deleted_at IS NULL;

-- ── Updated-at trigger ────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_calendar_events_updated_at ON calendar_events;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist (names may differ from old schema)
DROP POLICY IF EXISTS "org members can read events"   ON calendar_events;
DROP POLICY IF EXISTS "org members can create events" ON calendar_events;
DROP POLICY IF EXISTS "org members can update events" ON calendar_events;

-- Members can read their org's active events
CREATE POLICY "org members can read events"
  ON calendar_events FOR SELECT
  USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND deleted_at IS NULL
  );

-- Members can insert events into their own org
CREATE POLICY "org members can create events"
  ON calendar_events FOR INSERT
  WITH CHECK (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Members can update (including soft-delete) their org's events
CREATE POLICY "org members can update events"
  ON calendar_events FOR UPDATE
  USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );
