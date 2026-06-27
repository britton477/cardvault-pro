'use client'
// =============================================================================
// BulkAssignLotModal — lot picker for bulk "Add to Lot" action
//
// Shows a dropdown of existing lots with cost + card count stats.
// Confirms before applying so the user sees exactly what they're doing.
// =============================================================================
import { useState }      from 'react'
import * as Dialog       from '@radix-ui/react-dialog'
import { Package, X }    from 'lucide-react'
import { useLots }       from '@/hooks/useLots'
import { Button }        from '@/components/ui/Button'
import { formatGBP }     from '@/lib/utils'

interface BulkAssignLotModalProps {
  open:      boolean
  count:     number
  onClose:   () => void
  onConfirm: (lotId: string) => Promise<void>
}

export function BulkAssignLotModal({ open, count, onClose, onConfirm }: BulkAssignLotModalProps) {
  const [selectedLotId, setSelectedLotId] = useState('')
  const [isPending,     setIsPending]     = useState(false)

  const { data: lotsData } = useLots()
  const lots = lotsData?.data ?? []

  async function handleConfirm() {
    if (!selectedLotId) return
    setIsPending(true)
    try {
      await onConfirm(selectedLotId)
      setSelectedLotId('')
      onClose()
    } finally {
      setIsPending(false)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setSelectedLotId('')
      onClose()
    }
  }

  const selectedLot = lots.find(l => l.id === selectedLotId)

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-6 animate-in fade-in-0 zoom-in-95">

          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <Dialog.Title className="text-base font-semibold">
                Add to Purchase Lot
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground mt-0.5">
                Assign {count} card{count !== 1 ? 's' : ''} to a lot
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Lot picker */}
          {lots.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-2">
              <Package className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No purchase lots yet.</p>
              <p className="text-xs text-muted-foreground">Create a lot from the Purchase Lots page first.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Select lot</label>
              <select
                value={selectedLotId}
                onChange={e => setSelectedLotId(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Choose a lot…</option>
                {lots.map(lot => (
                  <option key={lot.id} value={lot.id}>
                    {lot.name} · {formatGBP(lot.total_cost)} · {lot.card_count ?? 0} cards
                  </option>
                ))}
              </select>

              {/* Selected lot summary */}
              {selectedLot && (
                <div className="rounded-lg bg-secondary/40 border border-border p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total lot cost</span>
                    <span className="font-medium">{formatGBP(selectedLot.total_cost)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cards already in lot</span>
                    <span className="font-medium">{selectedLot.card_count ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">After adding</span>
                    <span className="font-medium">{(selectedLot.card_count ?? 0) + count} cards</span>
                  </div>
                  {selectedLot.purchased_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Purchased</span>
                      <span className="font-medium">
                        {new Date(selectedLot.purchased_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!selectedLotId || isPending}
              loading={isPending}
              onClick={() => { void handleConfirm() }}
            >
              Add to lot
            </Button>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
