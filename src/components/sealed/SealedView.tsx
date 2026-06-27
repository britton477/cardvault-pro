'use client'
// =============================================================================
// SealedView — Sealed Products management page.
//
// Layout: sets are the category headers; rows within each set show the
// product type as the first cell. Only types the org actually has appear.
// =============================================================================
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, AlertCircle, PackageOpen, Minus } from 'lucide-react'
import { useSealed } from '@/hooks/useSealed'
import { AddSealedModal } from '@/components/sealed/AddSealedModal'
import { SealedDetailSlideOver } from '@/components/sealed/SealedDetailSlideOver'
import { Button } from '@/components/ui/Button'
import { SkeletonTableRow, EmptyState } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { cn, formatGBP, formatNumber } from '@/lib/utils'
import type { SealedProduct, ProductType } from '@/types'

const PAGE_SIZE = 100
const COLUMNS   = 7  // Type | Bought | Opened | Remaining | Cost/unit | Total | Actions

const TYPE_PILLS: Array<ProductType | 'all'> = [
  'all', 'Booster Box', 'Elite Trainer Box', 'Booster Pack', 'Tin', 'Collection', 'Other',
]

function typeShort(t: ProductType | 'all'): string {
  if (t === 'all')               return 'All'
  if (t === 'Elite Trainer Box') return 'ETB'
  return t
}

function TypeBadge({ type }: { type: ProductType }) {
  const styles: Record<ProductType, string> = {
    'Booster Box':       'bg-blue-500/15 text-blue-400 ring-blue-500/30',
    'Elite Trainer Box': 'bg-purple-500/15 text-purple-400 ring-purple-500/30',
    'Booster Pack':      'bg-sky-500/15 text-sky-400 ring-sky-500/30',
    'Tin':               'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
    'Collection':        'bg-amber-500/15 text-amber-400 ring-amber-500/30',
    'Other':             'bg-secondary text-muted-foreground ring-border',
  }
  return (
    <span className={cn(
      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
      styles[type],
    )}>
      {typeShort(type)}
    </span>
  )
}

// Compact +/- stepper
function QtyCell({
  value,
  colour,
  onInc,
  onDec,
  decDisabled,
  pending,
}: {
  value:       number
  colour?:     string
  onInc:       () => void
  onDec:       () => void
  decDisabled: boolean
  pending:     boolean
}) {
  const btnClass = 'h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30'
  return (
    <div className="flex items-center justify-end gap-1">
      <button onClick={onDec} disabled={decDisabled || pending} className={btnClass} aria-label="Decrease">
        <Minus className="h-3 w-3" />
      </button>
      <span className={cn('tabular-nums min-w-[2ch] text-center font-medium', colour)}>
        {pending
          ? <span className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin inline-block" />
          : value}
      </span>
      <button onClick={onInc} disabled={pending} className={btnClass} aria-label="Increase">
        <Plus className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Group: a set (or "No Set") with its products ─────────────────────────────
interface SetGroup {
  /** Display name for the set (taken from the products' names) */
  setName:  string
  setCode:  string | null
  products: SealedProduct[]
}

function buildGroups(products: SealedProduct[]): SetGroup[] {
  const map = new Map<string, SetGroup>()

  for (const p of products) {
    // Key by set_code when present, otherwise by product_name
    const key = p.set_code ?? `__name__${p.product_name}`
    if (!map.has(key)) {
      map.set(key, {
        setName:  p.product_name,
        setCode:  p.set_code ?? null,
        products: [],
      })
    }
    map.get(key)!.products.push(p)
  }

  return Array.from(map.values()).sort((a, b) => {
    if (!a.setCode && b.setCode) return 1
    if (a.setCode && !b.setCode) return -1
    return a.setName.localeCompare(b.setName)
  })
}

export function SealedView() {
  const { toast }  = useToast()
  const qc         = useQueryClient()
  const [typeFilter,      setTypeFilter]      = useState<ProductType | 'all'>('all')
  const [page,            setPage]            = useState(1)
  const [showAdd,         setShowAdd]         = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<SealedProduct | null>(null)
  const [pendingIds,      setPendingIds]      = useState<Set<string>>(new Set())

  const { data, isLoading, isError } = useSealed({
    page,
    limit:        PAGE_SIZE,
    product_type: typeFilter !== 'all' ? typeFilter : undefined,
    sort:         'created_at',
    order:        'desc',
  })

  const totalPages     = data ? Math.ceil(data.count / PAGE_SIZE) : 0
  const totalInvested  = data?.data.reduce((a, p) => a + p.qty_bought * p.cost_per_unit, 0) ?? 0
  const totalRemaining = data?.data.reduce((a, p) => a + p.qty_remaining, 0) ?? 0
  const products       = data?.data ?? []
  const groups         = buildGroups(products)

  const patchProduct = useCallback(async (id: string, body: Record<string, number>) => {
    setPendingIds(prev => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/sealed/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Update failed')
      }
      void qc.invalidateQueries({ queryKey: ['sealed'] })
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : undefined)
    } finally {
      setPendingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }, [qc, toast])

  return (
    <div className="space-y-4">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sealed Products</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {formatNumber(data.count)} product{data.count !== 1 ? 's' : ''}{' · '}
              {formatNumber(totalRemaining)} units remaining{' · '}
              <span className="text-amber-400">{formatGBP(totalInvested)} invested</span>
            </p>
          )}
        </div>
        <Button onClick={() => setShowAdd(true)} iconLeft={<Plus className="h-4 w-4" />}>
          Add product
        </Button>
      </div>

      {/* ── Type filter pills ───────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {TYPE_PILLS.map(t => (
          <button
            key={t}
            onClick={() => { setTypeFilter(t); setPage(1) }}
            aria-pressed={typeFilter === t}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              typeFilter === t
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground',
            )}
          >
            {typeShort(t)}
          </button>
        ))}
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Sealed products table">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Bought</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Opened</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Remaining</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cost / unit</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Invested</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground" aria-label="Actions" />
              </tr>
            </thead>

            <tbody>
              {/* Loading */}
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <SkeletonTableRow key={i} columns={COLUMNS} />
              ))}

              {/* Error */}
              {!isLoading && isError && (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-10">
                    <div className="flex items-center justify-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      Failed to load products. Please refresh.
                    </div>
                  </td>
                </tr>
              )}

              {/* Empty */}
              {!isLoading && !isError && products.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-2">
                    <EmptyState
                      icon={<PackageOpen className="h-10 w-10" />}
                      heading="No sealed products"
                      description="Add booster boxes, ETBs, and other sealed products to track your inventory."
                      action={{ label: 'Add product', onClick: () => setShowAdd(true) }}
                      className="border-0 rounded-none py-12"
                    />
                  </td>
                </tr>
              )}

              {/* Grouped rows */}
              {!isLoading && !isError && groups.map(group => {
                const groupRemaining = group.products.reduce((a, p) => a + p.qty_remaining, 0)
                const groupInvested  = group.products.reduce((a, p) => a + p.qty_bought * p.cost_per_unit, 0)

                return (
                  <>
                    {/* ── Set header row ─────────────────────────────────── */}
                    <tr key={`group-${group.setCode ?? group.setName}`} className="bg-secondary/50 border-b border-border">
                      <td colSpan={COLUMNS} className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {/* Set code badge */}
                          {group.setCode && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-primary/15 text-primary ring-1 ring-inset ring-primary/30">
                              {group.setCode}
                            </span>
                          )}
                          {/* Set name */}
                          <span className="font-semibold text-foreground">
                            {group.setName}
                          </span>
                          {/* Meta */}
                          <span className="text-xs text-muted-foreground">
                            {group.products.length} {group.products.length === 1 ? 'type' : 'types'}
                            {' · '}
                            {formatNumber(groupRemaining)} remaining
                            {' · '}
                            <span className="text-amber-400/80">{formatGBP(groupInvested)}</span>
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* ── Product rows (one per type) ─────────────────────── */}
                    {group.products.map(product => {
                      const isPending = pendingIds.has(product.id)
                      return (
                        <tr
                          key={product.id}
                          onClick={() => setSelectedProduct(product)}
                          role="button"
                          tabIndex={0}
                          aria-label={`View: ${product.product_name} ${product.product_type}`}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedProduct(product) }}
                          className="border-b border-border hover:bg-secondary/40 transition-colors cursor-pointer"
                        >
                          {/* Type badge (first column — identifies the row within the set) */}
                          <td className="px-4 py-2.5">
                            <TypeBadge type={product.product_type} />
                          </td>

                          {/* Bought — with +/- */}
                          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                            <QtyCell
                              value={product.qty_bought}
                              pending={isPending}
                              onInc={() => void patchProduct(product.id, { qty_bought: product.qty_bought + 1 })}
                              onDec={() => void patchProduct(product.id, { qty_bought: product.qty_bought - 1 })}
                              decDisabled={product.qty_bought <= Math.max(1, product.qty_opened)}
                            />
                          </td>

                          {/* Opened — read-only */}
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <span className={product.qty_opened > 0 ? 'text-amber-400' : 'text-muted-foreground'}>
                              {product.qty_opened}
                            </span>
                          </td>

                          {/* Remaining — with +/- */}
                          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                            <QtyCell
                              value={product.qty_remaining}
                              colour={product.qty_remaining > 0 ? 'text-green-400' : 'text-muted-foreground'}
                              pending={isPending}
                              onInc={() => void patchProduct(product.id, { qty_opened: Math.max(0, product.qty_opened - 1) })}
                              onDec={() => void patchProduct(product.id, { qty_opened: product.qty_opened + 1 })}
                              decDisabled={product.qty_remaining <= 0}
                            />
                          </td>

                          {/* Cost/unit */}
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {formatGBP(product.cost_per_unit)}
                          </td>

                          {/* Total invested */}
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                            {formatGBP(product.qty_bought * product.cost_per_unit)}
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setSelectedProduct(product)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </>
                )
              })}
            </tbody>

            {/* Totals footer */}
            {!isLoading && !isError && products.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-secondary/30 font-semibold">
                  <td colSpan={3} className="px-4 py-3 text-muted-foreground text-xs">
                    Page total — {products.length} product{products.length !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-400">
                    {formatNumber(totalRemaining)}
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right tabular-nums text-amber-400">
                    {formatGBP(totalInvested)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Pagination ──────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────── */}
      <AddSealedModal open={showAdd} onClose={() => setShowAdd(false)} />

      <SealedDetailSlideOver
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />
    </div>
  )
}
