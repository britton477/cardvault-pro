'use client'
// =============================================================================
// RecordSaleModal — modal for recording a completed card sale.
// Can be opened from:
//   a) SalesView header ("Record sale" button)  → blank form
//   b) CardDetailSlideOver ("Record sale" CTA)  → pre-filled from card
//
// Features:
//  - eBay FVF auto-calculation (12.35% UK Trading Cards rate)
//  - Live profit preview banner
//  - Tracking number field shown when status is Shipped / Fulfilled
//  - Pre-filled card fields are read-only when opened from a card
// =============================================================================
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Calculator, X } from 'lucide-react'
import { useCreateSale } from '@/hooks/useSales'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { cn, formatGBP } from '@/lib/utils'
import { CONDITIONS } from '@/components/stock/cardConstants'
import type { Card, SalePlatform, SaleStatus } from '@/types'

// ── eBay fee calculator ───────────────────────────────────────────────────────
// UK Trading Cards category: 12.35% FVF on the sold amount
const EBAY_FVF_RATE = 0.1235

function calcEbayFees(soldPrice: number): number {
  if (soldPrice <= 0) return 0
  return Math.round(soldPrice * EBAY_FVF_RATE * 100) / 100
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  card_name:       string
  set_code:        string
  card_number:     string
  condition:       string
  platform:        SalePlatform
  qty_sold:        string
  sold_price:      string
  fees:            string
  feesAuto:        boolean    // true = fees are being auto-calculated
  shipping:        string
  purchase_price:  string
  sale_date:       string
  sale_status:     SaleStatus
  tracking_number: string
}

function blankForm(): FormState {
  return {
    card_name:       '',
    set_code:        '',
    card_number:     '',
    condition:       '',
    platform:        'eBay',
    qty_sold:        '1',
    sold_price:      '',
    fees:            '',
    feesAuto:        true,
    shipping:        '',
    purchase_price:  '',
    sale_date:       new Date().toISOString().slice(0, 10),
    sale_status:     'Sold',
    tracking_number: '',
  }
}

function cardPrefill(card: Card): Partial<FormState> {
  return {
    card_name:      card.card_name,
    set_code:       card.set_code  ?? '',
    card_number:    card.card_number ?? '',
    condition:      card.condition ?? '',
    purchase_price: card.purchase_price > 0 ? String(card.purchase_price) : '',
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface RecordSaleModalProps {
  open:         boolean
  onClose:      () => void
  /** When set, card fields are pre-filled (and read-only) from this card */
  prefill?:     Card | null
  /** Queue mode — position within a multi-card sale batch (0-based) */
  queuePos?:    number
  queueTotal?:  number
  /** Called after submit OR skip — advances to the next card in the queue */
  onNext?:      () => void
}

export function RecordSaleModal({ open, onClose, prefill, queuePos, queueTotal, onNext }: RecordSaleModalProps) {
  const [form, setForm] = useState<FormState>(blankForm)
  const createSale      = useCreateSale()
  const { toast }       = useToast()

  // ── Reset form when modal opens or prefill card changes ───────────────────
  useEffect(() => {
    if (open) {
      const base = blankForm()
      setForm(prefill ? { ...base, ...cardPrefill(prefill) } : base)
    }
  }, [open, prefill?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generic field setter with eBay auto-fee side-effect ───────────────────
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      // Recalculate eBay fees when sold_price or platform changes
      if ((key === 'sold_price' || key === 'platform') && next.feesAuto) {
        const price = parseFloat(
          key === 'sold_price' ? (value as string) : next.sold_price,
        )
        if (next.platform === 'eBay' && !isNaN(price) && price > 0) {
          next.fees = String(calcEbayFees(price))
        } else if (next.platform !== 'eBay') {
          next.fees = ''
        }
      }
      return next
    })
  }

  // Manual fee override — disables auto-calc
  function handleFeesChange(val: string) {
    setForm(prev => ({ ...prev, fees: val, feesAuto: false }))
  }

  // Re-enable auto-calc and recalculate from current sold_price
  function resetFeesAuto() {
    const price = parseFloat(form.sold_price)
    const fees  = form.platform === 'eBay' && !isNaN(price) && price > 0
      ? String(calcEbayFees(price))
      : ''
    setForm(prev => ({ ...prev, fees, feesAuto: true }))
  }

  // ── Live profit preview ───────────────────────────────────────────────────
  const soldPrice = parseFloat(form.sold_price)      || 0
  const fees      = parseFloat(form.fees)            || 0
  const shipping  = parseFloat(form.shipping)        || 0
  const costPrice = parseFloat(form.purchase_price)  || 0
  const profit    = soldPrice - fees - shipping - costPrice

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.card_name.trim() || soldPrice <= 0) return

    try {
      await createSale.mutateAsync({
        card_id:         prefill?.id,
        card_name:       form.card_name.trim(),
        set_code:        form.set_code.trim(),
        card_number:     form.card_number.trim(),
        condition:       form.condition,
        platform:        form.platform,
        qty_sold:        Math.max(1, parseInt(form.qty_sold) || 1),
        sold_price:      soldPrice,
        fees,
        shipping,
        purchase_price:  costPrice,
        sale_date:       form.sale_date || undefined,
        sale_status:     form.sale_status,
        tracking_number: form.tracking_number.trim() || null,
      })
      toast.success('Sale recorded', `${form.card_name} — ${formatGBP(soldPrice)}`)
      // In queue mode advance to the next card; otherwise close
      if (onNext) onNext()
      else        onClose()
    } catch (err) {
      toast.error('Failed to record sale', err instanceof Error ? err.message : undefined)
    }
  }

  const isFromCard   = !!prefill
  const showTracking = form.sale_status !== 'Sold'
  const canSubmit    = form.card_name.trim().length > 0 && soldPrice > 0

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v && !createSale.isPending) onClose() }}>
      <Dialog.Portal>
        {/* Overlay — z-[60] to sit above SlideOver (z-50) */}
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Content — z-[70] */}
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[70] w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border bg-card shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          )}
        >
          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border">
            <div>
              <div className="flex items-center gap-2">
                <Dialog.Title className="text-lg font-semibold">Record sale</Dialog.Title>
                {queueTotal && queueTotal > 1 && (
                  <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                    {(queuePos ?? 0) + 1} / {queueTotal}
                  </span>
                )}
              </div>
              <Dialog.Description className="text-sm text-muted-foreground mt-0.5">
                {isFromCard ? `Selling: ${prefill.card_name}` : 'Enter the details of a completed sale'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Close"
                disabled={createSale.isPending}
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* ── Scrollable body ──────────────────────────────────────── */}
          <form onSubmit={handleSubmit} id="record-sale-form">
            <div className="px-6 py-5 space-y-5 max-h-[62vh] overflow-y-auto">

              {/* ── Card section ─────────────────────────────────────── */}
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Card
                </legend>

                <Input
                  label="Card name"
                  required
                  value={form.card_name}
                  onChange={e => set('card_name', e.target.value)}
                  placeholder="e.g. Charizard"
                  disabled={isFromCard}
                />

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Set code"
                    value={form.set_code}
                    onChange={e => set('set_code', e.target.value)}
                    placeholder="e.g. SV3"
                    disabled={isFromCard}
                  />
                  <Input
                    label="Card number"
                    value={form.card_number}
                    onChange={e => set('card_number', e.target.value)}
                    placeholder="e.g. 006/165"
                    disabled={isFromCard}
                  />
                </div>

                <Select
                  label="Condition"
                  value={form.condition}
                  onChange={e => set('condition', e.target.value)}
                  options={[
                    { value: '', label: 'Not specified' },
                    ...CONDITIONS,
                  ]}
                  disabled={isFromCard}
                />
              </fieldset>

              {/* ── Sale details section ─────────────────────────────── */}
              <fieldset className="space-y-3 border-t border-border/60 pt-4">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Sale details
                </legend>

                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Platform"
                    value={form.platform}
                    onChange={e => set('platform', e.target.value as SalePlatform)}
                    options={[
                      { value: 'eBay',         label: 'eBay' },
                      { value: 'Face to Face', label: 'Face to Face' },
                      { value: 'Facebook',     label: 'Facebook' },
                      { value: 'Other',        label: 'Other' },
                    ]}
                  />
                  <Input
                    label="Qty sold"
                    type="number"
                    min="1"
                    max="9999"
                    value={form.qty_sold}
                    onChange={e => set('qty_sold', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Sale date"
                    type="date"
                    value={form.sale_date}
                    onChange={e => set('sale_date', e.target.value)}
                  />
                  <Select
                    label="Status"
                    value={form.sale_status}
                    onChange={e => set('sale_status', e.target.value as SaleStatus)}
                    options={[
                      { value: 'Sold',      label: 'Sold' },
                      { value: 'Shipped',   label: 'Shipped' },
                      { value: 'Fulfilled', label: 'Fulfilled' },
                    ]}
                  />
                </div>

                {showTracking && (
                  <Input
                    label="Tracking number"
                    value={form.tracking_number}
                    onChange={e => set('tracking_number', e.target.value)}
                    placeholder="Optional"
                  />
                )}
              </fieldset>

              {/* ── Pricing section ──────────────────────────────────── */}
              <fieldset className="space-y-3 border-t border-border/60 pt-4">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Pricing
                </legend>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Sold price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    prefix="£"
                    value={form.sold_price}
                    onChange={e => set('sold_price', e.target.value)}
                    placeholder="0.00"
                  />
                  <Input
                    label="Purchase / cost price"
                    type="number"
                    min="0"
                    step="0.01"
                    prefix="£"
                    value={form.purchase_price}
                    onChange={e => set('purchase_price', e.target.value)}
                    placeholder="0.00"
                    disabled={isFromCard && costPrice > 0}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Fees with auto-calc toggle */}
                  <div>
                    <Input
                      label="Platform fees"
                      type="number"
                      min="0"
                      step="0.01"
                      prefix="£"
                      value={form.fees}
                      onChange={e => handleFeesChange(e.target.value)}
                      placeholder="0.00"
                      hint={
                        form.feesAuto && form.platform === 'eBay'
                          ? `Auto: ${(EBAY_FVF_RATE * 100).toFixed(2)}% eBay FVF`
                          : undefined
                      }
                    />
                    {!form.feesAuto && form.platform === 'eBay' && (
                      <button
                        type="button"
                        onClick={resetFeesAuto}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Calculator className="h-3 w-3" />
                        Auto-calculate
                      </button>
                    )}
                  </div>
                  <Input
                    label="Shipping cost"
                    type="number"
                    min="0"
                    step="0.01"
                    prefix="£"
                    value={form.shipping}
                    onChange={e => set('shipping', e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                {/* Live profit preview — only shown once sold_price has a value */}
                {soldPrice > 0 && (
                  <div
                    className={cn(
                      'flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium',
                      profit >= 0
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-red-500/10 text-red-400',
                    )}
                    aria-live="polite"
                  >
                    <span>Estimated profit</span>
                    <span className="tabular-nums text-base font-semibold">
                      {formatGBP(profit, { showSign: true })}
                    </span>
                  </div>
                )}
              </fieldset>
            </div>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                onClick={onNext ?? onClose}
                disabled={createSale.isPending}
              >
                {onNext ? 'Skip' : 'Cancel'}
              </Button>
              <Button
                type="submit"
                loading={createSale.isPending}
                disabled={!canSubmit}
              >
                Record sale
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
