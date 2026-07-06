// =============================================================================
// GET /api/auth/me
//
// Returns the current user's profile and org for client-side permission checks.
// Used exclusively by usePermissions() hook — kept lean (no settings, no eBay).
//
// Returns: AuthProfile shape (id, email, profile, org)
// Cached in TanStack Query for 60 seconds (matches server-side Redis TTL).
// =============================================================================
import { requireAuth, ok, serverError } from '@/lib/api'

export async function GET() {
  try {
    const { user } = await requireAuth()

    return ok({
      id:    user.id,
      email: user.email,
      profile: {
        role:   user.profile.role,
        org_id: user.profile.org_id,
        name:   user.profile.name,
        avatar: user.profile.avatar,
      },
      org: {
        id:                  user.org.id,
        name:                user.org.name,
        plan:                user.org.plan,
        card_limit:          user.org.card_limit,
        subscription_status: user.org.subscription_status ?? 'trial',
        trial_ends_at:       user.org.trial_ends_at ?? null,
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}
