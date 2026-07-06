-- =============================================================================
-- Migration 20240009: Stripe billing + team invitations
--
-- 1. Adds new plan tiers (solo, shop) to org_plan enum
-- 2. Adds Stripe tracking columns to organizations
-- 3. Creates org_invitations table for team invite links
-- =============================================================================

-- ── 1. Extend org_plan enum ───────────────────────────────────────────────────
-- Postgres ALTER TYPE ADD VALUE is idempotent in PG 9.6+ when using IF NOT EXISTS

ALTER TYPE org_plan ADD VALUE IF NOT EXISTS 'solo';
ALTER TYPE org_plan ADD VALUE IF NOT EXISTS 'shop';

-- ── 2. Stripe columns on organizations ───────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text,
  -- trial | active | past_due | cancelled
  -- Stored as text (not enum) so Stripe status strings map directly.
  ADD COLUMN IF NOT EXISTS subscription_status     text NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_ends_at           timestamptz NOT NULL DEFAULT (now() + interval '14 days');

-- Index for webhook lookups by customer ID
CREATE INDEX IF NOT EXISTS organizations_stripe_customer_idx
  ON organizations(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── 3. Team invitations ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_invitations (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        user_role NOT NULL DEFAULT 'member',
  token       text NOT NULL UNIQUE,         -- secure random token in invite URL
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast token lookup for accept-invite page (only unaccepted tokens)
CREATE UNIQUE INDEX IF NOT EXISTS org_invitations_token_idx
  ON org_invitations(token)
  WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS org_invitations_org_idx
  ON org_invitations(org_id);

-- ── 4. RLS on org_invitations ─────────────────────────────────────────────────
-- Owners can read/create/delete invitations for their org.
-- Accept endpoint uses service role (bypasses RLS) so we don't expose org_id.

ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view their invitations"
  ON org_invitations FOR SELECT
  USING (org_id = current_org_id());

CREATE POLICY "org owners can create invitations"
  ON org_invitations FOR INSERT
  WITH CHECK (
    org_id = current_org_id()
    AND current_user_role() = 'owner'
  );

CREATE POLICY "org owners can delete invitations"
  ON org_invitations FOR DELETE
  USING (
    org_id = current_org_id()
    AND current_user_role() = 'owner'
  );
