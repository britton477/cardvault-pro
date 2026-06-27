'use client'
// =============================================================================
// EditSealedModal — pre-filled edit form for an existing sealed product.
// Accepts `product: SealedProduct | null` — null = closed.
// Note: qty_bought can be increased but not below qty_opened + qty_sold.
// =============================================================================
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useUpdateSealed } from '@/hooks/useSealed'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { cn, formatGBP } from '@/lib/utils'
import type { SealedProduct, ProductType } from '@/types'

const PRODUCT_TYPES: ProductType[] = [
  'Booster Box', 'Elite Trainer Box', 'Booster Pack', 'Tin', 'Collection', 'Other',
]

interface FormState {
  product_name:  string
  set_code:      string
  product_type:  ProductType
  qty_bought:    string
  cost_per_unit: string
  source:        string
  notes:         string
}

function productToForm(p: SealedProduct): FormState {
  return {
    product_name:  p.product_name,
    set_code:      p.set_code,
    product_type:  p.product_type,
    qty_bought:    String(p.qty_bought),
    cost_per_unit: String(p.cost_per_unit),
    source:        p.source,
    notes:         p.notes,
  }
}

interface EditSealedModalProps {
  product: SealedProduct | null   // null = closed
  onClose: () => void
}

export function EditSealedModal({ product, onClose }: EditSealedModalProps) {
  const [form, setForm]  = useState<FormState | null>(null)
  const updateSealed     = useUpdateSealed(product?.id ?? '')
  const { toast }        = useToast()

  // Sync form when product changes
  useEffect(() => {
    if (product) setForm(productToForm(product))
  }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => prev ? { ...prev, [key]: value } : prev)
  }

  const open = product !== null

  const qty  = parseInt(form?.qty_bought ?? '0')  || 0
  const cost = parseFloat(form?.cost_per_unit ?? '0') || 0
  const totalInvested = qty * cost

  // Min qty_bought is qty_opened + qty_sold (can't go below what's already been used)
  const minQty = product ? (product.qty_opened + product.qty_sold) : 1

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!product || !form) return
    if (qty < minQty) {
      toast.error('Invalid quantity', `Qty bought must be at least ${minQty} (opened + sold)`)
      return
    }
    try {
      await updateSealed.mutateAsync({
        product_name:  form.product_name.trim(),
        set_code:      form.set_code.trim(),
        product_type:  form.product_type,
        qty_bought:    qty,
        cost_per_unit: cost,
        source:        form.source.trim(),
        notes:         form.notes.trim(),
      })
      toast.success('Product updated', form.product_name)
      onClose()
    } catch (err) {
      toast.error('Failed to update product', err instanceof Error ? err.message : undefined)
    }
  }

  if (!form || !product) return null

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v && !updateSealed.isPending) onClose() }}>
      <Dialog.Portal>
        {/* z-[60]/z-[70] — sits above SealedDetailSlideOver (z-50) */}
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
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
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border">
            <div>
              <Dialog.Title className="text-lg font-semibold">Edit sealed product</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground mt-0.5">
                {product.product_name}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Close"
                disabled={updateSealed.isPending}
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
              <Input
                label="Product name"
                required
                value={form.product_name}
                onChange={e => set('product_name', e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Set code"
                  value={form.set_code}
                  onChange={e => set('set_code', e.target.value)}
                />
                <Select
                  label="Product type"
                  value={form.product_type}
                  onChange={e => set('product_type', e.target.value as ProductType)}
                  options={PRODUCT_TYPES.map(t => ({ value: t, label: t }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={`Qty purchased (min ${minQty})`}
                  type="number"
                  min={minQty}
                  required
                  value={form.qty_bought}
                  onChange={e => set('qty_bought', e.target.value)}
                  hint={minQty > 1 ? `${product.qty_opened} opened + ${product.qty_sold} sold` : undefined}
                />
                <Input
                  label="Cost per unit"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  prefix="£"
                  value={form.cost_per_unit}
                  onChange={e => set('cost_per_unit', e.target.value)}
                />
              </div>
              {totalInvested > 0 && (
                <div className="flex items-center justify-between rounded-lg px-4 py-3 bg-secondary/60 text-sm">
                  <span className="text-muted-foreground">Total invested</span>
                  <span className="font-semibold tabular-nums">{formatGBP(totalInvested)}</span>
                </div>
              )}
              <Input
                label="Source"
                value={form.source}
                onChange={e => set('source', e.target.value)}
              />
              <Textarea
                label="Notes"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                rows={3}
                maxLength={2000}
                showCharCount
              />
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <Button type="button" variant="ghost" onClick={onClose} disabled={updateSealed.isPending}>
                Cancel
              </Button>
              <Button type="submit" loading={updateSealed.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
