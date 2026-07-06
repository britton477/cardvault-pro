-- =============================================================================
-- Migration 20240010: Rename plan tiers basic/growth
--
-- Renames: solo → basic, shop → growth
-- Postgres enums cannot remove values, so we add the new values, migrate
-- existing data, then leave the old values dormant in the type definition.
-- =============================================================================

-- ── 1. Add new enum values ────────────────────────────────────────────────────

ALTER TYPE org_plan ADD VALUE IF NOT EXISTS 'basic';
ALTER TYPE org_plan ADD VALUE IF NOT EXISTS 'growth';

-- ── 2. Migrate existing rows ──────────────────────────────────────────────────
-- Cast via text to avoid Postgres enum comparison restrictions.

UPDATE organizations
  SET plan = 'basic'
  WHERE plan::text = 'solo';

UPDATE organizations
  SET plan = 'growth'
  WHERE plan::text = 'shop';

-- ── Notes ─────────────────────────────────────────────────────────────────────
-- The old 'solo' and 'shop' values remain in the enum type definition but are
-- no longer used by the application. They are harmless.
