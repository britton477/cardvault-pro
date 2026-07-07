-- =============================================================================
-- CardVault Pro — SECURITY FIX: lock down self-service updates to `users`
-- =============================================================================
-- VULNERABILITY (pre-fix):
--   The RLS policy `users_update_own` was:
--       for update using (id = auth.uid())     -- NO WITH CHECK
--   Because Supabase exposes PostgREST to any authenticated user via the public
--   anon key, a logged-in member could PATCH their own users row directly:
--       PATCH /rest/v1/users?id=eq.<self>   { "role": "owner" }        → self-escalate
--       PATCH /rest/v1/users?id=eq.<self>   { "org_id": "<victim>" }   → cross-tenant breach
--   RLS was the only gate and it permitted this.
--
-- FIX (defense in depth — two independent layers):
--   1. Column-level privileges: the `authenticated` (and `anon`) Postgres roles
--      may only UPDATE safe profile columns. `role`, `org_id`, `id`,
--      `created_at`, `pin_hash*` are NOT updatable via PostgREST.
--      → The service role (createAdminClient) is UNAFFECTED, so all legitimate
--        admin flows keep working: team role changes (team/members/[id]),
--        invite accept (team/accept), and registration all use the service role.
--   2. RLS WITH CHECK: added to the update policies so a row can never be
--      re-pointed to a different id / outside the caller's org, even if column
--      grants are later widened.
--
-- SAFE COLUMNS a user may self-edit: name, avatar, updated_at.
--   (pin_hash is intentionally excluded — PIN set/change should go through an
--    API route using the service role so it can be hashed server-side.)
-- =============================================================================

-- ── Layer 1: column-level privileges ──────────────────────────────────────────
-- Remove blanket UPDATE, then grant back only the safe columns.
REVOKE UPDATE ON public.users FROM authenticated;
REVOKE UPDATE ON public.users FROM anon;

GRANT UPDATE (name, avatar, updated_at) ON public.users TO authenticated;

-- ── Layer 2: RLS WITH CHECK on the update policies ────────────────────────────
-- Self-update: caller may only update their own row and cannot re-point `id`.
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE
  USING      (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Owner-update: owners may update rows within their own org only, and the new
-- row must remain within their org (cannot move a member to another org).
DROP POLICY IF EXISTS "users_update_owner" ON public.users;
CREATE POLICY "users_update_owner" ON public.users
  FOR UPDATE
  USING      (org_id = current_org_id() AND is_org_owner())
  WITH CHECK (org_id = current_org_id() AND is_org_owner());

-- =============================================================================
-- VERIFICATION (run manually as an *authenticated* (non-service) role):
--
--   -- Should SUCCEED (safe column):
--   UPDATE public.users SET name = 'New Name' WHERE id = auth.uid();
--
--   -- Should FAIL with "permission denied for column role":
--   UPDATE public.users SET role = 'owner' WHERE id = auth.uid();
--
--   -- Should FAIL with "permission denied for column org_id":
--   UPDATE public.users SET org_id = gen_random_uuid() WHERE id = auth.uid();
--
-- Or via PostgREST with a user JWT:
--   curl -X PATCH "$SUPABASE_URL/rest/v1/users?id=eq.$MY_ID" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" \
--     -H "Content-Type: application/json" -d '{"role":"owner"}'
--   → expect 401/403 / "permission denied for column role"
-- =============================================================================
