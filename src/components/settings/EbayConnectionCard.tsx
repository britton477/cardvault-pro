'use client'
// =============================================================================
// EbayConnectionCard — shows eBay OAuth connection status and connect button.
// Reads from /api/ebay/status (never exposes raw tokens to the client).
// Renders a sandbox badge when EBAY_ENV=sandbox.
// =============================================================================
import { CheckCircle2, AlertTriangle, RefreshCw, ExternalLink, Plug } from 'lucide-react'
import { useEbayConnectionStatus } from '@/hooks/useSettings'
import { cn } from '@/lib/utils'

function formatExpiry(expiresAt: string | null, expiresInMs: number | null): string {
  if (!expiresAt) return 'Unknown'
  if (expiresInMs !== null && expiresInMs < 0) return 'Expired'
  const mins = Math.floor((expiresInMs ?? 0) / 60_000)
  if (mins < 60)  return `Expires in ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `Expires in ${hrs}h`
  return `Expires ${new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

export function EbayConnectionCard() {
  const { data: status, isLoading } = useEbayConnectionStatus()

  if (isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card p-6 space-y-4 animate-pulse">
        <div className="h-5 w-40 rounded bg-secondary/60" />
        <div className="h-10 w-full rounded bg-secondary/40" />
      </section>
    )
  }

  const connected    = status?.connected ?? false
  const hasCredentials = status?.has_credentials ?? false
  const isSandbox    = status?.is_sandbox ?? true
  const isExpired    = status?.is_expired ?? true

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Plug className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">eBay Account</h2>
              {isSandbox && (
                <span className="inline-flex items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-400 ring-1 ring-violet-500/30">
                  SANDBOX
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              OAuth connection required for listing and listing management.
            </p>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {!hasCredentials ? (
        <div className="flex items-center gap-2.5 rounded-md border border-amber-500/25 bg-amber-500/8 px-3 py-2.5 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Save your eBay API credentials above before connecting your account.
          </span>
        </div>
      ) : connected && !isExpired ? (
        <div className="flex items-center gap-2.5 rounded-md border border-green-500/25 bg-green-500/8 px-3 py-2.5 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Connected</span>
            <span className="text-xs text-green-400/70">
              {formatExpiry(status?.expires_at ?? null, status?.expires_in_ms ?? null)}
              {' · '}Tokens auto-refresh before expiry
            </span>
          </div>
        </div>
      ) : (
        <div className={cn(
          'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm',
          connected && isExpired
            ? 'border-amber-500/25 bg-amber-500/8 text-amber-400'
            : 'border-border bg-secondary/30 text-muted-foreground',
        )}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {connected && isExpired
              ? 'Access token expired — click Reconnect to refresh.'
              : 'Not connected — click below to authorise CardVault Pro on eBay.'}
          </span>
        </div>
      )}

      {/* Action buttons */}
      {hasCredentials && (
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href="/api/ebay/auth"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {connected ? 'Reconnect eBay' : 'Connect eBay Account'}
          </a>
          {connected && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" aria-hidden />
              Tokens auto-refresh silently — reconnect only needed if revoked
            </span>
          )}
        </div>
      )}

      {/* Sandbox guidance */}
      {isSandbox && (
        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 text-xs text-violet-400 space-y-1">
          <p className="font-medium">Sandbox mode active</p>
          <p className="text-violet-400/70">
            Using eBay sandbox APIs. Use your{' '}
            <a
              href="https://developer.ebay.com/my/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              sandbox credentials
            </a>
            {' '}and a{' '}
            <a
              href="https://signin.sandbox.ebay.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              sandbox seller account
            </a>
            . No real listings will be created. Set{' '}
            <code className="font-mono">EBAY_ENV=production</code> to go live.
          </p>
        </div>
      )}
    </section>
  )
}
