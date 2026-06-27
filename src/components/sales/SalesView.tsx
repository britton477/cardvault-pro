'use client'
// =============================================================================
// SalesView — main sales page: filter bar, table, modals.
// Wires:
//   "Record sale" button     → RecordSaleModal (blank)
//   Table row click / Edit   → SaleDetailSlideOver
//   Quick-status button      → inline PATCH (Sold→Shipped→Fulfilled)
//   SaleDetailSlideOver      → useUpdateSale / useDeleteSale
// =============================================================================
import { useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, AlertCircle, ReceiptText, Pencil, Package, CheckCheck, Check } from 'lucide-react'
import { useSales } from '@/hooks/useSales'
import { RecordSaleModal } from '@/components/sales/RecordSaleModal'
import { SaleDetailSlideOver } from '@/components/sales/SaleDetailSlideOver'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { SaleStatusBadge, PlatformBadge, SkeletonTableRow, EmptyState } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { usePageHeader } from '@/components/layout/PageHeaderContext'
import { cn, formatDate, formatGBP, formatNumber } from '@/lib/utils'
import type { Sale, SaleFilters, SaleStatus } from '@/types'

const PAGE_SIZE      = 100
const COLUMNS        = 9   // +1 for Actions column
const PLATFORM_PILLS = ['all', 'eBay', 'Face to Face', 'Facebook', 'Other'] as const

// Status progression: Sold → Shipped → Fulfilled
const NEXT_STATUS: Record<SaleStatus, SaleStatus | null> = {
  Sold:      'Shipped',
  Shipped:   'Fulfilled',
  Fulfilled: null,
}

const DEFAULT_FILTERS: SaleFilters = {
  search:   '',
  platform: 'all',
  status:   'all',
  from:     '',
  to:       '',
  page:     1,
}

export function SalesView() {
  const { toast }      = useToast()
  const qc             = useQueryClient()
  const { setHeader }  = usePageHeader()
  const [filters,      setFilters]      = useState<SaleFilters>(DEFAULT_FILTERS)
  const [showRecord,   setShowRecord]   = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [editMode,     setEditMode]     = useState(false)
  const [pendingIds,   setPendingIds]   = useState<Set<string>>(new Set())

  // One-click status advance: Sold→Shipped→Fulfilled
  const handleQuickStatus = useCallback(async (sale: Sale) => {
    const next = NEXT_STATUS[sale.sale_status]
    if (!next) return
    setPendingIds(prev => new Set(prev).add(sale.id))
    try {
      const res = await fetch(`/api/sales/${sale.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sale_status: next }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? 'Update failed')
      }
      void qc.invalidateQueries({ queryKey: ['sales'] })
      toast.success(`${sale.card_name} → ${next}`)
    } catch (err) {
      toast.error('Status update failed', err instanceof Error ? err.message : undefined)
    } finally {
      setPendingIds(prev => { const s = new Set(prev); s.delete(sale.id); return s })
    }
  }, [qc, toast])

  // Build query params from filter state
  const query = {
    page:     filters.page,
    limit:    PAGE_SIZE,
    sort:     'sale_date',
    order:    'desc',
    platform: filters.platform !== 'all' ? filters.platform : undefined,
    status:   filters.status   !== 'all' ? filters.status   : undefined,
    from:     filters.from     || undefined,
    to:       filters.to       || undefined,
  }

  const { data, isLoading, isError } = useSales(query)

  const totalPages   = data ? Math.ceil(data.count / PAGE_SIZE) : 0
  const totalProfit  = data?.data.reduce((acc, s) => acc + s.profit,     0) ?? 0
  const totalRevenue = data?.data.reduce((acc, s) => acc + s.sold_price, 0) ?? 0

  // Sync header context
  useEffect(() => {
    if (!data) { setHeader({ title: 'Sales' }); return }
    const count    = data.count
    const subtitle = `${formatNumber(count)} sale${count !== 1 ? 's' : ''} · `
      + (totalProfit >= 0 ? '+' : '') + formatGBP(totalProfit) + ' profit'
    setHeader({ title: 'Sales', subtitle })
  }, [data, totalProfit, setHeader])

  return (
    <div className="space-y-4">

      {/* ── Filter bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Platform pills */}
        {PLATFORM_PILLS.map(p => (
          <button
            key={p}
            onClick={() => setFilters(prev => ({ ...prev, platform: p, page: 1 }))}
            aria-pressed={filters.platform === p}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              filters.platform === p
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground',
            )}
          >
            {p === 'all' ? 'All platforms' : p}
          </button>
        ))}

        {/* Status filter */}
        <Select
          value={filters.status}
          onChange={e =>
            setFilters(prev => ({ ...prev, status: e.target.value as SaleFilters['status'], page: 1 }))
          }
          options={[
            { value: 'all',       label: 'All statuses' },
            { value: 'Sold',      label: 'Sold' },
            { value: 'Shipped',   label: 'Shipped' },
            { value: 'Fulfilled', label: 'Fulfilled' },
          ]}
          aria-label="Filter by status"
        />

        <Button
          onClick={() => setShowRecord(true)}
          iconLeft={<Plus className="h-4 w-4" />}
        >
          Record sale
        </Button>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Sales table">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Card</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Platform</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Sold</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Fees</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cost</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Profit</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground" aria-label="Actions" />
              </tr>
            </thead>

            <tbody>
              {/* Loading */}
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <SkeletonTableRow key={i} columns={COLUMNS} />
              ))}

              {/* Error */}
              {!isLoading && isError && (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-10">
                    <div className="flex items-center justify-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      Failed to load sales. Please refresh and try again.
                    </div>
                  </td>
                </tr>
              )}

              {/* Empty */}
              {!isLoading && !isError && !data?.data.length && (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-2">
                    <EmptyState
                      icon={<ReceiptText className="h-10 w-10" />}
                      heading="No sales yet"
                      description="Record your first sale to start tracking profit."
                      action={{ label: 'Record sale', onClick: () => setShowRecord(true) }}
                      className="border-0 rounded-none py-12"
                    />
                  </td>
                </tr>
              )}

              {/* Data rows */}
              {!isLoading && !isError && data?.data.map(sale => (
                <tr
                  key={sale.id}
                  onClick={() => { setEditMode(false); setSelectedSale(sale) }}
                  role="button"
                  tabIndex={0}
                  aria-label={`View sale: ${sale.card_name}`}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setEditMode(false); setSelectedSale(sale) } }}
                  className="border-b border-border hover:bg-secondary/40 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2.5 max-w-[200px]">
                    <div className="font-medium text-foreground truncate">{sale.card_name}</div>
                    {(sale.set_code || sale.card_number) && (
                      <div className="text-xs text-muted-foreground">
                        {[sale.set_code, sale.card_number ? `#${sale.card_number}` : null, sale.condition]
                          .filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <PlatformBadge platform={sale.platform} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                    {formatDate(sale.sale_date)}
                  </td>
                  <td className="px-4 py-2.5">
                    <SaleStatusBadge status={sale.sale_status} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatGBP(sale.sold_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatGBP(sale.fees + sale.shipping)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatGBP(sale.purchase_price)}
                  </td>
                  <td className={cn(
                    'px-4 py-2.5 text-right tabular-nums font-medium',
                    sale.profit >= 0 ? 'text-green-400' : 'text-red-400',
                  )}>
                    {formatGBP(sale.profit, { showSign: true })}
                  </td>

                  {/* ── Inline actions ──────────────────────────────────── */}
                  <td
                    className="px-3 py-2 text-right whitespace-nowrap"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Status-advance button */}
                      {(() => {
                        const next    = NEXT_STATUS[sale.sale_status]
                        const loading = pendingIds.has(sale.id)
                        if (!next) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground/50 select-none">
                              <Check className="h-3 w-3" />
                              Complete
                            </span>
                          )
                        }
                        const isShip   = next === 'Shipped'
                        const btnClass = isShip
                          ? 'border-blue-500/40 text-blue-400 hover:bg-blue-500/10'
                          : 'border-green-500/40 text-green-400 hover:bg-green-500/10'
                        const Icon = isShip ? Package : CheckCheck
                        return (
                          <button
                            onClick={() => { void handleQuickStatus(sale) }}
                            disabled={loading}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                              btnClass,
                            )}
                          >
                            {loading ? (
                              <span className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
                            ) : (
                              <Icon className="h-3 w-3" />
                            )}
                            Mark {next}
                          </button>
                        )
                      })()}

                      {/* Edit button — opens slide-over directly in edit mode */}
                      <button
                        onClick={() => { setEditMode(true); setSelectedSale(sale) }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        aria-label={`Edit ${sale.card_name}`}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Totals footer */}
            {!isLoading && !isError && (data?.data.length ?? 0) > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-secondary/30 font-semibold">
                  <td colSpan={5} className="px-4 py-3 text-muted-foreground text-xs">
                    Page total — {data!.data.length} sale{data!.data.length !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatGBP(totalRevenue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatGBP(data!.data.reduce((a, s) => a + s.fees + s.shipping, 0))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatGBP(data!.data.reduce((a, s) => a + s.purchase_price, 0))}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right tabular-nums',
                    totalProfit >= 0 ? 'text-green-400' : 'text-red-400',
                  )}>
                    {formatGBP(totalProfit, { showSign: true })}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFilters(prev => ({ ...prev, page: prev.page - 1 }))}
            disabled={filters.page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {filters.page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))}
            disabled={filters.page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <RecordSaleModal
        open={showRecord}
        onClose={() => setShowRecord(false)}
      />

      <SaleDetailSlideOver
        sale={selectedSale}
        onClose={() => { setSelectedSale(null); setEditMode(false) }}
        startInEditMode={editMode}
      />
    </div>
  )
}
