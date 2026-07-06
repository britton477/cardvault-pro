// =============================================================================
// Settings page — org settings, eBay credentials, policy IDs, team members.
// Each section is an independent form card with its own Save button.
// =============================================================================
import type { Metadata } from 'next'
import { redirect }           from 'next/navigation'
import { createAdminClient }  from '@/lib/supabase/server'
import { getServerSession }   from '@/lib/auth'
import { OrgSettingsForm }      from '@/components/settings/OrgSettingsForm'
import { PolicyIdsForm }        from '@/components/settings/PolicyIdsForm'
import { EbayCredentialsForm }  from '@/components/settings/EbayCredentialsForm'
import { EbayConnectionCard }   from '@/components/settings/EbayConnectionCard'
import type { User } from '@/types'

export const metadata: Metadata = { title: 'Settings' }

// Load session + profile in one admin query.
// Returns null if the user is not signed in or has no profile.
async function getSessionProfile() {
  const session = await getServerSession()
  if (!session?.user) return null

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('org_id, role')
    .eq('id', session.user.id)
    .single()

  return profile ?? null
}

// Fetch team members server-side (no client exposure of org_id needed)
async function getTeamMembers(orgId: string): Promise<User[]> {
  const admin = createAdminClient()
  const { data: members } = await admin
    .from('users')
    .select('id, name, avatar, role, created_at, updated_at, org_id, pin_hash')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })

  return (members ?? []) as User[]
}

const ROLE_STYLES: Record<string, string> = {
  owner:  'bg-primary/15 text-primary ring-primary/30',
  member: 'bg-secondary text-muted-foreground ring-border',
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const profile = await getSessionProfile()

  // Members cannot access settings — redirect to dashboard
  if (!profile || profile.role !== 'owner') {
    redirect('/dashboard?notice=settings_owner_only')
  }

  const members = await getTeamMembers(profile.org_id as string)
  const params  = await searchParams
  const ebayConnected = params['ebay_connected'] === '1'
  const ebayError     = params['ebay_error'] ?? null

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your organisation, eBay integration, and team.
        </p>
      </div>

      {/* ── eBay OAuth result banners ──────────────────────────────────── */}
      {ebayConnected && (
        <div className="flex items-center gap-2.5 rounded-lg border border-green-500/30 bg-green-500/8 px-4 py-3 text-sm text-green-400">
          <span className="text-base">✓</span>
          <span>eBay account connected successfully. You can now list cards and sync pricing.</span>
        </div>
      )}
      {ebayError && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          <span className="text-base">✕</span>
          <span>
            {ebayError === 'access_denied'
              ? 'eBay access was denied. Please try connecting again and approve the permissions.'
              : ebayError === 'missing_credentials'
              ? 'Please save your eBay API credentials before connecting.'
              : `eBay connection failed: ${ebayError}`}
          </span>
        </div>
      )}

      {/* ── Organisation ──────────────────────────────────────────────── */}
      <OrgSettingsForm />

      {/* ── eBay Policy IDs ───────────────────────────────────────────── */}
      <PolicyIdsForm />

      {/* ── eBay API Credentials ──────────────────────────────────────── */}
      <EbayCredentialsForm />

      {/* ── eBay Account Connection ────────────────────────────────────── */}
      <EbayConnectionCard />

      {/* ── Image Storage ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-3">
        <h2 className="text-base font-semibold">Image Storage (R2)</h2>
        <p className="text-sm text-muted-foreground">
          Cloudflare R2 is used to store card photos. Credentials are set via environment
          variables and cannot be changed from this UI.
        </p>
        <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-muted-foreground font-mono space-y-0.5">
          <p>R2_ACCOUNT_ID</p>
          <p>R2_ACCESS_KEY_ID</p>
          <p>R2_SECRET_ACCESS_KEY</p>
          <p>R2_BUCKET_NAME</p>
          <p>R2_PUBLIC_URL</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Set these in <code className="font-mono">.env.local</code> and restart the dev server.
        </p>
      </section>

      {/* ── Team members ──────────────────────────────────────────────── */}
      {members.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Team</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {members.length} member{members.length !== 1 ? 's' : ''} in your organisation.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {members.map(m => (
              <li key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {/* Avatar */}
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0 select-none">
                  {m.name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.name}</p>
                </div>
                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${ROLE_STYLES[m.role] ?? ROLE_STYLES['member']}`}>
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
