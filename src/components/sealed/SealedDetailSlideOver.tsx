'use client'
// =============================================================================
// SealedDetailSlideOver — full detail panel for a single sealed product.
// Shows stock breakdown (bought/opened/sold/remaining), financials, notes.
// Footer actions:
//   • Open units  — inline qty spinner → POST /api/sealed/:id/open
//   • Edit        → EditSealedModal (rendered outside, z-[60]/[70])
//   • Delete      → ConfirmDialog
// =============================================================================
import { useState } from 'react'
import { Box, Check, Pencil, Trash2, X } from 'lucide-react'
import { useDeleteSealed, useOpenProduct } from '@/hooks/useSealed'
import { useToast } from '@/components/ui/Toast'
import { SlideOver } from '@/components/ui/SlideOver'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EditSealedModal } from '@/components/sealed/EditSealedModal'
import { cn, formatDate, formatGBP } from '@/lib/utils'
import type { SealedProduct } from '@/types'

interface SealedDetailSlideOverProps {
  product: SealedProduct | null
  onClose: () => void
}

// Compact stat block used in the inventory breakdown
function StatBlock({
  label, value, highlight,
}: { label: string; value: number | string; highlight?: 'green' | 'amber' | 'muted' }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-2.5 bg-secondary/50 min-w-[64px]">
      <span className={cn(
        'text-xl font-bold tabular-nums',
        highlight === 'green' ? 'text-green-400'
          : highlight === 'amber' ? 'text-amber-400'
          : highlight === 'muted' ? 'text-muted-foreground'
          : 'text-foreground',
      )}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
    </div>
  )
}

export function SealedDetailSlideOver({ product, onClose }: SealedDetailSlideOverProps) {
  const [showEdit,   setShowEdit]   = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showOpen,   setShowOpen]   = useState(false)
  const [openQty,    setOpenQty]    = useState('1')

  const openProduct = useOpenProduct(product?.id ?? '')
  const deleteSealed = useDeleteSealed()
  const { toast }    = useToast()

  const open = product !== null

  async function handleOpenUnits() {
    if (!product) return
    const qty = parseInt(openQty) || 0
    if (qty < 1) return
    try {
      await openProduct.mutateAsync({ qty })
      toast.success(
        `${qty} unit${qty !== 1 ? 's' : ''} opened`,
        `${product.product_name} — ${product.qty_remaining - qty} remaining`,
      )
      setShowOpen(false)
      setOpenQty('1')
    } catch (err) {
      toast.error('Failed to open units', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleDelete() {
    if (!product) return
    try {
      await deleteSealed.mutateAsync(product.id)
      toast.success('Product deleted', product.product_name)
      setShowDelete(false)
      onClose()
    } catch (err) {
      toast.error('Failed to delete product', err instanceof Error ? err.message : undefined)
    }
  }

  if (!product) return null

  const totalInvested    = product.qty_bought * product.cost_per_unit
  const remainingValue   = product.qty_remaining * product.cost_per_unit
  const qtyOpen          = parseInt(openQty) || 0
  const canOpen          = qtyOpen >= 1 && qtyOpen <= product.qty_remaining

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        title={product.product_name}
        description={[product.set_code, product.product_type].filter(Boolean).join(' · ')}
        size="md"
      >
        {/* ── Inventory breakdown ────────────────────────────────────── */}
        <div className="px-6 pt-5 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Inventory
          </p>
          <div className="flex gap-2 flex-wrap">
            <StatBlock label="Bought"    value={product.qty_bought}    />
            <StatBlock label="Opened"    value={product.qty_opened}    highlight="amber" />
            <StatBlock label="Sold"      value={product.qty_sold}      highlight="muted" />
            <StatBlock label="Remaining" value={product.qty_remaining} highlight={product.qty_remaining > 0 ? 'green' : 'muted'} />
          </div>
        </div>

        <SlideOver.Body>

          {/* Product details */}
          <SlideOver.Section title="Product details">
            <SlideOver.Field label="Name"   value={product.product_name} />
            <SlideOver.Field label="Set"    value={product.set_code || null} />
            <SlideOver.Field label="Type"   value={product.product_type} />
            <SlideOver.Field label="Source" value={product.source || null} />
          </SlideOver.Section>

          {/* Financials */}
          <SlideOver.Section title="Financials">
            <SlideOver.Field label="Cost per unit"    value={formatGBP(product.cost_per_unit)} />
            <SlideOver.Field label="Total invested"   value={
              <span className="font-medium">{formatGBP(totalInvested)}</span>
            } />
            <SlideOver.Field label="Remaining at cost" value={
              <span className={product.qty_remaining > 0 ? 'text-amber-400 font-medium' : 'text-muted-foreground'}>
                {formatGBP(remainingValue)}
              </span>
            } />
          </SlideOver.Section>

          {/* Notes */}
          {product.notes && (
            <SlideOver.Section title="Notes">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{product.notes}</p>
            </SlideOver.Section>
          )}

          <div className="text-xs text-muted-foreground space-y-0.5 pt-2 border-t border-border/50">
            <p>Added {formatDate(product.created_at)}</p>
            {product.updated_at !== product.created_at && (
              <p>Updated {formatDate(product.updated_at)}</p>
            )}
          </div>
        </SlideOver.Body>

        {/* ── Footer actions ─────────────────────────────────────────── */}
        <SlideOver.Footer>
          {showOpen ? (
            /* Inline open units entry */
            <div className="flex items-center gap-2 flex-1">
              <Input
                type="number"
                min="1"
                max={product.qty_remaining}
                value={openQty}
                onChange={e => setOpenQty(e.target.value)}
                wrapperClassName="w-24"
                aria-label="Number of units to open"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && canOpen)  void handleOpenUnits()
                  if (e.key === 'Escape') { setShowOpen(false); setOpenQty('1') }
                }}
                hint={`max ${product.qty_remaining}`}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">unit{qtyOpen !== 1 ? 's' : ''}</span>
              <Button
                size="sm"
                onClick={() => void handleOpenUnits()}
                loading={openProduct.isPending}
                disabled={!canOpen}
                iconLeft={!openProduct.isPending ? <Check className="h-3.5 w-3.5" /> : undefined}
              >
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowOpen(false); setOpenQty('1') }}
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
              {product.qty_remaining > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => { setOpenQty('1'); setShowOpen(true) }}
                  iconLeft={<Box className="h-3.5 w-3.5" />}
                >
                  Open units
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowEdit(true)}
                iconLeft={<Pencil className="h-3.5 w-3.5" />}
              >
                Edit
              </Button>
            </>
          )}
        </SlideOver.Footer>
      </SlideOver>

      {/* Rendered outside SlideOver to avoid z-index stacking issues */}
      <EditSealedModal
        product={showEdit ? product : null}
        onClose={() => setShowEdit(false)}
      />

      <ConfirmDialog
        open={showDelete}
        title="Delete product?"
        description={`"${product.product_name}" and its inventory record will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete product"
        loading={deleteSealed.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDelete(false)}
      />
    </>
  )
}
