'use client'
// =============================================================================
// BuyersView — buyer profiles list with total spend + purchase history drawer.
// =============================================================================
import { useState }                           from 'react'
import { Plus, Users, Search, X, Mail, Phone, Trash2, ChevronRight } from 'lucide-react'
import { useBuyers, useBuyer, useCreateBuyer, useUpdateBuyer, useDeleteBuyer } from '@/hooks/useBuyers'
import { useToast }                           from '@/components/ui/Toast'
import { Button }                             from '@/components/ui/Button'
import { Input }                              from '@/components/ui/Input'
import { cn, formatGBP }                     from '@/lib/utils'
import type { Buyer, Sale }                   from '@/types'

// ── Add / Edit buyer form ─────────────────────────────────────────────────────

interface BuyerFormState { name: string; email: string; phone: string; notes: string }
const EMPTY: BuyerFormState = { name: '', email: '', phone: '', notes: '' }

function BuyerFormModal({
  initial, isPending, onSubmit, onCancel, title,
}: {
  initial?:    Partial<BuyerFormState>
  isPending:   boolean
  onSubmit:    (f: BuyerFormState) => void
  onCancel:    () => void
  title:       string
}) {
  const [form, setForm]     = useState<BuyerFormState>({ ...EMPTY, ...initial })
  const [errors, setErrors] = useState<Partial<Record<keyof BuyerFormState, string>>>({})

  function set<K extends keyof BuyerFormState>(k: K, v: string) {
    setForm(p => ({ ...p, [k]: v }))
    if (errors[k]) setErrors(p => ({ ...p, [k]: undefined }))
  }

  function validate() {
    const e: Partial<Record<keyof BuyerFormState, string>> = {}
    if (!form.name.trim()) e.name = 'Name required'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email'
    setErrors(e)
    return !Object.keys(e).length
  }

  function onFormSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (validate()) onSubmit(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onCancel} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={onFormSubmit} className="p-5 space-y-4">
          <Input label="Full name" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. James Smith" error={errors.name} autoFocus />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="Optional" error={errors.email} />
            <Input label="Phone" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="Optional" />
          </div>
          <Input label="Notes" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any notes…" />
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            <Button type="submit" size="sm" loading={isPending}>Save</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Buyer detail slide-over ────────────────────────────────────────────────────

function BuyerDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: buyer, isLoading } = useBuyer(id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!buyer) return null

  const sales = (buyer.sales ?? []) as Sale[]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-5 border-b border-border">
        <div>
          <h2 className="text-lg font-bold">{buyer.name}</h2>
          <div className="flex items-center gap-4 mt-1">
            {buyer.email && (
              <a href={`mailto:${buyer.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Mail className="h-3 w-3" />{buyer.email}
              </a>
            )}
            {buyer.phone && (
              <a href={`tel:${buyer.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Phone className="h-3 w-3" />{buyer.phone}
              </a>
            )}
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors mt-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-0 border-b border-border">
        {[
          { label: 'Total spent', value: formatGBP(buyer.total_spent ?? 0) },
          { label: 'Purchases',   value: String(buyer.sale_count ?? 0) },
          { label: 'Last sale',   value: buyer.last_sale_at
              ? new Date(buyer.last_sale_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              : '—'
          },
        ].map(({ label, value }) => (
          <div key={label} className="px-6 py-4 text-center border-r border-border last:border-0">
            <p className="text-lg font-bold">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Purchase history */}
      <div className="flex-1 overflow-y-auto">
        {sales.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">No sales recorded yet</div>
        ) : (
          <ul className="divide-y divide-border">
            {sales.map(sale => (
              <li key={sale.id} className="flex items-center gap-3 px-6 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{sale.card_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(sale.sale_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {sale.platform && ` · ${sale.platform}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold">{formatGBP(sale.sold_price)}</p>
                  {(sale.profit ?? 0) !== 0 && (
                    <p className={cn('text-xs', sale.profit > 0 ? 'text-emerald-400' : 'text-destructive')}>
                      {sale.profit > 0 ? '+' : ''}{formatGBP(sale.profit)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Buyer card row ─────────────────────────────────────────────────────────────

function BuyerRow({ buyer, onClick }: { buyer: Buyer; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-4 px-4 py-3.5 hover:bg-secondary/60 transition-colors group"
    >
      {/* Avatar initial */}
      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-bold text-primary">{buyer.name.charAt(0).toUpperCase()}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{buyer.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {buyer.sale_count ?? 0} purchase{(buyer.sale_count ?? 0) !== 1 ? 's' : ''}
          {buyer.last_sale_at && ` · last ${new Date(buyer.last_sale_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-bold">{formatGBP(buyer.total_spent ?? 0)}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </div>
    </button>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function BuyersView() {
  const [search, setSearch]         = useState('')
  const [showAdd, setShowAdd]       = useState(false)
  const [editBuyer, setEditBuyer]   = useState<Buyer | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading }   = useBuyers(search || undefined)
  const createBuyer           = useCreateBuyer()
  const updateBuyer           = useUpdateBuyer()
  const deleteBuyer           = useDeleteBuyer()
  const { toast }             = useToast()

  const buyers     = data?.data ?? []
  const totalSpent = buyers.reduce((s, b) => s + (b.total_spent ?? 0), 0)

  async function handleCreate(form: BuyerFormState) {
    try {
      await createBuyer.mutateAsync({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), notes: form.notes.trim() })
      toast.success('Buyer added')
      setShowAdd(false)
    } catch (err) {
      toast.error('Failed to add buyer', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleUpdate(form: BuyerFormState) {
    if (!editBuyer) return
    try {
      await updateBuyer.mutateAsync({ id: editBuyer.id, input: { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), notes: form.notes.trim() } })
      toast.success('Buyer updated')
      setEditBuyer(null)
    } catch (err) {
      toast.error('Failed to update buyer', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Buyers</h1>
          {buyers.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {buyers.length} buyer{buyers.length !== 1 ? 's' : ''} · {formatGBP(totalSpent)} total spent
            </p>
          )}
        </div>
        <Button onClick={() => setShowAdd(true)} iconLeft={<Plus className="h-4 w-4" />}>
          Add Buyer
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search buyers…"
          className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-input text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="rounded-xl border border-border overflow-hidden">
          {[1,2,3].map(i => <div key={i} className="h-[64px] bg-card animate-pulse border-b border-border last:border-0" />)}
        </div>
      )}

      {/* Empty */}
      {!isLoading && buyers.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">{search ? `No buyers matching "${search}"` : 'No buyers yet'}</p>
          {!search && (
            <p className="text-sm text-muted-foreground mt-1">
              Add buyers to track purchase history and total spend over time.
            </p>
          )}
        </div>
      )}

      {/* List */}
      {buyers.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden bg-card divide-y divide-border">
          {buyers.map(buyer => (
            <BuyerRow key={buyer.id} buyer={buyer} onClick={() => setSelectedId(buyer.id)} />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <BuyerFormModal title="Add buyer" isPending={createBuyer.isPending} onSubmit={handleCreate} onCancel={() => setShowAdd(false)} />
      )}
      {editBuyer && (
        <BuyerFormModal
          title="Edit buyer"
          initial={{ name: editBuyer.name, email: editBuyer.email, phone: editBuyer.phone, notes: editBuyer.notes }}
          isPending={updateBuyer.isPending}
          onSubmit={handleUpdate}
          onCancel={() => setEditBuyer(null)}
        />
      )}

      {/* Detail slide-over */}
      {selectedId && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 bottom-0 z-40 w-full max-w-md bg-card border-l border-border shadow-2xl overflow-y-auto">
            <BuyerDetailPanel id={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        </>
      )}
    </div>
  )
}
