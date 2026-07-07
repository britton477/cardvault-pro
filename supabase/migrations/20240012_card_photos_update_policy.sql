-- =============================================================================
-- CardVault Pro — FIX: add missing UPDATE policy to card_photos
-- =============================================================================
-- BUG (pre-fix):
--   card_photos had SELECT/INSERT/DELETE policies but NO UPDATE policy.
--   Under RLS default-deny, any UPDATE via the user client affected 0 rows and
--   returned no error. Effects:
--     - images/reorder  → position changes silently never persisted (no-op).
--     - images/[photoId] PATCH (crop) → uploads the new image, silently fails
--       the DB update, then deletes the OLD storage objects → the card ends up
--       pointing at a DELETED image (broken thumbnail / data corruption).
--
-- FIX:
--   Add a card_photos UPDATE policy scoped via the card → org join, mirroring
--   the existing select/insert/delete policies. Both USING and WITH CHECK ensure
--   the photo's card stays within the caller's org before and after the update.
-- =============================================================================

CREATE POLICY "card_photos_update" ON public.card_photos
  FOR UPDATE
  USING      (card_id IN (SELECT id FROM public.cards WHERE org_id = current_org_id()))
  WITH CHECK (card_id IN (SELECT id FROM public.cards WHERE org_id = current_org_id()));

-- =============================================================================
-- VERIFICATION (as an authenticated user who owns the card):
--   UPDATE public.card_photos SET position = 1 WHERE id = '<own photo id>';
--   → should affect 1 row.
--
--   Attempting to update a photo belonging to another org must affect 0 rows.
-- =============================================================================
