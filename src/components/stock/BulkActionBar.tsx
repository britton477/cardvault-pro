'use client'
// =============================================================================
// BulkActionBar — sticky bottom bar that appears when cards are selected.
// Hosts: status dropdown, price button (opens modal), delete with inline confirm.
// =============================================================================
import { useState }                from 'react'
import { X, ChevronDown, Trash2, AlertTriangle, Printer, ShoppingBag, Package, RefreshCw, ReceiptText, Layers, Tag } from 'lucide-react'
import { cn }                      from '@/lib/utils'
import type { CardStatus }         from '@/types'

const PRINT_LIMIT = 50

interface BulkActionBarProps {
  count:               number
  isPending:           boolean
  isRefreshing?:       boolean
  onClear:             () => void
  onStatusChange:      (status: CardStatus) => void
  onRegisterSale:      () => void
  onDelete:            () => void
  onPrint:             () => void
  onEbayList:          () => void
  onCreateSetListing:  () => void
  onSetPrice:          () => void
  onAssignLot:         () => void
  onRefreshPrices:     () => void
}

const STATUS_OPTIONS: { value: CardStatus; label: string; warn?: string }[] = [
  { value: 'In Stock', label: 'In Stock' },
  { value: 'Listed',   label: 'Listed' },
  { value: 'Sold',     label: 'Sold', warn: 'No sale records will be created.' },
]

export function BulkActionBar({
  count, isPending, isRefreshing, onClear, onStatusChange, onRegisterSale, onDelete, onPrint, onEbayList, onCreateSetListing, onSetPrice, onAssignLot, onRefreshPrices,
}: BulkActionBarProps) {
  const [statusOpen,    setStatusOpen]    = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<CardStatus | null>(null)

  function handleStatusPick(s: typeof STATUS_OPTIONS[number]) {
    if (s.warn) {
      // Show inline warning before applying
      setPendingStatus(s.value)
    } else {
      setStatusOpen(false)
      onStatusChange(s.value)
    }
  }

  function confirmStatus() {
    if (pendingStatus) {
      onStatusChange(pendingStatus)
      setPendingStatus(null)
      setStatusOpen(false)
    }
  }

  return (
    <div className="sticky bottom-0 z-20 mx-0">
      <div className="rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">

        {/* Count + clear */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold tabular-nums">
            {count} card{count !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => { onClear(); setStatusOpen(false); setDeleteConfirm(false); setPendingStatus(null) }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Status dropdown ──────────────────────────────────────────────── */}
        {pendingStatus ? (
          // Inline warning confirm for "Sold"
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>No sale records will be created.</span>
            <button
              onClick={confirmStatus}
              disabled={isPending}
              className="rounded px-2 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => setPendingStatus(null)}
              className="rounded px-2 py-1 border border-border text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : deleteConfirm ? (
          // Inline delete confirm
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Delete {count} card{count !== 1 ? 's' : ''}?</span>
            <button
              onClick={() => { onDelete(); setDeleteConfirm(false) }}
              disabled={isPending}
              className="rounded px-2 py-1 bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="rounded px-2 py-1 border border-border text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          // Normal action buttons
          <>
            {/* Status dropdown */}
            <div className="relative">
              <button
                onClick={() => setStatusOpen(v => !v)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
              >
                Change Status
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', statusOpen && 'rotate-180')} />
              </button>
              {statusOpen && (
                <>
                  {/* Click-away overlay */}
                  <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} />
                  <div className="absolute bottom-full mb-1.5 left-0 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-xl py-1">
                    {STATUS_OPTIONS.map(s => (
                      <button
                        key={s.value}
                        onClick={() => handleStatusPick(s)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors"
                      >
                        {s.label}
                        {s.warn && <span className="ml-1 text-xs text-amber-400">⚠</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Register Sale — green */}
            <button
              onClick={() => { onRegisterSale(); setStatusOpen(false) }}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-green-500/40 text-green-400 px-3 py-1.5 text-sm hover:bg-green-500/10 transition-colors disabled:opacity-50"
            >
              <ReceiptText className="h-3.5 w-3.5" />
              Register Sale
            </button>

            {/* Set price — sits before the listing actions because a price is
                a precondition for both individual and set listings */}
            <button
              onClick={() => { onSetPrice(); setStatusOpen(false) }}
              disabled={isPending}
              title="Set asking price across the selected cards"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <Tag className="h-3.5 w-3.5" />
              Set Price
            </button>

            {/* Refresh prices — blue */}
            <button
              onClick={() => { onRefreshPrices(); setStatusOpen(false) }}
              disabled={isPending || isRefreshing}
              title="Fetch latest eBay market price for selected cards"
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/40 text-blue-400 px-3 py-1.5 text-sm hover:bg-blue-500/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
              {isRefreshing ? 'Refreshing…' : 'Refresh Prices'}
            </button>

            {/* List on eBay — primary */}
            <button
              onClick={() => { onEbayList(); setStatusOpen(false) }}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 border border-primary/30 text-primary px-3 py-1.5 text-sm hover:bg-primary/25 transition-colors disabled:opacity-50"
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              List on eBay
            </button>

            {/* Create Set Listing — teal */}
            <button
              onClick={() => { onCreateSetListing(); setStatusOpen(false) }}
              disabled={isPending}
              title="Create a multi-variation 'Complete Your Set' listing on eBay"
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-500/15 border border-teal-500/30 text-teal-400 px-3 py-1.5 text-sm hover:bg-teal-500/25 transition-colors disabled:opacity-50"
            >
              <Layers className="h-3.5 w-3.5" />
              Set Listing
            </button>

            {/* Add to lot */}
            <button
              onClick={() => { onAssignLot(); setStatusOpen(false) }}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <Package className="h-3.5 w-3.5" />
              Add to Lot
            </button>

            {/* Print labels */}
            <button
              onClick={onPrint}
              disabled={isPending}
              title={count > PRINT_LIMIT ? `Only first ${PRINT_LIMIT} will print` : 'Print price labels'}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Labels
              {count > PRINT_LIMIT && (
                <span className="text-xs text-amber-400">({PRINT_LIMIT} max)</span>
              )}
            </button>

            {/* Delete — destructive */}
            <button
              onClick={() => { setDeleteConfirm(true); setStatusOpen(false) }}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 text-destructive px-3 py-1.5 text-sm hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </>
        )}

        {/* Spinner while pending */}
        {isPending && (
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin flex-shrink-0" />
        )}
      </div>
    </div>
  )
}
