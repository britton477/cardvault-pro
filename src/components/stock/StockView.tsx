'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams }                   from 'next/navigation'
import { Search, Plus, SlidersHorizontal, X as ClearIcon, Hash, ShoppingBag, Tag, Layers } from 'lucide-react'
import { useQueryClient }                    from '@tanstack/react-query'
import { useCards, useBulkCardAction }      from '@/hooks/useCards'
import { useBulkEbayList }                   from '@/hooks/useEbayListings'
import { StockTable }                        from '@/components/stock/StockTable'
import { AddCardModal }                      from '@/components/stock/AddCardModal'
import { EditCardModal }                     from '@/components/stock/EditCardModal'
import { CardDetailSlideOver }               from '@/components/stock/CardDetailSlideOver'
import { BulkActionBar }                     from '@/components/stock/BulkActionBar'
import { BulkEbayModal }                     from '@/components/stock/BulkEbayModal'
import { EbayListModal }                     from '@/components/stock/EbayListModal'
import { useOrgSettings }                    from '@/hooks/useSettings'
import { BulkAssignLotModal }               from '@/components/stock/BulkAssignLotModal'
import { CreateSetListingModal }             from '@/components/stock/CreateSetListingModal'
import { RecordSaleModal }                   from '@/components/sales/RecordSaleModal'
import { Button }                            from '@/components/ui/Button'
import { Input }                             from '@/components/ui/Input'
import { Select }                            from '@/components/ui/Select'
import { useToast }                          from '@/components/ui/Toast'
import { usePageHeader }                      from '@/components/layout/PageHeaderContext'
import { cn, formatNumber }                  from '@/lib/utils'
import type { StockFilters, CardStatus, CardCondition, Card } from '@/types'

const DEFAULT_FILTERS: StockFilters = {
  search:    '',
  status:    'all',
  set_code:  '',
  condition: 'all',
  listing:   'all',
  sort:      'created_at',
  order:     'desc',
  page:      1,
}

// Listing-type tabs.
//
// 'All' is kept as the default and first option deliberately: cards that are
// In Stock have no listing type yet, so a two-tab Individual/Set split would
// hide unlisted stock entirely — which is most of what you work with day to day.
const LISTING_TABS = [
  { id: 'all'       as const, label: 'All stock' },
  { id: 'single'    as const, label: 'Individual listings' },
  { id: 'variation' as const, label: 'Set listings' },
]

const PAGE_SIZE = 100
const STATUS_PILLS = ['all', 'In Stock', 'Listed', 'Sold'] as const

const SORT_OPTIONS = [
  { value: 'created_at-desc',      label: 'Newest first'  },
  { value: 'created_at-asc',       label: 'Oldest first'  },
  { value: 'card_name-asc',        label: 'Name A–Z'      },
  { value: 'card_name-desc',       label: 'Name Z–A'      },
  { value: 'card_number-asc',      label: 'Card # ↑'      },
  { value: 'card_number-desc',     label: 'Card # ↓'      },
  { value: 'purchase_price-desc',  label: 'Cost ↓'        },
  { value: 'purchase_price-asc',   label: 'Cost ↑'        },
  { value: 'listed_price-desc',    label: 'List price ↓'  },
  { value: 'listed_price-asc',     label: 'List price ↑'  },
  { value: 'ebay_avg_sold-desc',   label: 'eBay avg ↓'    },
  { value: 'ebay_avg_sold-asc',    label: 'eBay avg ↑'    },
]

export function StockView() {
  const { toast }      = useToast()
  const queryClient    = useQueryClient()
  const { setHeader }  = usePageHeader()

  // ── Filter state ─────────────────────────────────────────────────────────

  const searchParams = useSearchParams()

  // Seed search from ?search= query param (e.g. deep-link from Price Opportunities)
  const initialSearch = searchParams.get('search') ?? ''

  const [filters, setFilters]         = useState<StockFilters>({
    ...DEFAULT_FILTERS,
    search: initialSearch,
  })
  const [showFilters, setShowFilters] = useState(false)
  const [showAddCard, setShowAddCard] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [directEditCard, setDirectEditCard] = useState<Card | null>(null)
  const [searchInput, setSearchInput] = useState(initialSearch)

  // ── Column visibility ────────────────────────────────────────────────────

  const [showCardNumber, setShowCardNumber] = useState(false)

  // ── Bulk selection state ─────────────────────────────────────────────────

  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [showEbayModal,       setShowEbayModal]       = useState(false)
  const [showSetListingModal, setShowSetListingModal] = useState(false)
  const [showLotModal,        setShowLotModal]        = useState(false)
  const [isRefreshing,      setIsRefreshing]      = useState(false)
  const [statusPendingIds,  setStatusPendingIds]  = useState<Set<string>>(new Set())
  const [pricePendingIds,   setPricePendingIds]   = useState<Set<string>>(new Set())

  // ebayCards: when user clicks "List on eBay" for a single row, we list just that card
  const [ebayModalCards,   setEbayModalCards]   = useState<Card[]>([])
  const [ebayListCard,     setEbayListCard]     = useState<Card | null>(null)

  // Platform picker: opened by "List item" button — rendered as fixed overlay to avoid
  // overflow-x-auto stacking context clipping the dropdown inside the table.
  const [listItemCard,     setListItemCard]     = useState<Card | null>(null)

  const { data: orgSettings } = useOrgSettings()

  // ── Sale queue — sequential multi-card recording ─────────────────────────

  const [saleQueue,    setSaleQueue]    = useState<Card[]>([])
  const [saleQueueIdx, setSaleQueueIdx] = useState(0)

  const saleModalCard = saleQueue[saleQueueIdx] ?? null
  const saleModalOpen = saleQueue.length > 0

  /** Advance to next in queue, or close if done */
  function handleSaleNext() {
    const nextIdx = saleQueueIdx + 1
    if (nextIdx < saleQueue.length) {
      setSaleQueueIdx(nextIdx)
    } else {
      setSaleQueue([])
      setSaleQueueIdx(0)
    }
  }

  /** Exit the entire queue */
  function handleSaleClose() {
    setSaleQueue([])
    setSaleQueueIdx(0)
  }

  const bulkAction    = useBulkCardAction()
  const bulkEbayList  = useBulkEbayList()

  // Clear selection whenever the visible page/filter set changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filters.page, filters.status, filters.search, filters.condition, filters.set_code, filters.listing, filters.sort, filters.order])

  // ── Data ─────────────────────────────────────────────────────────────────

  const query = {
    page:      filters.page,
    limit:     PAGE_SIZE,
    search:    filters.search || undefined,
    status:    filters.status !== 'all' ? (filters.status as CardStatus) : undefined,
    set_code:  filters.set_code || undefined,
    condition: filters.condition !== 'all' ? (filters.condition as CardCondition) : undefined,
    listing_type: filters.listing !== 'all' ? filters.listing : undefined,
    sort:      filters.sort,
    order:     filters.order,
  }

  const { data, isLoading, isError } = useCards(query)
  const currentPageCards = data?.data ?? []

  // Sync header context
  useEffect(() => {
    const count = data?.count
    const subtitle = count !== undefined
      ? `${formatNumber(count)} card${count !== 1 ? 's' : ''}${selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}`
      : undefined
    setHeader({ title: 'Stock', subtitle })
  }, [data?.count, selectedIds.size, setHeader])

  // Derive selectedCard from live query data so photos update immediately after upload.
  // NOTE: we use useEffect (not render-time setState) to sync lastCard — calling setState
  // during render causes an infinite loop when TanStack Query produces new object
  // references after a background refetch, because liveCard !== lastCard stays true
  // every render and React keeps re-rendering until it throws "Maximum update depth exceeded".
  const [lastCard, setLastCard] = useState<Card | null>(null)
  const liveCard = selectedCardId ? currentPageCards.find(c => c.id === selectedCardId) : undefined
  const selectedCard = selectedCardId ? (liveCard ?? lastCard) : null

  useEffect(() => {
    if (liveCard) setLastCard(liveCard)
  }, [liveCard])

  // ── Filter helpers ────────────────────────────────────────────────────────

  const setFilter = useCallback(
    <K extends keyof StockFilters>(key: K, value: StockFilters[K]) => {
      setFilters(prev => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }))
    },
    [],
  )

  useEffect(() => {
    const timer = setTimeout(() => setFilter('search', searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput, setFilter])

  const hasActiveFilters =
    filters.condition !== 'all' ||
    filters.set_code  !== ''    ||
    (filters.sort !== 'created_at' || filters.order !== 'desc')

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0

  // ── Selection helpers ─────────────────────────────────────────────────────

  const lastSelectedId = useRef<string | null>(null)

  function toggleSelect(id: string, shiftKey = false) {
    setSelectedIds(prev => {
      const next = new Set(prev)

      if (shiftKey && lastSelectedId.current) {
        // Range-select from last clicked to current
        const lastIdx = currentPageCards.findIndex(c => c.id === lastSelectedId.current)
        const currIdx = currentPageCards.findIndex(c => c.id === id)
        if (lastIdx >= 0 && currIdx >= 0) {
          const [from, to] = lastIdx <= currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx]
          currentPageCards.slice(from, to + 1).forEach(c => next.add(c.id))
          return next
        }
      }

      if (next.has(id)) next.delete(id)
      else              next.add(id)
      lastSelectedId.current = id
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(currentPageCards.map(c => c.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // ── Sort via column header click ──────────────────────────────────────────

  function handleSort(field: string) {
    setFilters(prev => ({
      ...prev,
      sort:  field as StockFilters['sort'],
      order: prev.sort === field && prev.order === 'desc' ? 'asc' : 'desc',
      page:  1,
    }))
  }

  // Derived: visible selected cards
  const selectedCards = currentPageCards.filter(c => selectedIds.has(c.id))

  // ── Bulk action handlers ──────────────────────────────────────────────────

  async function handleBulkStatus(status: CardStatus) {
    const ids = Array.from(selectedIds)
    try {
      const { affected } = await bulkAction.mutateAsync({ action: 'status', ids, status })
      toast.success(`${affected} card${affected !== 1 ? 's' : ''} → ${status}`)
      clearSelection()
    } catch (err) {
      toast.error('Bulk status change failed', err instanceof Error ? err.message : undefined)
    }
  }

  function handlePrintLabels() {
    const ids = Array.from(selectedIds).slice(0, 50)
    const url = `/print/labels?ids=${ids.join(',')}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    try {
      const { affected } = await bulkAction.mutateAsync({ action: 'delete', ids })
      toast.success(`${affected} card${affected !== 1 ? 's' : ''} deleted`)
      clearSelection()
    } catch (err) {
      toast.error('Bulk delete failed', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleBulkEbayList(ids: string[]) {
    return bulkEbayList.mutateAsync(ids)
  }

  async function handleBulkAssignLot(lotId: string) {
    const ids = Array.from(selectedIds)
    const { affected } = await bulkAction.mutateAsync({ action: 'assign_lot', ids, lot_id: lotId })
    toast.success(`${affected} card${affected !== 1 ? 's' : ''} added to lot`)
    clearSelection()
  }

  /** Open sale queue for all selected cards */
  function openSaleQueue() {
    const cards = currentPageCards.filter(c => selectedIds.has(c.id))
    if (cards.length === 0) return
    setSaleQueue(cards)
    setSaleQueueIdx(0)
  }

  // ── Per-row action handlers ───────────────────────────────────────────────

  /** Quick status: In Stock → Listed */
  async function handleQuickStatus(card: Card) {
    if (card.status !== 'In Stock') return
    setStatusPendingIds(prev => new Set(prev).add(card.id))
    try {
      const res = await fetch(`/api/cards/${card.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'Listed' }),
      })
      if (!res.ok) throw new Error('Update failed')
      void queryClient.invalidateQueries({ queryKey: ['cards'] })
      toast.success(`${card.card_name} → Listed`)
    } catch (err) {
      toast.error('Status update failed', err instanceof Error ? err.message : undefined)
    } finally {
      setStatusPendingIds(prev => { const s = new Set(prev); s.delete(card.id); return s })
    }
  }

  /** Record sale for a single card — starts a 1-card queue */
  function handleRecordSaleForCard(card: Card) {
    setSaleQueue([card])
    setSaleQueueIdx(0)
  }

  /** List a single card on eBay — opens EbayListModal for price + preview flow */
  function handleListEbayCard(card: Card) {
    setEbayListCard(card)
  }

  /** Refresh eBay price for a single card */
  async function handleRefreshSinglePrice(card: Card) {
    setPricePendingIds(prev => new Set(prev).add(card.id))
    try {
      const qs = new URLSearchParams({ card_name: card.card_name })
      if (card.set_code)    qs.set('set_code',    card.set_code)
      if (card.card_number) qs.set('card_number', card.card_number)
      if (card.condition)   qs.set('condition',   card.condition)
      const res  = await fetch(`/api/ebay/price?${qs}`)
      if (!res.ok) {
        const errBody = await res.json() as { error?: string }
        throw new Error(errBody.error ?? `Price lookup failed (HTTP ${res.status})`)
      }
      const json = await res.json() as { median_price?: number | null }
      if (json.median_price == null) {
        toast.info('No price found', `Couldn't find recent sales for ${card.card_name}`)
        return
      }
      const patch = await fetch(`/api/cards/${card.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ebay_avg_sold: json.median_price }),
      })
      if (!patch.ok) throw new Error('Price update failed')
      void queryClient.invalidateQueries({ queryKey: ['cards'] })
      toast.success(`eBay price updated`, `${card.card_name} — £${json.median_price.toFixed(2)}`)
    } catch (err) {
      toast.error('Price refresh failed', err instanceof Error ? err.message : undefined)
    } finally {
      setPricePendingIds(prev => { const s = new Set(prev); s.delete(card.id); return s })
    }
  }

  /** Bulk refresh eBay prices for all selected cards */
  async function handleRefreshAllPrices() {
    const cards = currentPageCards.filter(c => selectedIds.has(c.id))
    if (cards.length === 0) return
    setIsRefreshing(true)
    let updated = 0
    let failed  = 0
    try {
      for (const [i, card] of cards.entries()) {
        // Small delay after the first card to avoid saturating the rate limit
        // when refreshing a large selection (100ms * index keeps well under 100/min).
        if (i > 0) await new Promise(r => setTimeout(r, 100))
        try {
          const qs = new URLSearchParams({ card_name: card.card_name })
          if (card.set_code)    qs.set('set_code',    card.set_code)
          if (card.card_number) qs.set('card_number', card.card_number)
          if (card.condition)   qs.set('condition',   card.condition)
          const res  = await fetch(`/api/ebay/price?${qs}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const d = await res.json() as { median_price?: number | null }
          if (d.median_price == null) { failed++; continue }
          const patchRes = await fetch(`/api/cards/${card.id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ebay_avg_sold: d.median_price }),
          })
          if (!patchRes.ok) throw new Error(`PATCH ${patchRes.status}`)
          updated++
        } catch { failed++ }
      }
    } finally {
      setIsRefreshing(false)
      void queryClient.invalidateQueries({ queryKey: ['cards'] })
      const parts: string[] = []
      if (updated > 0) parts.push(`${updated} price${updated !== 1 ? 's' : ''} updated`)
      if (failed  > 0) parts.push(`${failed} not found`)
      if (parts.length > 0) {
        if (updated > 0) toast.success('Prices refreshed', parts.join(' · '))
        else             toast.info('No prices found', parts.join(' · '))
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Cards to pass to BulkEbayModal — single-card override or bulk selection
  const ebayModalDisplayCards = ebayModalCards.length > 0 ? ebayModalCards : selectedCards
  const ebayModalCount        = ebayModalCards.length > 0 ? ebayModalCards.length : selectedIds.size

  return (
    <div className="space-y-4">

      {/* ── Listing-type tabs ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        {LISTING_TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={filters.listing === t.id}
            onClick={() => setFilter('listing', t.id)}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium transition-colors',
              filters.listing === t.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.id === 'variation' && <Layers className="h-3.5 w-3.5" />}
              {t.label}
            </span>
            {filters.listing === t.id && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Search + filter toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
          <input
            type="search"
            placeholder="Search cards…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label="Search stock"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-input text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        {STATUS_PILLS.map(s => {
          const active = filters.status === s
          const colourClass = active
            ? s === 'In Stock' ? 'bg-blue-600 text-white'
            : s === 'Listed'   ? 'bg-amber-500 text-white'
            : s === 'Sold'     ? 'bg-muted text-foreground'
            : 'bg-primary text-primary-foreground'
            : 'bg-secondary text-muted-foreground hover:text-foreground'
          return (
            <button
              key={s}
              onClick={() => setFilter('status', s)}
              className={cn('px-3 py-1.5 rounded-md text-sm font-medium transition-colors', colourClass)}
              aria-pressed={active}
            >
              {s === 'all' ? 'All' : s}
            </button>
          )
        })}

        {/* Card # column toggle */}
        <button
          onClick={() => setShowCardNumber(v => !v)}
          title={showCardNumber ? 'Hide card number column' : 'Show card number column'}
          aria-pressed={showCardNumber}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
            showCardNumber
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
          )}
        >
          <Hash className="h-3.5 w-3.5" />
          No.
        </button>

        <Button
          variant={showFilters ? 'primary' : 'secondary'}
          size="md"
          onClick={() => setShowFilters(v => !v)}
          iconLeft={<SlidersHorizontal className="h-4 w-4" />}
          aria-expanded={showFilters}
          aria-controls="stock-filters"
        >
          Filters
          {hasActiveFilters && (
            <span className="ml-1 h-2 w-2 rounded-full bg-primary-foreground inline-block" aria-label="Filters active" />
          )}
        </Button>

        <Button
          onClick={() => setShowAddCard(true)}
          iconLeft={<Plus className="h-4 w-4" />}
        >
          Add card
        </Button>
      </div>

      {/* Extended filters */}
      {showFilters && (
        <div
          id="stock-filters"
          className="flex items-center gap-3 flex-wrap p-4 rounded-lg border border-border bg-card"
        >
          <Select
            value={filters.condition}
            onChange={e => setFilter('condition', e.target.value as StockFilters['condition'])}
            options={[
              { value: 'all', label: 'All conditions' },
              ...(['NM', 'LP', 'MP', 'HP', 'Sealed'] as const).map(c => ({ value: c, label: c })),
            ]}
            aria-label="Filter by condition"
          />
          <Input
            type="text"
            placeholder="Set code…"
            value={filters.set_code}
            onChange={e => setFilter('set_code', e.target.value)}
            wrapperClassName="w-28"
            aria-label="Filter by set code"
          />
          <Select
            value={`${filters.sort}-${filters.order}`}
            onChange={e => {
              const [sort, order] = e.target.value.split('-') as [StockFilters['sort'], StockFilters['order']]
              setFilters(prev => ({ ...prev, sort, order, page: 1 }))
            }}
            options={SORT_OPTIONS}
            aria-label="Sort order"
          />
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Keep the active tab — clearing filters shouldn't yank the
                // user out of the listing view they're working in
                setFilters(prev => ({ ...DEFAULT_FILTERS, listing: prev.listing }))
                setSearchInput('')
              }}
              iconLeft={<ClearIcon className="h-3.5 w-3.5" />}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <StockTable
        cards={currentPageCards}
        isLoading={isLoading}
        isError={isError}
        onAddCard={() => setShowAddCard(true)}
        onRowClick={(card) => setSelectedCardId(card.id)}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onSelectAll={selectAll}
        onClearAll={clearSelection}
        showCardNumber={showCardNumber}
        currentSort={filters.sort}
        currentOrder={filters.order}
        onSort={handleSort}
        pendingIds={statusPendingIds}
        pricePendingIds={pricePendingIds}
        onListItem={(card) => setListItemCard(card)}
        onDirectEdit={(card) => setDirectEditCard(card)}
        onRecordSale={handleRecordSaleForCard}
        onRefreshPrice={(card) => { void handleRefreshSinglePrice(card) }}
      />

      {/* Bulk action bar — appears when anything is selected */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          isPending={bulkAction.isPending || bulkEbayList.isPending}
          isRefreshing={isRefreshing}
          onClear={clearSelection}
          onStatusChange={(s) => { void handleBulkStatus(s) }}
          onRegisterSale={openSaleQueue}
          onDelete={() => { void handleBulkDelete() }}
          onPrint={handlePrintLabels}
          onEbayList={() => setShowEbayModal(true)}
          onCreateSetListing={() => setShowSetListingModal(true)}
          onAssignLot={() => setShowLotModal(true)}
          onRefreshPrices={() => { void handleRefreshAllPrices() }}
        />
      )}

      {/* Create Set Listing modal — multi-variation eBay listing */}
      <CreateSetListingModal
        open={showSetListingModal}
        onClose={() => setShowSetListingModal(false)}
        selectedCards={selectedCards}
        onSuccess={() => {
          setShowSetListingModal(false)
          clearSelection()
          void queryClient.invalidateQueries({ queryKey: ['cards'] })
        }}
      />

      {/* Bulk assign to lot modal */}
      <BulkAssignLotModal
        open={showLotModal}
        count={selectedIds.size}
        onClose={() => setShowLotModal(false)}
        onConfirm={(lotId) => handleBulkAssignLot(lotId)}
      />

      {/* Single-card eBay listing modal — price input + fee breakdown + description preview */}
      <EbayListModal
        open={!!ebayListCard}
        onClose={() => setEbayListCard(null)}
        card={ebayListCard}
        shopName={orgSettings?.shop_name ?? 'VaultHunters TCG'}
        onSuccess={() => { setEbayListCard(null); void queryClient.invalidateQueries({ queryKey: ['cards'] }) }}
      />

      {/* Bulk eBay listing modal — for BulkActionBar multi-selection */}
      <BulkEbayModal
        open={showEbayModal}
        onClose={() => { setShowEbayModal(false); setEbayModalCards([]) }}
        selectedCards={ebayModalDisplayCards}
        totalCount={ebayModalCount}
        onConfirm={handleBulkEbayList}
        isPending={bulkEbayList.isPending}
      />

      {/* Sale queue modal — one card at a time */}
      <RecordSaleModal
        open={saleModalOpen}
        onClose={handleSaleClose}
        onNext={saleQueue.length > 1 ? handleSaleNext : undefined}
        prefill={saleModalCard}
        queuePos={saleQueueIdx}
        queueTotal={saleQueue.length}
      />

      {/* Add Card modal */}
      <AddCardModal
        open={showAddCard}
        onClose={() => setShowAddCard(false)}
      />

      {/* Card detail slide-over */}
      <CardDetailSlideOver
        card={selectedCard}
        onClose={() => setSelectedCardId(null)}
      />

      {/* Direct edit modal — opened from table Edit button */}
      <EditCardModal
        card={directEditCard}
        onClose={() => setDirectEditCard(null)}
      />

      {/* Platform picker — fixed overlay so it's never clipped by overflow-x-auto */}
      {listItemCard && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setListItemCard(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto min-w-[180px] rounded-lg border border-border bg-card shadow-xl py-1.5 text-sm">
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground truncate max-w-[220px]">
                {listItemCard.card_name}
              </p>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-secondary transition-colors text-left"
                onClick={() => { const c = listItemCard; setListItemCard(null); handleListEbayCard(c) }}
              >
                <ShoppingBag className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                List on eBay
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-secondary transition-colors text-left"
                onClick={() => { const c = listItemCard; setListItemCard(null); void handleQuickStatus(c) }}
              >
                <Tag className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                Other platform
              </button>
            </div>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFilter('page', filters.page - 1)}
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
            onClick={() => setFilter('page', filters.page + 1)}
            disabled={filters.page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
