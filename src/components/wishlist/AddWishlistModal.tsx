'use client'
// =============================================================================
// AddWishlistModal — form to add a card to the org wishlist.
// Fields: card_name (required), set_name, variant, target_price, priority, notes.
// =============================================================================
import { useState }           from 'react'
import { X, Star }            from 'lucide-react'
import { useAddWishlistItem } from '@/hooks/useWishlist'
import { cn }                 from '@/lib/utils'
import type { WishlistPriority } from '@/types'

interface Props {
  open:    boolean
  onClose: () => void
}

const PRIORITIES: { value: WishlistPriority; label: string; colour: string }[] = [
  { value: 'low',    label: 'Low',    colour: 'text-muted-foreground' },
  { value: 'normal', label: 'Normal', colour: 'text-blue-400'         },
  { value: 'high',   label: 'High',   colour: 'text-amber-400'        },
]

export function AddWishlistModal({ open, onClose }: Props) {
  const add = useAddWishlistItem()

  const [cardName,    setCardName]    = useState('')
  const [setName,     setSetName]     = useState('')
  const [variant,     setVariant]     = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [priority,    setPriority]    = useState<WishlistPriority>('normal')
  const [notes,       setNotes]       = useState('')
  const [error,       setError]       = useState<string | null>(null)

  if (!open) return null

  function reset() {
    setCardName(''); setSetName(''); setVariant('')
    setTargetPrice(''); setPriority('normal'); setNotes(''); setError(null)
  }

  function handleClose() { reset(); onClose() }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const price = targetPrice ? parseFloat(targetPrice) : null
    if (targetPrice && (isNaN(price!) || price! < 0)) {
      setError('Target price must be a positive number.')
      return
    }

    try {
      await add.mutateAsync({
        card_name:    cardName.trim(),
        set_name:     setName.trim(),
        variant:      variant.trim(),
        target_price: price,
        priority,
        notes:        notes.trim(),
      })
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Add to Wishlist</h2>
          <button
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Card name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Card name <span className="text-destructive">*</span>
            </label>
            <input
              value={cardName}
              onChange={e => setCardName(e.target.value)}
              placeholder="e.g. Charizard"
              required
              className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Set name + variant */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Set
              </label>
              <input
                value={setName}
                onChange={e => setSetName(e.target.value)}
                placeholder="e.g. Base Set"
                className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Variant
              </label>
              <input
                value={variant}
                onChange={e => setVariant(e.target.value)}
                placeholder="e.g. Holo Rare"
                className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Target price */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Target price (max willing to pay)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-md border border-border bg-secondary/40 pl-7 pr-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 rounded-md border py-2 text-xs font-medium transition-colors',
                    priority === p.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60',
                  )}
                >
                  <Star className={cn('h-3 w-3', p.colour)} aria-hidden />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Condition preference, source, etc."
              rows={2}
              className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-md border border-border bg-secondary/40 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!cardName.trim() || add.isPending}
              className="flex-1 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {add.isPending ? 'Adding…' : 'Add to Wishlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
