'use client'
// =============================================================================
// PurchaseLotsView — lists purchase lots with cost allocation stats.
// Clicking a lot opens LotDetailSlideOver where cards can be managed.
// Inline add form + edit/delete per row.
// =============================================================================
import { useState }                    from 'react'
import { Plus, Package, Trash2, Edit2, ChevronRight } from 'lucide-react'
import { useLots, useCreateLot, useUpdateLot, useDeleteLot } from '@/hooks/useLots'
import { LotDetailSlideOver }          from '@/components/lots/LotDetailSlideOver'
import { useToast }                    from '@/components/ui/Toast'
import { Button }                      from '@/components/ui/Button'
import { Input }                       from '@/components/ui/Input'
import { cn, formatGBP }              from '@/lib/utils'
import type { PurchaseLot }            from '@/types'

// ── Add / Edit lot modal ───────────────────────────────────────────────────────

interface LotFormState {
  name:         string
  source:       string
  total_cost:   string
  purchased_at: string
  notes:        string
}

const today = new Date().toISOString().split('T')[0] ?? ''
const EMPTY_FORM: LotFormState = { name: '', source: '', total_cost: '', purchased_at: today, notes: '' }

function LotForm({
  initial,
  isPending,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?:    Partial<LotFormState>
  isPending:   boolean
  onSubmit:    (f: LotFormState) => void
  onCancel:    () => void
  submitLabel: string
}) {
  const [form, setForm] = useState<LotFormState>({ ...EMPTY_FORM, ...initial })
  const [errors, setErrors] = useState<Partial<Record<keyof LotFormState, string>>>({})

  function set<K extends keyof LotFormState>(k: K, v: LotFormState[K]) {
    setForm(p => ({ ...p, [k]: v }))
    if (errors[k]) setErrors(p => ({ ...p, [k]: undefined }))
  }

  function validate() {
    const e: Partial<Record<keyof LotFormState, string>> = {}
    if (!form.name.trim())       e.name       = 'Name required'
    if (!form.total_cost)        e.total_cost  = 'Cost required'
    if (isNaN(parseFloat(form.total_cost)) || parseFloat(form.total_cost) < 0) e.total_cost = 'Invalid amount'
    if (!form.purchased_at)      e.purchased_at = 'Date required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (validate()) onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 rounded-xl border border-border bg-card/60">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Input
            label="Lot name"
            required
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. eBay collection purchase"
            error={errors.name}
            autoFocus
          />
        </div>
        <Input
          label="Total cost"
          required
          type="number"
          min="0"
          step="0.01"
          value={form.total_cost}
          onChange={e => set('total_cost', e.target.value)}
          placeholder="0.00"
          prefix="£"
          error={errors.total_cost}
        />
        <Input
          label="Date purchased"
          required
          type="date"
          value={form.purchased_at}
          onChange={e => set('purchased_at', e.target.value)}
          error={errors.purchased_at}
        />
        <Input
          label="Source"
          value={form.source}
          onChange={e => set('source', e.target.value)}
          placeholder="eBay, car boot, trade…"
        />
        <Input
          label="Notes"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Any notes…"
        />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" loading={isPending}>{submitLabel}</Button>
      </div>
    </form>
  )
}

// ── Lot card row ──────────────────────────────────────────────────────────────

function LotRow({ lot, onEdit, onDelete, onClick }: { lot: PurchaseLot; onEdit: (l: PurchaseLot) => void; onDelete: (l: PurchaseLot) => void; onClick: (l: PurchaseLot) => void }) {
  const cardCount    = lot.card_count    ?? 0
  const allocated    = lot.allocated_cost ?? 0
  const unallocated  = lot.total_cost - allocated
  const allocatedPct = lot.total_cost > 0 ? Math.min(100, Math.round((allocated / lot.total_cost) * 100)) : 0
  const costPerCard  = cardCount > 0 ? allocated / cardCount : 0

  return (
    <div
      className="rounded-xl border border-border bg-card p-4 space-y-3 group cursor-pointer hover:border-primary/50 hover:bg-card/80 transition-colors"
      onClick={() => onClick(lot)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick(lot) }}
      aria-label={`Open lot: ${lot.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold text-sm text-foreground truncate">{lot.name}</h3>
            {cardCount > 0 && (
              <span className="shrink-0 text-xs bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 font-medium">
                {cardCount}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date(lot.purchased_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {lot.source && ` · ${lot.source}`}
          </p>
        </div>

        {/* Actions — visible on hover */}
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); onEdit(lot) }}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Edit lot"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(lot) }}
              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Delete lot"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Total cost</p>
          <p className="text-sm font-bold">{formatGBP(lot.total_cost)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cards</p>
          <p className="text-sm font-bold">{cardCount}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Avg cost/card</p>
          <p className="text-sm font-bold">{cardCount > 0 ? formatGBP(costPerCard) : '—'}</p>
        </div>
      </div>

      {/* Allocation bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Cost allocated</span>
          <span className={cn(
            'font-medium',
            allocatedPct === 100 ? 'text-emerald-400' : allocatedPct > 50 ? 'text-amber-400' : 'text-muted-foreground',
          )}>
            {allocatedPct}% · {formatGBP(unallocated)} unallocated
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              allocatedPct === 100 ? 'bg-emerald-400' : allocatedPct > 50 ? 'bg-amber-400' : 'bg-primary',
            )}
            style={{ width: `${allocatedPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function PurchaseLotsView() {
  const { data, isLoading } = useLots()
  const createLot            = useCreateLot()
  const updateLot            = useUpdateLot()
  const deleteLot            = useDeleteLot()
  const { toast }            = useToast()

  const [showAdd,     setShowAdd]     = useState(false)
  const [editLot,     setEditLot]     = useState<PurchaseLot | null>(null)
  const [deleteId,    setDeleteId]    = useState<string | null>(null)
  const [detailLot,   setDetailLot]   = useState<PurchaseLot | null>(null)

  const lots = data?.data ?? []
  const totalCost = lots.reduce((s, l) => s + l.total_cost, 0)
  const totalCards = lots.reduce((s, l) => s + (l.card_count ?? 0), 0)

  async function handleCreate(form: LotFormState) {
    try {
      await createLot.mutateAsync({
        name:         form.name.trim(),
        source:       form.source.trim(),
        total_cost:   parseFloat(form.total_cost),
        purchased_at: form.purchased_at,
        notes:        form.notes.trim(),
      })
      toast.success('Lot created')
      setShowAdd(false)
    } catch (err) {
      toast.error('Failed to create lot', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleUpdate(form: LotFormState) {
    if (!editLot) return
    try {
      await updateLot.mutateAsync({
        id:    editLot.id,
        input: {
          name:         form.name.trim(),
          source:       form.source.trim(),
          total_cost:   parseFloat(form.total_cost),
          purchased_at: form.purchased_at,
          notes:        form.notes.trim(),
        },
      })
      toast.success('Lot updated')
      setEditLot(null)
    } catch (err) {
      toast.error('Failed to update lot', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleDelete(lot: PurchaseLot) {
    try {
      await deleteLot.mutateAsync(lot.id)
      toast.success('Lot deleted')
      setDeleteId(null)
    } catch (err) {
      toast.error('Failed to delete lot', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchase Lots</h1>
          {lots.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {lots.length} lot{lots.length !== 1 ? 's' : ''} · {formatGBP(totalCost)} total · {totalCards} cards
            </p>
          )}
        </div>
        <Button
          onClick={() => { setShowAdd(true); setEditLot(null) }}
          iconLeft={<Plus className="h-4 w-4" />}
        >
          New Lot
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <LotForm
          isPending={createLot.isPending}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create lot"
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-32 rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && lots.length === 0 && !showAdd && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-foreground">No purchase lots yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Track collection buys by recording the total cost, then assigning cards from stock.
          </p>
          <Button onClick={() => setShowAdd(true)} className="mt-4" variant="secondary">
            Create your first lot
          </Button>
        </div>
      )}

      {/* List */}
      <div className="grid gap-3">
        {lots.map(lot => (
          <div key={lot.id}>
            {editLot?.id === lot.id ? (
              <LotForm
                initial={{
                  name:         lot.name,
                  source:       lot.source,
                  total_cost:   String(lot.total_cost),
                  purchased_at: lot.purchased_at,
                  notes:        lot.notes,
                }}
                isPending={updateLot.isPending}
                onSubmit={handleUpdate}
                onCancel={() => setEditLot(null)}
                submitLabel="Save changes"
              />
            ) : deleteId === lot.id ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 flex items-center justify-between gap-4">
                <p className="text-sm text-foreground">
                  Delete <strong>{lot.name}</strong>? Cards will keep their purchase price.
                </p>
                <div className="flex gap-2 flex-shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => setDeleteId(null)}>Cancel</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={deleteLot.isPending}
                    onClick={() => { void handleDelete(lot) }}
                    className="bg-destructive hover:bg-destructive/90 border-0"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <LotRow
                lot={lot}
                onEdit={l => { setEditLot(l); setDeleteId(null) }}
                onDelete={l => { setDeleteId(l.id); setEditLot(null) }}
                onClick={l => setDetailLot(l)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Lot detail slide-over */}
      <LotDetailSlideOver
        lot={detailLot}
        onClose={() => setDetailLot(null)}
      />
    </div>
  )
}
