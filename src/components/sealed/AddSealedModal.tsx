'use client'
// =============================================================================
// AddSealedModal — modal for adding a new sealed product to inventory.
// Fields: product name, set code, product type, qty bought, cost per unit,
//         source, notes. Shows total invested live as qty × cost updates.
// =============================================================================
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useCreateSealed } from '@/hooks/useSealed'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { cn, formatGBP } from '@/lib/utils'
import type { ProductType } from '@/types'

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

function blankForm(): FormState {
  return {
    product_name:  '',
    set_code:      '',
    product_type:  'Booster Box',
    qty_bought:    '1',
    cost_per_unit: '',
    source:        '',
    notes:         '',
  }
}

interface AddSealedModalProps {
  open:    boolean
  onClose: () => void
}

export function AddSealedModal({ open, onClose }: AddSealedModalProps) {
  const [form, setForm] = useState<FormState>(blankForm)
  const createSealed    = useCreateSealed()
  const { toast }       = useToast()

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleClose() {
    if (!createSealed.isPending) {
      setForm(blankForm())
      onClose()
    }
  }

  // Live total invested preview
  const qty  = parseInt(form.qty_bought)       || 0
  const cost = parseFloat(form.cost_per_unit)  || 0
  const totalInvested = qty * cost

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.product_name.trim() || qty < 1 || cost <= 0) return
    try {
      await createSealed.mutateAsync({
        product_name:  form.product_name.trim(),
        set_code:      form.set_code.trim(),
        product_type:  form.product_type,
        qty_bought:    qty,
        cost_per_unit: cost,
        source:        form.source.trim(),
        notes:         form.notes.trim(),
      })
      toast.success('Product added', `${form.product_name} (×${qty})`)
      handleClose()
    } catch (err) {
      toast.error('Failed to add product', err instanceof Error ? err.message : undefined)
    }
  }

  const canSubmit = form.product_name.trim().length > 0 && qty >= 1 && cost > 0

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border bg-card shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border">
            <div>
              <Dialog.Title className="text-lg font-semibold">Add sealed product</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground mt-0.5">
                Enter the set name and type — e.g. Chaos Rising · Booster Box
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Close"
                disabled={createSealed.isPending}
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} id="add-sealed-form">
            <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">

              {/* Set name + type — these two identify the product */}
              <Input
                label="Set name"
                required
                value={form.product_name}
                onChange={e => set('product_name', e.target.value)}
                placeholder="e.g. Chaos Rising, Prismatic Evolutions"
                autoFocus
              />

              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Product type"
                  value={form.product_type}
                  onChange={e => set('product_type', e.target.value as ProductType)}
                  options={PRODUCT_TYPES.map(t => ({ value: t, label: t }))}
                />
                <Input
                  label="Set code"
                  value={form.set_code}
                  onChange={e => set('set_code', e.target.value.toUpperCase())}
                  placeholder="e.g. CRI"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Qty purchased"
                  type="number"
                  min="1"
                  max="9999"
                  required
                  value={form.qty_bought}
                  onChange={e => set('qty_bought', e.target.value)}
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
                  placeholder="0.00"
                />
              </div>

              {/* Total invested preview */}
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
                placeholder="e.g. Pokemon Center, eBay, local shop"
              />

              <Textarea
                label="Notes"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Any additional notes…"
                rows={3}
                maxLength={2000}
                showCharCount
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={createSealed.isPending}>
                Cancel
              </Button>
              <Button type="submit" loading={createSealed.isPending} disabled={!canSubmit}>
                Add product
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
