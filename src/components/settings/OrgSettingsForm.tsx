'use client'
// =============================================================================
// OrgSettingsForm — editable card for org-level settings.
// Fields: shop name, item location, markup %, eBay username.
// Saves independently via PATCH /api/settings/org.
// =============================================================================
import { useState, useEffect } from 'react'
import { Building2, CheckCircle2 } from 'lucide-react'
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface FormState {
  shop_name:     string
  item_location: string
  markup_pct:    string
  ebay_username: string
}

const DEFAULT: FormState = {
  shop_name:     '',
  item_location: '',
  markup_pct:    '0',
  ebay_username: '',
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
      shop_name:     settings.shop_name    ?? '',
      item_location: settings.item_location ?? '',
      markup_pct:    String(settings.markup_pct ?? 0),
      ebay_username: settings.ebay_username ?? '',
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
        shop_name:     form.shop_name.trim()     || undefined,
        item_location: form.item_location.trim() || undefined,
        markup_pct:    markupNum,
        ebay_username: form.ebay_username.trim() || undefined,
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
       form.ebay_username !== (settings.ebay_username ?? ''))
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
            hint="Applied when auto-pricing cards"
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
          Save changes
        </Button>
      </div>
    </section>
  )
}
