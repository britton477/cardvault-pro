'use client'
// =============================================================================
// SellingSettingsForm — seller fee model + Bulk Wizard batch defaults.
//
// Seller model drives the net-proceeds shown beside every price (lib/fees.ts).
// Batch defaults are the previously-hardcoded Bulk Wizard knobs, now editable
// and persisted; the wizard still lets the user override any of them per card.
// Saves via the shared PATCH /api/settings/org.
// =============================================================================
import { useState, useEffect } from 'react'
import { Tags, CheckCircle2 } from 'lucide-react'
import { useOrgSettings, useUpdateOrgSettings, toSellerModel } from '@/hooks/useSettings'
import { useToast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { NetProceeds } from '@/components/shared/NetProceeds'

interface FormState {
  seller_model:           'private' | 'business'
  fvf_pct:                string
  fvf_fixed:              string
  pricing_mode:           'market' | 'cost' | 'fixed'
  pricing_adjustment_pct: string
  default_condition:      'NM' | 'LP' | 'MP' | 'HP' | 'Sealed'
  default_source:         string
  default_language:       string
  rarity_source:          'tcg' | 'vision'
  pairing_mode:           'pairs' | 'fronts_then_backs' | 'manual'
}

const DEFAULT: FormState = {
  seller_model: 'private', fvf_pct: '0', fvf_fixed: '0',
  pricing_mode: 'market', pricing_adjustment_pct: '10',
  default_condition: 'NM', default_source: 'Bulk Wizard', default_language: 'EN',
  rarity_source: 'tcg', pairing_mode: 'pairs',
}

const PREVIEW_PRICE = 30

export function SellingSettingsForm() {
  const { data: settings, isLoading } = useOrgSettings()
  const update = useUpdateOrgSettings()
  const { toast } = useToast()

  const [form,  setForm]  = useState<FormState>(DEFAULT)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setForm({
      seller_model:           settings.seller_model ?? 'private',
      fvf_pct:                String(settings.fvf_pct ?? 0),
      fvf_fixed:              String(settings.fvf_fixed ?? 0),
      pricing_mode:           settings.pricing_mode ?? 'market',
      pricing_adjustment_pct: String(settings.pricing_adjustment_pct ?? 10),
      default_condition:      settings.default_condition ?? 'NM',
      default_source:         settings.default_source ?? 'Bulk Wizard',
      default_language:       settings.default_language ?? 'EN',
      rarity_source:          settings.rarity_source ?? 'tcg',
      pairing_mode:           settings.pairing_mode ?? 'pairs',
    })
  }, [settings])

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(f => ({ ...f, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    const fvfPct   = parseFloat(form.fvf_pct)   || 0
    const fvfFixed = parseFloat(form.fvf_fixed) || 0
    const adj      = parseFloat(form.pricing_adjustment_pct) || 0
    if (fvfPct < 0 || fvfPct > 100) { toast.error('Invalid fee %', 'FVF must be 0–100%'); return }
    try {
      await update.mutateAsync({
        seller_model:           form.seller_model,
        fvf_pct:                fvfPct,
        fvf_fixed:              fvfFixed,
        pricing_mode:           form.pricing_mode,
        pricing_adjustment_pct: adj,
        default_condition:      form.default_condition,
        default_source:         form.default_source.trim() || 'Bulk Wizard',
        default_language:       form.default_language,
        rarity_source:          form.rarity_source,
        pairing_mode:           form.pairing_mode,
      })
      setSaved(true)
      toast.success('Selling settings saved')
    } catch (err) {
      toast.error('Failed to save', err instanceof Error ? err.message : undefined)
    }
  }

  // Live preview uses the FORM's current (unsaved) seller model.
  const previewModel = toSellerModel({
    seller_model: form.seller_model,
    fvf_pct:   parseFloat(form.fvf_pct)   || 0,
    fvf_fixed: parseFloat(form.fvf_fixed) || 0,
  })

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Tags className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Selling &amp; bulk defaults</h2>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-9 rounded-md bg-secondary/50 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── Fee model ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Select
                label="Seller model"
                value={form.seller_model}
                onChange={e => set('seller_model', e.target.value as FormState['seller_model'])}
                options={[
                  { value: 'private',  label: 'Private (buyer pays fee)' },
                  { value: 'business', label: 'Business (you pay FVF)' },
                ]}
              />
              {form.seller_model === 'business' && (
                <>
                  <Input
                    label="Final value fee" type="number" min={0} max={100} step={0.1} suffix="%"
                    value={form.fvf_pct} onChange={e => set('fvf_pct', e.target.value)}
                  />
                  <Input
                    label="Fixed fee / sale" type="number" min={0} step={0.01} prefix="£"
                    value={form.fvf_fixed} onChange={e => set('fvf_fixed', e.target.value)}
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-2 rounded-md bg-secondary/40 border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">On a £{PREVIEW_PRICE} listing:</span>
              <NetProceeds listPrice={PREVIEW_PRICE} sellerModel={previewModel} />
            </div>
          </div>

          {/* ── Bulk Wizard defaults ──────────────────────────────────── */}
          <div className="pt-2 border-t border-border space-y-1">
            <p className="text-sm font-medium text-foreground">Bulk Wizard defaults</p>
            <p className="text-xs text-muted-foreground">Starting points for a new batch — every card can still be overridden individually.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Pricing" value={form.pricing_mode}
              onChange={e => set('pricing_mode', e.target.value as FormState['pricing_mode'])}
              options={[
                { value: 'market', label: 'Market (eBay median)' },
                { value: 'cost',   label: 'Cost-plus (markup)' },
              ]}
            />
            <Input
              label="Market adjustment" type="number" step={1} suffix="%"
              value={form.pricing_adjustment_pct} onChange={e => set('pricing_adjustment_pct', e.target.value)}
              hint="+10 = list 10% above median"
            />
            <Select
              label="Rarity source" value={form.rarity_source}
              onChange={e => set('rarity_source', e.target.value as FormState['rarity_source'])}
              options={[
                { value: 'tcg',    label: 'TCG database (accurate)' },
                { value: 'vision', label: 'AI vision only' },
              ]}
            />
            <Select
              label="Default condition" value={form.default_condition}
              onChange={e => set('default_condition', e.target.value as FormState['default_condition'])}
              options={[
                { value: 'NM', label: 'NM' }, { value: 'LP', label: 'LP' },
                { value: 'MP', label: 'MP' }, { value: 'HP', label: 'HP' },
              ]}
            />
            <Select
              label="Photo pairing" value={form.pairing_mode}
              onChange={e => set('pairing_mode', e.target.value as FormState['pairing_mode'])}
              options={[
                { value: 'pairs',  label: 'Front + back pairs' },
                { value: 'manual', label: 'One photo per card' },
              ]}
            />
            <Input
              label="Default source"
              value={form.default_source} onChange={e => set('default_source', e.target.value)}
              maxLength={200}
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        <Button onClick={() => void handleSave()} loading={update.isPending} disabled={isLoading} size="sm">
          Save changes
        </Button>
      </div>
    </section>
  )
}
