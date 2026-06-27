'use client'
// =============================================================================
// PolicyIdsForm — eBay seller policy IDs.
// These are numeric IDs from your eBay account (Selling → Business policies).
// Saved via PATCH /api/settings/org (same endpoint as OrgSettingsForm).
// =============================================================================
import { useState, useEffect } from 'react'
import { ShieldCheck, CheckCircle2, ExternalLink } from 'lucide-react'
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface FormState {
  fulfillment: string
  payment:     string
  return_:     string
}

export function PolicyIdsForm() {
  const { data: settings, isLoading } = useOrgSettings()
  const update = useUpdateOrgSettings()
  const { toast } = useToast()

  const [form,  setForm]  = useState<FormState>({ fulfillment: '', payment: '', return_: '' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setForm({
      fulfillment: settings.ebay_fulfillment_policy_id ?? '',
      payment:     settings.ebay_payment_policy_id     ?? '',
      return_:     settings.ebay_return_policy_id      ?? '',
    })
  }, [settings])

  function set(field: keyof FormState, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    try {
      await update.mutateAsync({
        ebay_fulfillment_policy_id: form.fulfillment.trim() || null,
        ebay_payment_policy_id:     form.payment.trim()     || null,
        ebay_return_policy_id:      form.return_.trim()     || null,
      })
      setSaved(true)
      toast.success('Policy IDs saved')
    } catch (err) {
      toast.error('Failed to save policy IDs', err instanceof Error ? err.message : undefined)
    }
  }

  // Allow saving if:
  //  a) settings loaded and values actually changed (normal case), OR
  //  b) settings failed/missing but user has typed something (first-time setup)
  const hasValues = !!(form.fulfillment || form.payment || form.return_)
  const isDirty = settings
    ? (form.fulfillment !== (settings.ebay_fulfillment_policy_id ?? '') ||
       form.payment     !== (settings.ebay_payment_policy_id     ?? '') ||
       form.return_     !== (settings.ebay_return_policy_id      ?? ''))
    : hasValues

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold">eBay Business Policies</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Required for listing cards. Find these in your{' '}
              <a
                href="https://www.ebay.co.uk/selling/ebaysellingtools"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                eBay Seller Hub
                <ExternalLink className="h-3 w-3" />
              </a>
              {' '}under Business Policies.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-secondary/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Fulfillment policy ID"
            value={form.fulfillment}
            onChange={e => set('fulfillment', e.target.value)}
            placeholder="12345678"
            maxLength={50}
            hint="Shipping / dispatch policy"
          />
          <Input
            label="Payment policy ID"
            value={form.payment}
            onChange={e => set('payment', e.target.value)}
            placeholder="12345678"
            maxLength={50}
            hint="How buyers pay"
          />
          <Input
            label="Return policy ID"
            value={form.return_}
            onChange={e => set('return_', e.target.value)}
            placeholder="12345678"
            maxLength={50}
            hint="Your returns terms"
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && !isDirty && (
          <span className="flex items-center gap-1.5 text-sm text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Saved
          </span>
        )}
        <Button
          onClick={() => void handleSave()}
          loading={update.isPending}
          disabled={!isDirty || isLoading}
          size="sm"
        >
          Save policy IDs
        </Button>
      </div>
    </section>
  )
}
