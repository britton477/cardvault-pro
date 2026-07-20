'use client'
// =============================================================================
// SaleDetailSlideOver — full detail panel for a single sale.
// Opened from SalesView row click.
//
// Modes:
//   View  — read-only detail + status actions + Delete
//   Edit  — inline form for all sale fields → useUpdateSale on Save
// =============================================================================
import { useState, useEffect } from 'react'
import { Check, Package, Pencil, Trash2, Truck, X, PackageCheck } from 'lucide-react'
import { useDeleteSale, useUpdateSale } from '@/hooks/useSales'
import { useToast } from '@/components/ui/Toast'
import { SlideOver } from '@/components/ui/SlideOver'
import { ConditionBadge, PlatformBadge, SaleStatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn, formatDate, formatGBP } from '@/lib/utils'
import { CONDITIONS } from '@/components/stock/cardConstants'
import type { Sale, SalePlatform, SaleStatus } from '@/types'

interface SaleDetailSlideOverProps {
  sale:             Sale | null
  onClose:          () => void
  startInEditMode?: boolean   // when true, opens directly in edit mode
}

// ── Edit form state ───────────────────────────────────────────────────────────

interface EditForm {
  card_name:       string
  set_code:        string
  card_number:     string
  condition:       string
  platform:        SalePlatform
  qty_sold:        string
  sold_price:      string
  fees:            string
  shipping:        string
  purchase_price:  string
  sale_date:       string
  sale_status:     SaleStatus
  tracking_number: string
}

function saleToForm(sale: Sale): EditForm {
  return {
    card_name:       sale.card_name,
    set_code:        sale.set_code        ?? '',
    card_number:     sale.card_number     ?? '',
    condition:       sale.condition       ?? '',
    platform:        sale.platform,
    qty_sold:        String(sale.qty_sold),
    sold_price:      String(sale.sold_price),
    fees:            String(sale.fees),
    shipping:        String(sale.shipping),
    purchase_price:  String(sale.purchase_price),
    sale_date:       sale.sale_date?.slice(0, 10) ?? '',
    sale_status:     sale.sale_status,
    tracking_number: sale.tracking_number ?? '',
  }
}

export function SaleDetailSlideOver({ sale, onClose, startInEditMode }: SaleDetailSlideOverProps) {
  const [showDelete,    setShowDelete]    = useState(false)
  const [deleteRestock, setDeleteRestock] = useState(false)
  const [showTracking,  setShowTracking]  = useState(false)
  const [trackingNum,  setTrackingNum]  = useState('')
  const [isEditing,    setIsEditing]    = useState(false)
  const [form,         setForm]         = useState<EditForm | null>(null)

  const updateSale = useUpdateSale(sale?.id ?? '')
  const deleteSale = useDeleteSale()
  const { toast }  = useToast()

  const open = sale !== null

  // Reset state whenever sale changes (new row selected)
  useEffect(() => {
    if (sale && startInEditMode) {
      setForm(saleToForm(sale))
      setIsEditing(true)
    } else {
      setIsEditing(false)
      setForm(null)
    }
    setShowTracking(false)
    setTrackingNum('')
  }, [sale?.id, startInEditMode])

  function enterEdit() {
    if (!sale) return
    setForm(saleToForm(sale))
    setIsEditing(true)
  }

  function exitEdit() {
    setIsEditing(false)
    setForm(null)
  }

  // Plain field setter — fees and shipping are entered manually, never derived.
  function setField<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm(prev => (prev ? { ...prev, [key]: value } : prev))
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleSaveEdit() {
    if (!sale || !form) return
    const soldPrice     = parseFloat(form.sold_price)    || 0
    const fees          = parseFloat(form.fees)          || 0
    const shipping      = parseFloat(form.shipping)      || 0
    const purchasePrice = parseFloat(form.purchase_price) || 0
    if (!form.card_name.trim() || soldPrice <= 0) {
      toast.error('Card name and sold price are required')
      return
    }
    try {
      await updateSale.mutateAsync({
        card_name:       form.card_name.trim(),
        set_code:        form.set_code.trim(),
        card_number:     form.card_number.trim(),
        condition:       form.condition,
        platform:        form.platform,
        qty_sold:        Math.max(1, parseInt(form.qty_sold) || 1),
        sold_price:      soldPrice,
        fees,
        shipping,
        purchase_price:  purchasePrice,
        sale_date:       form.sale_date || undefined,
        sale_status:     form.sale_status,
        tracking_number: form.tracking_number.trim() || null,
      })
      toast.success('Sale updated', form.card_name)
      exitEdit()
    } catch (err) {
      toast.error('Failed to save', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleMarkShipped() {
    if (!sale) return
    try {
      await updateSale.mutateAsync({
        sale_status:     'Shipped',
        tracking_number: trackingNum.trim() || null,
      })
      toast.success('Marked as shipped', trackingNum.trim() ? `Tracking: ${trackingNum.trim()}` : undefined)
      setShowTracking(false)
      setTrackingNum('')
    } catch (err) {
      toast.error('Failed to update sale', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleMarkFulfilled() {
    if (!sale) return
    try {
      await updateSale.mutateAsync({ sale_status: 'Fulfilled' })
      toast.success('Marked as fulfilled', sale.card_name)
    } catch (err) {
      toast.error('Failed to update sale', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleDelete() {
    if (!sale) return
    try {
      await deleteSale.mutateAsync({ saleId: sale.id, restock: deleteRestock })
      toast.success(
        'Sale deleted',
        deleteRestock ? `${sale.card_name} returned to stock` : sale.card_name,
      )
      setShowDelete(false)
      setDeleteRestock(false)
      onClose()
    } catch (err) {
      toast.error('Failed to delete sale', err instanceof Error ? err.message : undefined)
    }
  }

  if (!sale) return null

  const profit = sale.profit

  // ── Render — Edit mode ────────────────────────────────────────────────────

  if (isEditing && form) {
    const soldPrice     = parseFloat(form.sold_price)    || 0
    const fees          = parseFloat(form.fees)          || 0
    const shipping      = parseFloat(form.shipping)      || 0
    const purchasePrice = parseFloat(form.purchase_price) || 0
    // Mirrors the sales.profit generated column — a refund reduces realised
    // profit just like a fee, so the preview must net it off too.
    const refunded      = Number(sale.refund_amount ?? 0)
    const liveProfit    = soldPrice - refunded - fees - shipping - purchasePrice

    return (
      <SlideOver
        open={open}
        onClose={onClose}
        title="Edit sale"
        description={sale.card_name}
        size="md"
      >
        <SlideOver.Body>
          <div className="space-y-5">

            {/* ── Card ──────────────────────────────────────────────── */}
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Card</legend>
              <Input
                label="Card name"
                required
                value={form.card_name}
                onChange={e => setField('card_name', e.target.value)}
                placeholder="e.g. Charizard"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Set code"
                  value={form.set_code}
                  onChange={e => setField('set_code', e.target.value)}
                  placeholder="e.g. SV3"
                />
                <Input
                  label="Card number"
                  value={form.card_number}
                  onChange={e => setField('card_number', e.target.value)}
                  placeholder="e.g. 006/165"
                />
              </div>
              <Select
                label="Condition"
                value={form.condition}
                onChange={e => setField('condition', e.target.value)}
                options={[{ value: '', label: 'Not specified' }, ...CONDITIONS]}
              />
            </fieldset>

            {/* ── Sale details ──────────────────────────────────────── */}
            <fieldset className="space-y-3 border-t border-border/60 pt-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sale details</legend>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Platform"
                  value={form.platform}
                  onChange={e => setField('platform', e.target.value as SalePlatform)}
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
                  value={form.qty_sold}
                  onChange={e => setField('qty_sold', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Sale date"
                  type="date"
                  value={form.sale_date}
                  onChange={e => setField('sale_date', e.target.value)}
                />
                <Select
                  label="Status"
                  value={form.sale_status}
                  onChange={e => setField('sale_status', e.target.value as SaleStatus)}
                  options={[
                    { value: 'Sold',      label: 'Sold' },
                    { value: 'Shipped',   label: 'Shipped' },
                    { value: 'Fulfilled', label: 'Fulfilled' },
                  ]}
                />
              </div>
              <Input
                label="Tracking number"
                value={form.tracking_number}
                onChange={e => setField('tracking_number', e.target.value)}
                placeholder="Optional"
              />
            </fieldset>

            {/* ── Pricing ───────────────────────────────────────────── */}
            <fieldset className="space-y-3 border-t border-border/60 pt-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pricing</legend>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Sold price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  prefix="£"
                  value={form.sold_price}
                  onChange={e => setField('sold_price', e.target.value)}
                />
                <Input
                  label="Purchase / cost"
                  type="number"
                  min="0"
                  step="0.01"
                  prefix="£"
                  value={form.purchase_price}
                  onChange={e => setField('purchase_price', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Platform fees"
                  type="number"
                  min="0"
                  step="0.01"
                  prefix="£"
                  value={form.fees}
                  onChange={e => setField('fees', e.target.value)}
                />
                <Input
                  label="Shipping cost"
                  type="number"
                  min="0"
                  step="0.01"
                  prefix="£"
                  value={form.shipping}
                  onChange={e => setField('shipping', e.target.value)}
                />
              </div>

              {/* Refunded notice — the profit preview nets this off */}
              {Number(sale.refund_amount ?? 0) > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-2.5 text-xs text-amber-300">
                  <span>Refunded</span>
                  <span className="tabular-nums font-semibold">
                    −{formatGBP(Number(sale.refund_amount))}
                  </span>
                </div>
              )}

              {/* Live profit preview */}
              {soldPrice > 0 && (
                <div className={cn(
                  'flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium',
                  liveProfit >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
                )}>
                  <span>Estimated profit</span>
                  <span className="tabular-nums text-base font-semibold">
                    {formatGBP(liveProfit, { showSign: true })}
                  </span>
                </div>
              )}
            </fieldset>

          </div>
        </SlideOver.Body>

        <SlideOver.Footer>
          <Button variant="ghost" size="sm" onClick={exitEdit} disabled={updateSale.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSaveEdit()}
            loading={updateSale.isPending}
            disabled={!form.card_name.trim() || parseFloat(form.sold_price) <= 0}
          >
            Save changes
          </Button>
        </SlideOver.Footer>
      </SlideOver>
    )
  }

  // ── Render — View mode ────────────────────────────────────────────────────

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        title={sale.card_name}
        description={[
          sale.set_code,
          sale.card_number ? `#${sale.card_number}` : null,
          formatDate(sale.sale_date),
        ].filter(Boolean).join(' · ')}
        size="md"
      >
        {/* ── Status strip ───────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-6 pt-4 flex-wrap">
          <SaleStatusBadge status={sale.sale_status} />
          <PlatformBadge   platform={sale.platform} />
          {sale.condition && (
            <ConditionBadge condition={sale.condition as Parameters<typeof ConditionBadge>[0]['condition']} />
          )}
        </div>

        <SlideOver.Body>

          {/* ── Sale details ─────────────────────────────────────────── */}
          <SlideOver.Section title="Sale details">
            <SlideOver.Field label="Card"      value={sale.card_name} />
            <SlideOver.Field label="Set"       value={sale.set_code    || null} />
            <SlideOver.Field label="Number"    value={sale.card_number ? `#${sale.card_number}` : null} />
            <SlideOver.Field label="Condition" value={sale.condition   || null} />
            <SlideOver.Field label="Platform"  value={sale.platform} />
            <SlideOver.Field label="Qty sold"  value={sale.qty_sold} />
            <SlideOver.Field label="Sale date" value={formatDate(sale.sale_date)} />
          </SlideOver.Section>

          {/* ── Financials ───────────────────────────────────────────── */}
          <SlideOver.Section title="Financials">
            <SlideOver.Field label="Sold price"    value={formatGBP(sale.sold_price)} />
            <SlideOver.Field label="Platform fees" value={
              <span className="text-muted-foreground">{formatGBP(sale.fees)}</span>
            } />
            <SlideOver.Field label="Shipping"      value={
              <span className="text-muted-foreground">{formatGBP(sale.shipping)}</span>
            } />
            <SlideOver.Field label="Cost price"    value={
              <span className="text-muted-foreground">{formatGBP(sale.purchase_price)}</span>
            } />
            <SlideOver.Field
              label="Net profit"
              value={
                <span className={cn('font-semibold', profit >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatGBP(profit, { showSign: true })}
                </span>
              }
            />
          </SlideOver.Section>

          {/* ── Shipping ─────────────────────────────────────────────── */}
          <SlideOver.Section title="Shipping">
            <SlideOver.Field
              label="Status"
              value={<SaleStatusBadge status={sale.sale_status} />}
            />
            {sale.tracking_number ? (
              <SlideOver.Field label="Tracking number" value={sale.tracking_number} />
            ) : (
              sale.sale_status !== 'Sold' && (
                <SlideOver.Field label="Tracking number" value={
                  <span className="text-muted-foreground text-xs">Not entered</span>
                } />
              )
            )}
          </SlideOver.Section>

          <div className="text-xs text-muted-foreground space-y-0.5 pt-2 border-t border-border/50">
            <p>Recorded {formatDate(sale.created_at)}</p>
            {sale.updated_at !== sale.created_at && (
              <p>Updated {formatDate(sale.updated_at)}</p>
            )}
          </div>
        </SlideOver.Body>

        {/* ── Footer actions ─────────────────────────────────────────── */}
        <SlideOver.Footer>
          {showTracking ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                type="text"
                placeholder="Tracking number (optional)"
                value={trackingNum}
                onChange={e => setTrackingNum(e.target.value)}
                wrapperClassName="flex-1"
                aria-label="Enter tracking number"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter')  void handleMarkShipped()
                  if (e.key === 'Escape') { setShowTracking(false); setTrackingNum('') }
                }}
              />
              <Button
                size="sm"
                onClick={() => void handleMarkShipped()}
                loading={updateSale.isPending}
                iconLeft={!updateSale.isPending ? <Check className="h-3.5 w-3.5" /> : undefined}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowTracking(false); setTrackingNum('') }}
                iconLeft={<X className="h-3.5 w-3.5" />}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDelete(true)}
                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
              >
                Delete
              </Button>

              {/* Edit */}
              <Button
                variant="secondary"
                size="sm"
                onClick={enterEdit}
                iconLeft={<Pencil className="h-3.5 w-3.5" />}
              >
                Edit
              </Button>

              {/* Mark Shipped */}
              {sale.sale_status === 'Sold' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setTrackingNum(sale.tracking_number ?? '')
                    setShowTracking(true)
                  }}
                  iconLeft={<Truck className="h-3.5 w-3.5" />}
                >
                  Mark shipped
                </Button>
              )}

              {/* Mark Fulfilled */}
              {sale.sale_status === 'Shipped' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleMarkFulfilled()}
                  loading={updateSale.isPending}
                  iconLeft={!updateSale.isPending ? <Package className="h-3.5 w-3.5" /> : undefined}
                >
                  Mark fulfilled
                </Button>
              )}
            </>
          )}
        </SlideOver.Footer>
      </SlideOver>

      <ConfirmDialog
        open={showDelete}
        title="Delete sale?"
        description={
          sale.card_id
            ? `The sale record for "${sale.card_name}" will be permanently removed. This cannot be undone. Choose below whether the ${sale.qty_sold} unit${sale.qty_sold !== 1 ? 's' : ''} should go back into stock.`
            : `The sale record for "${sale.card_name}" will be permanently removed. This cannot be undone.`
        }
        confirmLabel={deleteRestock ? 'Delete and restock' : 'Delete sale'}
        loading={deleteSale.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => { setShowDelete(false); setDeleteRestock(false) }}
      >
        {/*
          Restock is an explicit choice, not inferred. Deleting a sale that never
          happened should return stock; deleting a duplicate row must not, or it
          invents inventory that does not physically exist.
        */}
        {sale.card_id && (
          <button
            type="button"
            onClick={() => setDeleteRestock(v => !v)}
            className={cn(
              'w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
              deleteRestock
                ? 'border-teal-500/40 bg-teal-500/5'
                : 'border-border hover:bg-secondary/40',
            )}
          >
            <span className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
              deleteRestock ? 'bg-teal-500 border-teal-500' : 'border-border',
            )}>
              {deleteRestock && <PackageCheck className="h-3 w-3 text-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">Return card to stock</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {deleteRestock
                  ? `${sale.qty_sold} unit${sale.qty_sold !== 1 ? 's' : ''} will be added back to inventory`
                  : 'Leave off when removing a duplicate — stock is already correct'}
              </span>
            </span>
          </button>
        )}
      </ConfirmDialog>
    </>
  )
}
