'use client'
// =============================================================================
// LotDetailSlideOver — right-side panel for a purchase lot
//
// Shows:
//   - Lot metadata (name, source, date, notes) with inline edit
//   - Cost stats: total, avg/card, unallocated, allocation %
//   - Visual allocation progress bar
//   - Table of cards assigned to this lot with remove action
//   - "Add Card to Lot" button that opens AddCardModal pre-filled
//
// User flow: click a lot row → slide-over opens → add cards here without
// leaving the page. The whole Add-Card flow is embedded, not navigated to.
// =============================================================================
import { useState }       from 'react'
import Image              from 'next/image'
import { Plus, Package, Pencil, X }  from 'lucide-react'
import { SlideOver }      from '@/components/ui/SlideOver'
import { Button }         from '@/components/ui/Button'
import { ConditionBadge, StatusBadge } from '@/components/ui/Badge'
import { ConfirmDialog }  from '@/components/ui/ConfirmDialog'
import { AddCardModal }   from '@/components/stock/AddCardModal'
import { useToast }       from '@/components/ui/Toast'
import { useLotCards, useRemoveCardFromLot, useUpdateLot } from '@/hooks/useLots'
import { useQueryClient } from '@tanstack/react-query'
import { cn, formatGBP }             from '@/lib/utils'
import type { PurchaseLot, Card } from '@/types'
import type { UpdateLotInput }    from '@/types/validation'

// ── Mini card row ──────────────────────────────────────────────────────────────

function CardRow({
  card,
  costPerCard,
  onRemove,
}: {
  card:        Card
  costPerCard: number
  onRemove:    (c: Card) => void
}) {
  const thumb = card.photos?.[0]?.thumb_url ?? card.photos?.[0]?.url

  return (
    <tr className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors group">
      {/* Thumbnail */}
      <td className="px-3 py-2 w-10">
        {thumb ? (
          <div className="relative h-8 w-6 rounded overflow-hidden shrink-0">
            <Image src={thumb} alt={card.card_name} fill className="object-cover" sizes="24px" />
          </div>
        ) : (
          <div className="h-8 w-6 rounded bg-secondary flex items-center justify-center text-xs text-muted-foreground select-none">
            🃏
          </div>
        )}
      </td>

      {/* Name + set */}
      <td className="px-3 py-2 min-w-0">
        <div className="font-medium text-sm text-foreground truncate leading-tight">{card.card_name}</div>
        <div className="text-xs text-muted-foreground">
          {card.set_code || '—'}{card.card_number ? ` · #${card.card_number}` : ''}
        </div>
      </td>

      {/* Condition */}
      <td className="px-3 py-2 whitespace-nowrap">
        <ConditionBadge condition={card.condition} />
      </td>

      {/* Status */}
      <td className="px-3 py-2 whitespace-nowrap">
        <StatusBadge status={card.status} />
      </td>

      {/* Cost paid */}
      <td className="px-3 py-2 text-right tabular-nums text-sm text-foreground whitespace-nowrap">
        {formatGBP(card.purchase_price)}
      </td>

      {/* Implied cost from lot */}
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
        {formatGBP(costPerCard)}
      </td>

      {/* Remove */}
      <td className="px-3 py-2 w-10">
        <button
          onClick={() => onRemove(card)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
          aria-label={`Remove ${card.card_name} from lot`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
}

// ── Stats bar ──────────────────────────────────────────────────────────────────

function AllocationBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          pct >= 100 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-primary',
        )}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

// ── Inline edit form ───────────────────────────────────────────────────────────

function LotEditForm({
  lot,
  onSave,
  onCancel,
  isPending,
}: {
  lot:       PurchaseLot
  onSave:    (input: UpdateLotInput) => void
  onCancel:  () => void
  isPending: boolean
}) {
  const [name,         setName]         = useState(lot.name)
  const [source,       setSource]       = useState(lot.source)
  const [total_cost,   setTotalCost]    = useState(String(lot.total_cost))
  const [purchased_at, setPurchasedAt]  = useState(lot.purchased_at)
  const [notes,        setNotes]        = useState(lot.notes)
  const [err,          setErr]          = useState('')

  function handleSave() {
    if (!name.trim())                            { setErr('Name is required'); return }
    const cost = parseFloat(total_cost)
    if (isNaN(cost) || cost < 0)                 { setErr('Valid cost required'); return }
    if (!purchased_at)                           { setErr('Date is required'); return }
    onSave({ name: name.trim(), source: source.trim(), total_cost: cost, purchased_at, notes: notes.trim() })
  }

  const inputCls = 'w-full px-3 py-1.5 rounded-md border border-border bg-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Lot name</label>
          <input className={inputCls} value={name} onChange={e => { setName(e.target.value); setErr('') }} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Total cost (£)</label>
          <input className={inputCls} type="number" min="0" step="0.01" value={total_cost} onChange={e => setTotalCost(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Date</label>
          <input className={inputCls} type="date" value={purchased_at} onChange={e => setPurchasedAt(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Source</label>
          <input className={inputCls} value={source} onChange={e => setSource(e.target.value)} placeholder="eBay, car boot, trade…" />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={isPending}>Cancel</Button>
        <Button size="sm" loading={isPending} onClick={handleSave}>Save changes</Button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface LotDetailSlideOverProps {
  lot:     PurchaseLot | null
  onClose: () => void
}

export function LotDetailSlideOver({ lot, onClose }: LotDetailSlideOverProps) {
  const [showAddCard,    setShowAddCard]    = useState(false)
  const [editing,        setEditing]        = useState(false)
  const [removeCard,     setRemoveCard]     = useState<Card | null>(null)
  const { toast }  = useToast()
  const qc         = useQueryClient()

  const { data: cardsData, isLoading: cardsLoading } = useLotCards(lot?.id ?? null)
  const removeFromLot = useRemoveCardFromLot(lot?.id ?? '')
  const updateLot     = useUpdateLot()

  const cards      = cardsData?.data ?? []
  const cardCount  = cards.length
  const totalCost  = lot?.total_cost ?? 0
  const allocated  = cards.reduce((s, c) => s + (c.purchase_price ?? 0), 0)
  const unalloc    = totalCost - allocated
  const allocPct   = totalCost > 0 ? Math.min(100, Math.round((allocated / totalCost) * 100)) : 0
  // Implied lot cost per card (even split of total_cost across cards)
  const lotCostPer = cardCount > 0 ? totalCost / cardCount : 0

  async function handleRemove(card: Card) {
    try {
      await removeFromLot.mutateAsync(card.id)
      toast.success('Card removed from lot', card.card_name)
      setRemoveCard(null)
    } catch (err) {
      toast.error('Failed to remove card', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleUpdate(input: UpdateLotInput) {
    if (!lot) return
    try {
      await updateLot.mutateAsync({ id: lot.id, input })
      toast.success('Lot updated')
      setEditing(false)
    } catch (err) {
      toast.error('Failed to update lot', err instanceof Error ? err.message : undefined)
    }
  }

  // Invalidate lot cards after adding a new card
  function handleCardAdded() {
    setShowAddCard(false)
    void qc.invalidateQueries({ queryKey: ['lot-cards', lot?.id] })
    void qc.invalidateQueries({ queryKey: ['lots'] })
  }

  return (
    <>
      <SlideOver
        open={lot !== null}
        onClose={onClose}
        title={lot?.name ?? ''}
        size="lg"
      >
        <div className="flex flex-col gap-6 px-6 py-6 overflow-y-auto flex-1">

          {/* ── Metadata / edit section ──────────────────────────────────── */}
          {editing && lot ? (
            <LotEditForm
              lot={lot}
              onSave={handleUpdate}
              onCancel={() => setEditing(false)}
              isPending={updateLot.isPending}
            />
          ) : (
            <div className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    {lot && new Date(lot.purchased_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {lot?.source ? ` · ${lot.source}` : ''}
                  </p>
                  {lot?.notes && (
                    <p className="text-sm text-muted-foreground">{lot.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
                  aria-label="Edit lot"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-3 pt-1">
                <div>
                  <p className="text-xs text-muted-foreground">Total cost</p>
                  <p className="text-sm font-bold">{formatGBP(totalCost)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cards</p>
                  <p className="text-sm font-bold">{cardCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cost/card</p>
                  <p className="text-sm font-bold">{cardCount > 0 ? formatGBP(lotCostPer) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Unallocated</p>
                  <p className={cn(
                    'text-sm font-bold',
                    allocPct >= 100 ? 'text-emerald-400' : unalloc > 0 ? 'text-amber-400' : 'text-foreground',
                  )}>
                    {formatGBP(Math.max(0, unalloc))}
                  </p>
                </div>
              </div>

              {/* Allocation bar */}
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Cost allocated across cards</span>
                  <span className={cn(
                    'font-medium',
                    allocPct >= 100 ? 'text-emerald-400' : allocPct >= 50 ? 'text-amber-400' : '',
                  )}>
                    {allocPct}%
                  </span>
                </div>
                <AllocationBar pct={allocPct} />
              </div>
            </div>
          )}

          {/* ── Cards section ────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Cards in this lot{cardCount > 0 ? ` (${cardCount})` : ''}
              </h3>
              <Button
                size="sm"
                variant="secondary"
                iconLeft={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setShowAddCard(true)}
              >
                Add card
              </Button>
            </div>

            {/* Loading */}
            {cardsLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-12 rounded-lg bg-secondary animate-pulse" />
                ))}
              </div>
            )}

            {/* Empty */}
            {!cardsLoading && cards.length === 0 && (
              <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-2 text-center">
                <Package className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No cards assigned yet</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Add cards to this lot to track how the purchase cost is spread across your stock.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setShowAddCard(true)}
                  className="mt-1"
                >
                  Add first card
                </Button>
              </div>
            )}

            {/* Table */}
            {!cardsLoading && cards.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Lot cards">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="w-10 px-3 py-2" aria-label="Thumb" />
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Card</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Cond</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Paid</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs" title="Even share of lot's total cost">Lot share</th>
                        <th className="w-10 px-3 py-2" aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {cards.map(card => (
                        <CardRow
                          key={card.id}
                          card={card}
                          costPerCard={lotCostPer}
                          onRemove={c => setRemoveCard(c)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Summary footer */}
                <div className="border-t border-border bg-secondary/20 px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{cardCount} card{cardCount !== 1 ? 's' : ''}</span>
                  <span>
                    Total paid: <span className="font-medium text-foreground">{formatGBP(allocated)}</span>
                    {' · '}
                    Lot total: <span className="font-medium text-foreground">{formatGBP(totalCost)}</span>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </SlideOver>

      {/* Add card modal — pre-fills the lot */}
      <AddCardModal
        open={showAddCard}
        onClose={handleCardAdded}
        defaultLotId={lot?.id}
      />

      {/* Confirm remove */}
      <ConfirmDialog
        open={removeCard !== null}
        title="Remove from lot?"
        description={`"${removeCard?.card_name}" will be unlinked from this lot. The card stays in your stock.`}
        confirmLabel="Remove"
        destructive
        loading={removeFromLot.isPending}
        onConfirm={() => { if (removeCard) void handleRemove(removeCard) }}
        onCancel={() => setRemoveCard(null)}
      />
    </>
  )
}
