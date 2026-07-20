'use client'
// =============================================================================
// RefundModal — record a full or partial refund against a sale.
//
// The sale is never rewritten: sold_price keeps what the buyer paid and the
// refund accumulates alongside it, so the history stays readable and profit
// nets the two automatically.
//
// Restocking is an explicit choice rather than something inferred from the
// amount. A full refund often means the card came back — but refund-without-
// return is common on low-value items, and a partial refund occasionally does
// accompany a return. Only the seller knows which happened.
// =============================================================================
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Undo2, AlertTriangle, PackageCheck, Loader2 } from 'lucide-react'
import { useRefundSale } from '@/hooks/useSales'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn, formatGBP } from '@/lib/utils'
import type { Sale } from '@/types'

interface Props {
  sale:    Sale | null
  onClose: () => void
}

export function RefundModal({ sale, onClose }: Props) {
  const { toast } = useToast()
  const refund    = useRefundSale()

  const [amount,  setAmount]  = useState('')
  const [reason,  setReason]  = useState('')
  const [restock, setRestock] = useState(false)

  const soldPrice       = sale ? Number(sale.sold_price) : 0
  const alreadyRefunded = sale ? Number(sale.refund_amount ?? 0) : 0
  const remaining       = Math.round((soldPrice - alreadyRefunded) * 100) / 100

  // Seed a full refund by default — the most common case — and pre-tick restock
  // to match, while leaving both freely editable.
  useEffect(() => {
    if (!sale) return
    const rem = Math.round((Number(sale.sold_price) - Number(sale.refund_amount ?? 0)) * 100) / 100
    setAmount(rem > 0 ? rem.toFixed(2) : '')
    setReason('')
    setRestock(true)
  }, [sale])

  if (!sale) return null

  const parsed      = parseFloat(amount)
  const amountValid = !isNaN(parsed) && parsed >= 0.01 && parsed <= remaining
  const isFull      = amountValid && Math.abs(parsed - remaining) < 0.005
  const canSubmit   = amountValid && !refund.isPending

  // What profit becomes once this refund lands
  const projectedProfit =
    soldPrice
    - (alreadyRefunded + (amountValid ? parsed : 0))
    - Number(sale.fees)
    - Number(sale.shipping)
    - Number(sale.purchase_price)

  async function handleSubmit() {
    if (!canSubmit || !sale) return
    try {
      const res = await refund.mutateAsync({
        saleId:  sale.id,
        amount:  parsed,
        reason:  reason.trim(),
        restock,
      })
      toast.success(
        res.is_full_refund ? 'Full refund recorded' : 'Partial refund recorded',
        res.restocked ? `${sale.card_name} returned to stock` : undefined,
      )
      onClose()
    } catch (err) {
      toast.error('Refund failed', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <Dialog.Root open={!!sale} onOpenChange={o => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl focus:outline-none">

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
            <Undo2 className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <Dialog.Title className="font-semibold text-base">Refund sale</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-0.5 truncate">
                {sale.card_name}
                {sale.set_code ? ` · ${sale.set_code}` : ''}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-4">

            {/* Sale summary */}
            <div className="rounded-lg border border-border bg-secondary/40 divide-y divide-border/60 text-sm">
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Buyer paid</span>
                <span className="tabular-nums font-medium">{formatGBP(soldPrice)}</span>
              </div>
              {alreadyRefunded > 0 && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Already refunded</span>
                  <span className="tabular-nums font-medium text-amber-400">
                    −{formatGBP(alreadyRefunded)}
                  </span>
                </div>
              )}
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Refundable remaining</span>
                <span className="tabular-nums font-medium">{formatGBP(remaining)}</span>
              </div>
            </div>

            {remaining <= 0 ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                This sale has already been refunded in full.
              </div>
            ) : (
              <>
                {/* Amount */}
                <div>
                  <Input
                    label="Refund amount"
                    type="number"
                    min="0.01"
                    max={remaining}
                    step="0.01"
                    prefix="£"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAmount(remaining.toFixed(2))}
                      className="text-xs text-primary hover:underline"
                    >
                      Full refund ({formatGBP(remaining)})
                    </button>
                    {amount && !amountValid && (
                      <span className="text-xs text-destructive">
                        Must be between £0.01 and {formatGBP(remaining)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Reason */}
                <Input
                  label="Reason (optional)"
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Damaged in post, buyer remorse, item not as described"
                />

                {/* Restock */}
                <button
                  type="button"
                  onClick={() => setRestock(v => !v)}
                  className={cn(
                    'w-full flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                    restock
                      ? 'border-teal-500/40 bg-teal-500/5'
                      : 'border-border hover:bg-secondary/40',
                  )}
                >
                  <span className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    restock ? 'bg-teal-500 border-teal-500' : 'border-border',
                  )}>
                    {restock && <PackageCheck className="h-3 w-3 text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Return card to stock</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {restock
                        ? `${sale.qty_sold} unit${sale.qty_sold !== 1 ? 's' : ''} will be added back to inventory${sale.card_id ? '' : ' — no card linked, nothing to restock'}`
                        : 'Leave off if the buyer kept the card (refund without return)'}
                    </span>
                  </span>
                </button>

                {restock && !sale.card_id && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    This sale isn&apos;t linked to a card in your stock, so nothing can be
                    restocked. The refund will still be recorded.
                  </div>
                )}

                {/* Projected profit */}
                {amountValid && (
                  <div className={cn(
                    'rounded-lg border px-3 py-2.5 text-sm flex items-center justify-between',
                    projectedProfit >= 0
                      ? 'border-border bg-secondary/40'
                      : 'border-destructive/30 bg-destructive/5',
                  )}>
                    <span className="text-muted-foreground text-xs">
                      Profit after {isFull ? 'full' : 'partial'} refund
                    </span>
                    <span className={cn(
                      'tabular-nums font-semibold',
                      projectedProfit >= 0 ? 'text-foreground' : 'text-destructive',
                    )}>
                      {projectedProfit >= 0 ? '' : '−'}{formatGBP(Math.abs(projectedProfit))}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
            <Button variant="secondary" onClick={onClose} disabled={refund.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit || remaining <= 0}
            >
              {refund.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {refund.isPending
                ? 'Recording…'
                : `Refund ${amountValid ? formatGBP(parsed) : ''}`.trim()}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
