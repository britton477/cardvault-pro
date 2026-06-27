'use client'

import { AlertCircle, Layers, Pencil, Tag, ShoppingBag, ReceiptText, RefreshCw, ExternalLink } from 'lucide-react'
import { cn, formatGBP, formatDate } from '@/lib/utils'
import { ConditionBadge, StatusBadge, SkeletonTableRow, EmptyState } from '@/components/ui'
import type { Card } from '@/types'

interface StockTableProps {
  cards:             Card[]
  isLoading:         boolean
  isError:           boolean
  onAddCard?:        () => void
  onRowClick?:       (card: Card) => void
  // Bulk selection — all optional; omitting gives original single-select behaviour
  selectedIds?:      Set<string>
  onToggleSelect?:   (id: string) => void
  onSelectAll?:      () => void
  onClearAll?:       () => void
  // Column visibility
  showCardNumber?:   boolean
  // Inline row actions
  pendingIds?:       Set<string>       // Mark Listed in-flight
  pricePendingIds?:  Set<string>       // Per-card price refresh in-flight
  onQuickStatus?:    (card: Card) => void
  onDirectEdit?:     (card: Card) => void  // Opens edit modal directly (skips slide-over)
  onRecordSale?:     (card: Card) => void
  onListEbay?:       (card: Card) => void
  onRefreshPrice?:   (card: Card) => void
}

// Tri-state values for the header checkbox
type HeaderCheckState = 'none' | 'some' | 'all'

// Compact icon button used in the actions column
function IBtn({
  title, onClick, disabled, colour = '', children,
}: {
  title:     string
  onClick?:  () => void
  disabled?: boolean
  colour?:   string
  children:  React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-7 w-7 rounded flex items-center justify-center transition-colors disabled:opacity-40',
        'text-muted-foreground hover:text-foreground hover:bg-secondary',
        colour,
      )}
    >
      {children}
    </button>
  )
}

export function StockTable({
  cards, isLoading, isError, onAddCard, onRowClick,
  selectedIds, onToggleSelect, onSelectAll, onClearAll,
  showCardNumber = false,
  pendingIds, pricePendingIds, onQuickStatus, onDirectEdit, onRecordSale, onListEbay, onRefreshPrice,
}: StockTableProps) {
  const bulkEnabled = Boolean(selectedIds && onToggleSelect)
  const COLUMNS = 10 + (bulkEnabled ? 1 : 0) + (showCardNumber ? 1 : 0)

  // Determine header checkbox state
  const headerState: HeaderCheckState = (() => {
    if (!bulkEnabled || cards.length === 0) return 'none'
    const selected = cards.filter(c => selectedIds!.has(c.id)).length
    if (selected === 0)            return 'none'
    if (selected === cards.length) return 'all'
    return 'some'
  })()

  function handleHeaderCheck() {
    if (headerState === 'all') onClearAll?.()
    else                       onSelectAll?.()
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Stock table">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              {/* Bulk checkbox header */}
              {bulkEnabled && (
                <th className="w-10 px-3 py-3" aria-label="Select all">
                  <input
                    type="checkbox"
                    checked={headerState === 'all'}
                    ref={el => { if (el) el.indeterminate = headerState === 'some' }}
                    onChange={handleHeaderCheck}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    aria-label={headerState === 'all' ? 'Deselect all' : 'Select all on page'}
                  />
                </th>
              )}
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-10" aria-label="Thumbnail" />
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Card</th>
              {showCardNumber && (
                <th className="text-left px-4 py-3 font-medium text-muted-foreground w-20">#</th>
              )}
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Set</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cond</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cost</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Listed</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">eBay Avg</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Added</th>
              {/* Actions header — sticky right so buttons stay visible */}
              <th
                className="w-px py-3 font-medium text-muted-foreground sticky right-0 bg-secondary/30 border-l border-border/20"
                aria-label="Actions"
              />
            </tr>
          </thead>
          <tbody>
            {/* Loading skeletons */}
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <SkeletonTableRow key={i} columns={COLUMNS} />
            ))}

            {/* Error row */}
            {!isLoading && isError && (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-10">
                  <div className="flex items-center justify-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Failed to load cards. Please refresh and try again.
                  </div>
                </td>
              </tr>
            )}

            {/* Empty state */}
            {!isLoading && !isError && cards.length === 0 && (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-2">
                  <EmptyState
                    icon={<Layers className="h-10 w-10" />}
                    heading="No cards yet"
                    description="Add your first card to start tracking your stock."
                    action={onAddCard ? { label: '+ Add card', onClick: onAddCard } : undefined}
                    className="border-0 rounded-none py-12"
                  />
                </td>
              </tr>
            )}

            {/* Data rows */}
            {!isLoading && !isError && cards.map(card => {
              const thumb      = card.photos?.[0]?.thumb_url ?? card.photos?.[0]?.url
              const isSelected = bulkEnabled && selectedIds!.has(card.id)
              const ebaySearch = `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent([card.card_name, card.set_code].filter(Boolean).join(' '))}&LH_Complete=1&LH_Sold=1`

              return (
                <tr
                  key={card.id}
                  onClick={() => onRowClick?.(card)}
                  className={cn(
                    'border-b border-border transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-secondary/40',
                    isSelected && 'bg-primary/5 hover:bg-primary/10',
                  )}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(card) } : undefined}
                  role={onRowClick ? 'button' : undefined}
                  aria-label={onRowClick ? `View details for ${card.card_name}` : undefined}
                  aria-selected={bulkEnabled ? isSelected : undefined}
                >
                  {/* Bulk checkbox */}
                  {bulkEnabled && (
                    <td
                      className="w-10 px-3 py-2"
                      onClick={e => { e.stopPropagation(); onToggleSelect!(card.id) }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect!(card.id)}
                        onClick={e => e.stopPropagation()}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                        aria-label={`Select ${card.card_name}`}
                      />
                    </td>
                  )}

                  {/* Thumbnail */}
                  <td className="px-4 py-2">
                    {thumb ? (
                      <div className="relative h-9 w-6 rounded overflow-hidden shrink-0">
                        <img src={thumb} alt={card.card_name} className="object-cover w-full h-full" loading="lazy" />
                      </div>
                    ) : (
                      <div className="h-9 w-6 rounded bg-secondary flex items-center justify-center text-xs text-muted-foreground select-none">
                        🃏
                      </div>
                    )}
                  </td>

                  {/* Name (+ number sub-line only when column is hidden) */}
                  <td className="px-4 py-2 max-w-[200px]">
                    <div className="font-medium text-foreground truncate leading-tight">{card.card_name}</div>
                    {!showCardNumber && card.card_number && (
                      <div className="text-xs text-muted-foreground">#{card.card_number}</div>
                    )}
                    {card.foil_type && card.foil_type !== 'Normal' && (
                      <div className="text-xs text-primary/70">{card.foil_type}</div>
                    )}
                  </td>

                  {/* Card number column (togglable) */}
                  {showCardNumber && (
                    <td className="px-4 py-2 text-muted-foreground text-xs font-mono whitespace-nowrap">
                      {card.card_number ? `#${card.card_number}` : '—'}
                    </td>
                  )}

                  {/* Set */}
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                    {card.set_code || '—'}
                  </td>

                  {/* Condition */}
                  <td className="px-4 py-2">
                    <ConditionBadge condition={card.condition} />
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2">
                    <StatusBadge status={card.status} />
                  </td>

                  {/* Cost */}
                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                    {formatGBP(card.purchase_price)}
                  </td>

                  {/* Listed price */}
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {card.listed_price != null ? formatGBP(card.listed_price) : '—'}
                  </td>

                  {/* eBay avg */}
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {card.ebay_avg_sold != null ? formatGBP(card.ebay_avg_sold) : '—'}
                  </td>

                  {/* Added date */}
                  <td className="px-4 py-2 text-muted-foreground text-xs whitespace-nowrap">
                    {formatDate(card.created_at)}
                  </td>

                  {/* ── Inline actions — sticky right ────────────────── */}
                  <td
                    className="px-2 py-2 whitespace-nowrap sticky right-0 bg-card border-l border-border/20"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-0.5">

                      {/* Edit — goes straight to edit modal */}
                      <IBtn title="Edit card" onClick={() => onDirectEdit ? onDirectEdit(card) : onRowClick?.(card)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IBtn>

                      {/* Mark Listed — In Stock only */}
                      {card.status === 'In Stock' && onQuickStatus && (
                        <IBtn
                          title="Mark as Listed"
                          onClick={() => onQuickStatus(card)}
                          disabled={pendingIds?.has(card.id)}
                          colour="text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"
                        >
                          {pendingIds?.has(card.id)
                            ? <span className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
                            : <Tag className="h-3.5 w-3.5" />
                          }
                        </IBtn>
                      )}

                      {/* List on eBay — not Sold */}
                      {card.status !== 'Sold' && onListEbay && (
                        <IBtn
                          title="List on eBay"
                          onClick={() => onListEbay(card)}
                          colour="text-primary/70 hover:bg-primary/10 hover:text-primary"
                        >
                          <ShoppingBag className="h-3.5 w-3.5" />
                        </IBtn>
                      )}

                      {/* Record Sale — not already Sold */}
                      {card.status !== 'Sold' && onRecordSale && (
                        <IBtn
                          title="Record sale"
                          onClick={() => onRecordSale(card)}
                          colour="text-green-400 hover:bg-green-500/10 hover:text-green-400"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                        </IBtn>
                      )}

                      {/* Refresh eBay price */}
                      {onRefreshPrice && (
                        <IBtn
                          title="Refresh eBay price"
                          onClick={() => onRefreshPrice(card)}
                          disabled={pricePendingIds?.has(card.id)}
                          colour="text-blue-400 hover:bg-blue-500/10 hover:text-blue-400"
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', pricePendingIds?.has(card.id) && 'animate-spin')} />
                        </IBtn>
                      )}

                      {/* View eBay sold listings — external link */}
                      <a
                        href={ebaySearch}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View eBay sold listings"
                        onClick={e => e.stopPropagation()}
                        className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
