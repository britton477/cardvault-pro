'use client'
// =============================================================================
// EbayCredentialsForm — saves eBay API credentials encrypted server-side.
//
// SECURITY MODEL:
//  • Values are POSTed to /api/settings/ebay-credentials (HTTPS only)
//  • The API route encrypts each field with AES-256-GCM before writing to DB
//  • The EBAY_ENCRYPTION_KEY is a server-side .env variable — never in client
//  • This form never receives back the credential values; only { has_credentials }
//  • The "secret" field is rendered type="password" and cleared after save
// =============================================================================
import { useState } from 'react'
import { KeyRound, CheckCircle2, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { useSaveEbayCredentials, useEbayCredentialStatus } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'

interface FormState {
  app_id:  string
  secret:  string
  ru_name: string
}

const EMPTY: FormState = { app_id: '', secret: '', ru_name: '' }

export function EbayCredentialsForm() {
  const { data: status, isLoading: statusLoading } = useEbayCredentialStatus()
  const save = useSaveEbayCredentials()
  const { toast } = useToast()

  const [form,       setForm]       = useState<FormState>(EMPTY)
  const [showSecret, setShowSecret] = useState(false)
  const [showForm,   setShowForm]   = useState(false)

  function set(field: keyof FormState, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function reset() {
    setForm(EMPTY)
    setShowSecret(false)
    setShowForm(false)
  }

  async function handleSave() {
    if (!form.app_id.trim() || !form.secret.trim() || !form.ru_name.trim()) {
      toast.error('All fields required', 'App ID, Secret, and RU Name are all required.')
      return
    }
    try {
      await save.mutateAsync({
        app_id:  form.app_id.trim(),
        secret:  form.secret.trim(),
        ru_name: form.ru_name.trim(),
      })
      toast.success('eBay credentials saved', 'Credentials encrypted and stored securely.')
      reset()
    } catch (err) {
      toast.error('Failed to save credentials', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <div>
          <h2 className="text-base font-semibold">eBay API Credentials</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Stored AES-256-GCM encrypted. Never exposed to the browser after saving.
          </p>
        </div>
      </div>

      {/* Status indicator */}
      {!statusLoading && (
        <div className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-sm ${
          status?.has_credentials
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
        }`}>
          {status?.has_credentials ? (
            <>
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Credentials configured
                {status.updated_at && (
                  <span className="ml-1 text-green-400/70">
                    · Updated {formatDate(status.updated_at)}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>No credentials saved — eBay listing and pricing features are disabled.</span>
            </>
          )}
        </div>
      )}

      {/* Toggle: show/hide the credential entry form */}
      {!showForm ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowForm(true)}
        >
          {status?.has_credentials ? 'Update credentials' : 'Enter credentials'}
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Enter your eBay developer credentials from{' '}
              <a
                href="https://developer.ebay.com/my/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                developer.ebay.com/my/keys
              </a>
              . Use Production keys, not Sandbox.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <Input
              label="App ID (Client ID)"
              value={form.app_id}
              onChange={e => set('app_id', e.target.value)}
              placeholder="VaultHun-CardVaul-PRD-xxxxxxxx-xxxxxxxx"
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              label="Cert ID (Client Secret)"
              type={showSecret ? 'text' : 'password'}
              value={form.secret}
              onChange={e => set('secret', e.target.value)}
              placeholder="PRD-xxxxxxxxxxxxxxxx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              maxLength={200}
              autoComplete="new-password"
              spellCheck={false}
              suffix={
                <button
                  type="button"
                  onClick={() => setShowSecret(s => !s)}
                  aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
            <Input
              label="RuName (Auth redirect name)"
              value={form.ru_name}
              onChange={e => set('ru_name', e.target.value)}
              placeholder="VaultHunters-CardVaul-PRD-xxxxxxxx-xxxxxxxx"
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              hint="Found in your eBay developer account under User Tokens"
            />
          </div>

          <div className="flex items-center gap-3 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              loading={save.isPending}
              disabled={!form.app_id || !form.secret || !form.ru_name}
            >
              Encrypt &amp; save
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
