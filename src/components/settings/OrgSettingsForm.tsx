'use client'
// =============================================================================
// OrgSettingsForm — editable card for org-level settings.
// Fields: shop name, item location, markup %, eBay username.
// Saves independently via PATCH /api/settings/org.
// =============================================================================
import { useState, useEffect } from 'react'
import { Building2, CheckCircle2, RotateCcw, Info } from 'lucide-react'
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { DEFAULT_SET_LISTING_TEMPLATE } from '@/lib/listing-templates'

interface FormState {
  shop_name:            string
  item_location:        string
  markup_pct:           string
  ebay_username:        string
  set_listing_template: string
}

const DEFAULT: FormState = {
  shop_name:            '',
  item_location:        '',
  markup_pct:           '0',
  ebay_username:        '',
  set_listing_template: '',
}

export function OrgSettingsForm() {
  const { data: settings, isLoading } = useOrgSettings()
  const update = useUpdateOrgSettings()
  const { toast } = useToast()

  const [form,  setForm]  = useState<FormState>(DEFAULT)
  const [saved, setSaved] = useState(false)

  // Populate form when settings load
  useEffect(() => {
    if (!settings) return
    setForm({
      shop_name:            settings.shop_name    ?? '',
      item_location:        settings.item_location ?? '',
      markup_pct:           String(settings.markup_pct ?? 0),
      ebay_username:        settings.ebay_username ?? '',
      // Empty means "use the built-in default" — show it so the user can see
      // and edit the actual text rather than an empty box.
      set_listing_template: settings.set_listing_template ?? DEFAULT_SET_LISTING_TEMPLATE,
    })
  }, [settings])

  function set(field: keyof FormState, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    const markupNum = parseFloat(form.markup_pct)
    if (isNaN(markupNum) || markupNum < 0 || markupNum > 500) {
      toast.error('Invalid markup', 'Markup must be between 0 and 500%')
      return
    }
    try {
      await update.mutateAsync({
        shop_name:            form.shop_name.trim()     || undefined,
        item_location:        form.item_location.trim() || undefined,
        markup_pct:           markupNum,
        ebay_username:        form.ebay_username.trim() || undefined,
        set_listing_template: form.set_listing_template.trim() || null,
      })
      setSaved(true)
      toast.success('Settings saved')
    } catch (err) {
      toast.error('Failed to save settings', err instanceof Error ? err.message : undefined)
    }
  }

  const valuesChanged = settings
    ? (form.shop_name     !== (settings.shop_name     ?? '') ||
       form.item_location !== (settings.item_location ?? '') ||
       form.markup_pct    !== String(settings.markup_pct ?? 0) ||
       form.ebay_username !== (settings.ebay_username ?? '') ||
       form.set_listing_template !== (settings.set_listing_template ?? DEFAULT_SET_LISTING_TEMPLATE))
    : !!(form.shop_name || form.item_location || form.ebay_username)
  const isDirty = valuesChanged

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Organisation</h2>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-secondary/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Shop name"
            value={form.shop_name}
            onChange={e => set('shop_name', e.target.value)}
            placeholder="VaultHunters TCG"
            maxLength={200}
          />
          <Input
            label="eBay username"
            value={form.ebay_username}
            onChange={e => set('ebay_username', e.target.value)}
            placeholder="vaulthunters_tcg"
            maxLength={100}
          />
          <Input
            label="Item location"
            value={form.item_location}
            onChange={e => set('item_location', e.target.value)}
            placeholder="United Kingdom"
            maxLength={100}
            hint="Shown on eBay listings"
          />
          <Input
            label="Default markup %"
            type="number"
            min={0}
            max={500}
            step={1}
            value={form.markup_pct}
            onChange={e => set('markup_pct', e.target.value)}
            suffix="%"
            hint="Fallback when a card has no eBay comparables"
          />
        </div>
      )}

      {/* ── Set listing description template ──────────────────────────── */}
      {!isLoading && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between gap-2">
            <div>
              <label className="text-sm font-medium text-foreground">
                Set listing description
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Reused for every &ldquo;Complete Your Set&rdquo; listing. Editable per listing
                before publishing.
              </p>
            </div>
            <button
              type="button"
              onClick={() => set('set_listing_template', DEFAULT_SET_LISTING_TEMPLATE)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
            >
              <RotateCcw className="h-3 w-3" />
              Restore default
            </button>
          </div>

          <textarea
            value={form.set_listing_template}
            onChange={e => set('set_listing_template', e.target.value)}
            rows={14}
            maxLength={8000}
            className={cn(
              'w-full rounded-md border border-border bg-input px-3 py-2',
              'text-xs font-mono leading-relaxed text-foreground resize-y',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          />

          <div className="flex items-start gap-2 rounded-md bg-secondary/40 border border-border px-3 py-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Placeholders are filled in automatically:{' '}
              <code className="text-primary">{'{SET}'}</code> becomes the set name,{' '}
              <code className="text-primary">{'{CONDITION}'}</code> the listing condition
              (e.g. Near Mint), and{' '}
              <code className="text-primary">{'{SHOP}'}</code> your shop name.
              Avoid links or contact details — eBay does not allow them in descriptions.
            </p>
          </div>
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
          Save changes
        </Button>
      </div>
    </section>
  )
}
