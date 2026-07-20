'use client'
// =============================================================================
// SalesView — main sales page.
//
// Brought to parity with the Stock page:
//   - Debounced search across card, set, buyer and tracking number
//   - Sortable column headers
//   - Bulk selection with status advance and delete
//   - Refunds (full and partial) with optional restock
//   - "Sync eBay orders" to pull completed orders in on demand
//   - Needs-review filter for eBay imports with no matched card
// =============================================================================
import { useState, useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus, AlertCircle, ReceiptText, Pencil, Package, CheckCheck, Check, Search,
  Undo2, RefreshCw, X as ClearIcon, AlertTriangle, Trash2, ArrowUp, ArrowDown,
  ArrowUpDown, PackageCheck,
} from 'lucide-react'
import { useSales, useDeleteSale, useSyncEbayOrders } from '@/hooks/useSales'
import { RecordSaleModal } from '@/components/sales/RecordSaleModal'
import { SaleDetailSlideOver } from '@/components/sales/SaleDetailSlideOver'
import { RefundModal } from '@/components/sales/RefundModal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { SaleStatusBadge, PlatformBadge, SkeletonTableRow, EmptyState } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { usePageHeader } from '@/components/layout/PageHeaderContext'
import { cn, formatDate, formatGBP, formatNumber } from '@/lib/utils'
import type { Sale, SaleFilters, SaleStatus } from '@/types'

const PAGE_SIZE      = 100
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
  flag:     'all',
  sort:     'sale_date',
  order:    'desc',
  page:     1,
}

// ── Sortable column header ────────────────────────────────────────────────────

function SortTh({
  children, field, filters, onSort, align = 'left', className,
}: {
  children:  React.ReactNode
  field:     SaleFilters['sort']
  filters:   SaleFilters
  onSort:    (f: SaleFilters['sort']) => void
  align?:    'left' | 'right'
  className?: string
}) {
  const active = filters.sort === field
  const Icon   = active ? (filters.order === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <th
      onClick={() => onSort(field)}
      aria-sort={active ? (filters.order === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(
        'px-4 py-3 font-medium cursor-pointer select-none transition-colors',
        align === 'right' ? 'text-right' : 'text-left',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'justify-end w-full')}>
        {children}
        <Icon className={cn('h-3 w-3 shrink-0', active ? 'opacity-100' : 'opacity-35')} />
      </span>
    </th>
  )
}

export function SalesView() {
  const { toast }      = useToast()
  const qc             = useQueryClient()
  const { setHeader }  = usePageHeader()

  const [filters,      setFilters]      = useState<SaleFilters>(DEFAULT_FILTERS)
  const [searchInput,  setSearchInput]  = useState('')
  const [showRecord,   setShowRecord]   = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [refundSale,   setRefundSale]   = useState<Sale | null>(null)
  const [editMode,     setEditMode]     = useState(false)
  const [pendingIds,   setPendingIds]   = useState<Set<string>>(new Set())
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteRestock, setDeleteRestock] = useState(false)

  const deleteSale = useDeleteSale()
  const syncOrders = useSyncEbayOrders()

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(
      () => setFilters(prev => ({ ...prev, search: searchInput, page: 1 })),
      300,
    )
    return () => clearTimeout(t)
  }, [searchInput])

  // Clear selection whenever the visible result set changes
  useEffect(() => {
    setSelectedIds(new Set())
    setDeleteConfirm(false)
  }, [filters.page, filters.status, filters.search, filters.platform, filters.flag, filters.sort, filters.order])

  // ── Query ─────────────────────────────────────────────────────────────────
  const query = {
    page:         filters.page,
    limit:        PAGE_SIZE,
    sort:         filters.sort,
    order:        filters.order,
    search:       filters.search   || undefined,
    platform:     filters.platform !== 'all' ? filters.platform : undefined,
    status:       filters.status   !== 'all' ? filters.status   : undefined,
    from:         filters.from     || undefined,
    to:           filters.to       || undefined,
    needs_review: filters.flag === 'review'   ? 'true' : undefined,
    refunded:     filters.flag === 'refunded' ? 'true' : undefined,
  }

  const { data, isLoading, isError } = useSales(query)

  const sales        = data?.data ?? []
  const totalPages   = data ? Math.ceil(data.count / PAGE_SIZE) : 0
  const totalProfit  = sales.reduce((acc, s) => acc + Number(s.profit), 0)
  const totalRevenue = sales.reduce((acc, s) => acc + Number(s.sold_price), 0)
  const totalRefunds = sales.reduce((acc, s) => acc + Number(s.refund_amount ?? 0), 0)
  const reviewCount  = sales.filter(s => s.needs_review).length

  const COLUMNS = 10   // checkbox + 8 data + actions

  // ── Header ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!data) { setHeader({ title: 'Sales' }); return }
    const count = data.count
    const subtitle = `${formatNumber(count)} sale${count !== 1 ? 's' : ''} · `
      + (totalProfit >= 0 ? '+' : '') + formatGBP(totalProfit) + ' profit'
      + (selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : '')
    setHeader({ title: 'Sales', subtitle })
  }, [data, totalProfit, selectedIds.size, setHeader])

  // ── Handlers ──────────────────────────────────────────────────────────────

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

  function handleSort(field: SaleFilters['sort']) {
    setFilters(prev => ({
      ...prev,
      sort:  field,
      order: prev.sort === field && prev.order === 'desc' ? 'asc' : 'desc',
      page:  1,
    }))
  }

  const lastSelected = useRef<string | null>(null)

  function toggleSelect(id: string, shiftKey = false) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (shiftKey && lastSelected.current) {
        const a = sales.findIndex(s => s.id === lastSelected.current)
        const b = sales.findIndex(s => s.id === id)
        if (a >= 0 && b >= 0) {
          const [from, to] = a <= b ? [a, b] : [b, a]
          sales.slice(from, to + 1).forEach(s => next.add(s.id))
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else              next.add(id)
      lastSelected.current = id
      return next
    })
  }

  async function handleBulkStatus(status: SaleStatus) {
    const ids = Array.from(selectedIds)
    let ok = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/sales/${id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sale_status: status }),
        })
        if (res.ok) ok++
      } catch { /* counted as failure below */ }
    }
    void qc.invalidateQueries({ queryKey: ['sales'] })
    setSelectedIds(new Set())
    toast.success(`${ok} sale${ok !== 1 ? 's' : ''} → ${status}`)
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    let ok = 0
    for (const id of ids) {
      try {
        await deleteSale.mutateAsync({ saleId: id, restock: deleteRestock })
        ok++
      } catch { /* counted as failure below */ }
    }
    setSelectedIds(new Set())
    setDeleteConfirm(false)
    setDeleteRestock(false)
    toast.success(
      `${ok} sale${ok !== 1 ? 's' : ''} deleted`,
      deleteRestock ? 'Cards returned to stock' : undefined,
    )
  }

  async function handleSyncOrders() {
    try {
      const res = await syncOrders.mutateAsync(7)
      const parts: string[] = []
      if (res.imported  > 0) parts.push(`${res.imported} imported`)
      if (res.linked    > 0) parts.push(`${res.linked} matched to sales you'd already recorded`)
      if (res.skipped   > 0) parts.push(`${res.skipped} already synced`)
      if (res.unmatched > 0) parts.push(`${res.unmatched} need review`)
      if (res.cancelled > 0) parts.push(`${res.cancelled} cancelled`)

      if (res.imported > 0 || res.linked > 0) {
        toast.success('eBay orders synced', parts.join(' · '))
      } else {
        toast.info('Nothing new', parts.length ? parts.join(' · ') : 'No new orders found on eBay')
      }
    } catch (err) {
      toast.error('Sync failed', err instanceof Error ? err.message : undefined)
    }
  }

  const hasActiveFilters =
    filters.platform !== 'all' || filters.status !== 'all' ||
    filters.flag !== 'all'     || !!filters.search

  return (
    <div className="space-y-4">

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
          <input
            type="search"
            placeholder="Search card, buyer, tracking…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label="Search sales"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-input text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

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

        <Select
          value={filters.status}
          onChange={e => setFilters(prev => ({ ...prev, status: e.target.value as SaleFilters['status'], page: 1 }))}
          options={[
            { value: 'all',       label: 'All statuses' },
            { value: 'Sold',      label: 'Sold' },
            { value: 'Shipped',   label: 'Shipped' },
            { value: 'Fulfilled', label: 'Fulfilled' },
          ]}
          aria-label="Filter by status"
        />

        <Select
          value={filters.flag}
          onChange={e => setFilters(prev => ({ ...prev, flag: e.target.value as SaleFilters['flag'], page: 1 }))}
          options={[
            { value: 'all',      label: 'All sales' },
            { value: 'review',   label: 'Needs review' },
            { value: 'refunded', label: 'Refunded' },
          ]}
          aria-label="Filter by flag"
        />

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilters(DEFAULT_FILTERS); setSearchInput('') }}
            iconLeft={<ClearIcon className="h-3.5 w-3.5" />}
          >
            Clear
          </Button>
        )}

        <div className="flex-1" />

        {/* Sync eBay orders */}
        <Button
          variant="secondary"
          onClick={() => { void handleSyncOrders() }}
          disabled={syncOrders.isPending}
          iconLeft={<RefreshCw className={cn('h-4 w-4', syncOrders.isPending && 'animate-spin')} />}
          title="Pull completed eBay orders into your sales"
        >
          {syncOrders.isPending ? 'Syncing…' : 'Sync eBay orders'}
        </Button>

        <Button onClick={() => setShowRecord(true)} iconLeft={<Plus className="h-4 w-4" />}>
          Record sale
        </Button>
      </div>

      {/* Needs-review nudge */}
      {reviewCount > 0 && filters.flag !== 'review' && (
        <button
          onClick={() => setFilters(prev => ({ ...prev, flag: 'review', page: 1 }))}
          className="w-full flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-left hover:bg-amber-500/10 transition-colors"
        >
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-sm text-amber-300 flex-1">
            {reviewCount} imported sale{reviewCount !== 1 ? 's' : ''} on this page couldn&apos;t be
            matched to a card — cost price is £0 until you link them.
          </span>
          <span className="text-xs text-amber-400 font-medium">Review →</span>
        </button>
      )}

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Sales table">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={sales.length > 0 && selectedIds.size === sales.length}
                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < sales.length }}
                    onChange={() => {
                      if (selectedIds.size === sales.length) setSelectedIds(new Set())
                      else setSelectedIds(new Set(sales.map(s => s.id)))
                    }}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    aria-label="Select all sales"
                  />
                </th>
                <SortTh field="card_name"  filters={filters} onSort={handleSort}>Card</SortTh>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Platform</th>
                <SortTh field="sale_date"  filters={filters} onSort={handleSort}>Date</SortTh>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <SortTh field="sold_price" filters={filters} onSort={handleSort} align="right">Sold</SortTh>
                <SortTh field="fees"       filters={filters} onSort={handleSort} align="right">Fees</SortTh>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cost</th>
                <SortTh field="profit"     filters={filters} onSort={handleSort} align="right">Profit</SortTh>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground" aria-label="Actions" />
              </tr>
            </thead>

            <tbody>
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <SkeletonTableRow key={i} columns={COLUMNS} />
              ))}

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

              {!isLoading && !isError && sales.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-2">
                    <EmptyState
                      icon={<ReceiptText className="h-10 w-10" />}
                      heading={hasActiveFilters ? 'No matching sales' : 'No sales yet'}
                      description={hasActiveFilters
                        ? 'Try clearing your filters or searching for something else.'
                        : 'Record your first sale, or sync your eBay orders to import them automatically.'}
                      action={hasActiveFilters
                        ? { label: 'Clear filters', onClick: () => { setFilters(DEFAULT_FILTERS); setSearchInput('') } }
                        : { label: 'Record sale',   onClick: () => setShowRecord(true) }}
                      className="border-0 rounded-none py-12"
                    />
                  </td>
                </tr>
              )}

              {!isLoading && !isError && sales.map(sale => {
                const isSelected = selectedIds.has(sale.id)
                const refunded   = Number(sale.refund_amount ?? 0)
                const fullyRefunded = refunded > 0 && refunded >= Number(sale.sold_price)

                return (
                  <tr
                    key={sale.id}
                    onClick={() => { setEditMode(false); setSelectedSale(sale) }}
                    role="button"
                    tabIndex={0}
                    aria-label={`View sale: ${sale.card_name}`}
                    aria-selected={isSelected}
                    onKeyDown={e => { if (e.key === 'Enter') { setEditMode(false); setSelectedSale(sale) } }}
                    className={cn(
                      'border-b border-border transition-colors cursor-pointer',
                      isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-secondary/40',
                    )}
                  >
                    {/* Selection */}
                    <td className="w-10 px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={e => { e.stopPropagation(); toggleSelect(sale.id, e.shiftKey) }}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                        aria-label={`Select ${sale.card_name}`}
                      />
                    </td>

                    {/* Card */}
                    <td className="px-4 py-2.5 max-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground truncate">{sale.card_name}</span>
                        {sale.needs_review && (
                          <span
                            title="Imported from eBay but not matched to a card — cost price unconfirmed"
                            className="rounded px-1 py-px text-[9px] font-semibold bg-amber-500/15 text-amber-400 shrink-0"
                          >
                            REVIEW
                          </span>
                        )}
                        {refunded > 0 && (
                          <span
                            title={`${formatGBP(refunded)} refunded`}
                            className={cn(
                              'rounded px-1 py-px text-[9px] font-semibold shrink-0',
                              fullyRefunded
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-amber-500/15 text-amber-400',
                            )}
                          >
                            {fullyRefunded ? 'REFUNDED' : 'PART REFUND'}
                          </span>
                        )}
                      </div>
                      {(sale.set_code || sale.card_number) && (
                        <div className="text-xs text-muted-foreground">
                          {[sale.set_code, sale.card_number ? `#${sale.card_number}` : null, sale.condition]
                            .filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {sale.buyer_name && (
                        <div className="text-xs text-muted-foreground/70 truncate">{sale.buyer_name}</div>
                      )}
                    </td>

                    <td className="px-4 py-2.5"><PlatformBadge platform={sale.platform} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatDate(sale.sale_date)}
                    </td>
                    <td className="px-4 py-2.5"><SaleStatusBadge status={sale.sale_status} /></td>

                    {/* Sold — struck through when fully refunded */}
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={cn(fullyRefunded && 'line-through text-muted-foreground')}>
                        {formatGBP(sale.sold_price)}
                      </span>
                      {refunded > 0 && !fullyRefunded && (
                        <div className="text-[10px] text-amber-400">−{formatGBP(refunded)}</div>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatGBP(Number(sale.fees) + Number(sale.shipping))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatGBP(sale.purchase_price)}
                    </td>
                    <td className={cn(
                      'px-4 py-2.5 text-right tabular-nums font-medium',
                      Number(sale.profit) >= 0 ? 'text-green-400' : 'text-red-400',
                    )}>
                      {formatGBP(sale.profit, { showSign: true })}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
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
                          const isShip = next === 'Shipped'
                          const Icon   = isShip ? Package : CheckCheck
                          return (
                            <button
                              onClick={() => { void handleQuickStatus(sale) }}
                              disabled={loading}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                                isShip
                                  ? 'border-blue-500/40 text-blue-400 hover:bg-blue-500/10'
                                  : 'border-green-500/40 text-green-400 hover:bg-green-500/10',
                              )}
                            >
                              {loading
                                ? <span className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
                                : <Icon className="h-3 w-3" />}
                              Mark {next}
                            </button>
                          )
                        })()}

                        {/* Refund */}
                        {!fullyRefunded && (
                          <button
                            onClick={() => setRefundSale(sale)}
                            title="Refund this sale"
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 text-amber-400 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/10 transition-colors"
                          >
                            <Undo2 className="h-3 w-3" />
                            Refund
                          </button>
                        )}

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
                )
              })}
            </tbody>

            {/* Totals */}
            {!isLoading && !isError && sales.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-secondary/30 font-semibold">
                  <td colSpan={5} className="px-4 py-3 text-muted-foreground text-xs">
                    Page total — {sales.length} sale{sales.length !== 1 ? 's' : ''}
                    {totalRefunds > 0 && (
                      <span className="text-amber-400"> · {formatGBP(totalRefunds)} refunded</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatGBP(totalRevenue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatGBP(sales.reduce((a, s) => a + Number(s.fees) + Number(s.shipping), 0))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatGBP(sales.reduce((a, s) => a + Number(s.purchase_price), 0))}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right tabular-nums',
                    totalProfit >= 0 ? 'text-green-400' : 'text-red-400',
                  )}>
                    {formatGBP(totalProfit, { showSign: true })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Bulk action bar ───────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-0 z-20">
          <div className="rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-semibold tabular-nums">
                {selectedIds.size} sale{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <button
                onClick={() => { setSelectedIds(new Set()); setDeleteConfirm(false) }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Clear selection"
              >
                <ClearIcon className="h-4 w-4" />
              </button>
            </div>

            {deleteConfirm ? (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Delete {selectedIds.size} sale{selectedIds.size !== 1 ? 's' : ''}?
                </span>

                {/* Restock choice — deleting a duplicate must NOT invent stock */}
                <button
                  onClick={() => setDeleteRestock(v => !v)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                    deleteRestock
                      ? 'border-teal-500/40 bg-teal-500/10 text-teal-400'
                      : 'border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  <PackageCheck className="h-3 w-3" />
                  {deleteRestock ? 'Returning cards to stock' : 'Not restocking'}
                </button>

                <button
                  onClick={() => { void handleBulkDelete() }}
                  disabled={deleteSale.isPending}
                  className="rounded px-2.5 py-1 text-xs bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30 transition-colors disabled:opacity-50"
                >
                  {deleteSale.isPending ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button
                  onClick={() => { setDeleteConfirm(false); setDeleteRestock(false) }}
                  className="rounded px-2.5 py-1 text-xs border border-border text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => { void handleBulkStatus('Shipped') }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/40 text-blue-400 px-3 py-1.5 text-sm hover:bg-blue-500/10 transition-colors"
                >
                  <Package className="h-3.5 w-3.5" />
                  Mark Shipped
                </button>
                <button
                  onClick={() => { void handleBulkStatus('Fulfilled') }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-green-500/40 text-green-400 px-3 py-1.5 text-sm hover:bg-green-500/10 transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark Fulfilled
                </button>
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 text-destructive px-3 py-1.5 text-sm hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
      <RecordSaleModal open={showRecord} onClose={() => setShowRecord(false)} />

      <RefundModal sale={refundSale} onClose={() => setRefundSale(null)} />

      <SaleDetailSlideOver
        sale={selectedSale}
        onClose={() => { setSelectedSale(null); setEditMode(false) }}
        startInEditMode={editMode}
      />
    </div>
  )
}
