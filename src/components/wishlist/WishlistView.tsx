'use client'
// =============================================================================
// WishlistView — full wishlist page component.
//
// Features:
//   - Filter by status (wanted / found / purchased) + search
//   - Priority badge (high / normal / low) with colour coding
//   - Inline status cycle: wanted → found → purchased
//   - Delete with confirmation
//   - Empty state per filter
// =============================================================================
import { useState }                                  from 'react'
import { Plus, Search, X, Trash2, Star, CheckCircle2, Eye, ShoppingCart, RefreshCw, TrendingDown, AlertTriangle } from 'lucide-react'
import { useWishlist, useUpdateWishlistItem, useDeleteWishlistItem } from '@/hooks/useWishlist'
import { useWishlistPriceCheck } from '@/hooks/useEbayListings'
import { AddWishlistModal }  from '@/components/wishlist/AddWishlistModal'
import { formatGBP, cn }     from '@/lib/utils'
import type { WishlistItem, WishlistStatus, WishlistPriority } from '@/types'

// ── Priority config ───────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<WishlistPriority, { label: string; badge: string; dot: string }> = {
  high:   { label: 'High',   badge: 'bg-amber-500/15 text-amber-400',       dot: 'bg-amber-400'       },
  normal: { label: 'Normal', badge: 'bg-blue-500/15 text-blue-400',         dot: 'bg-blue-400'         },
  low:    { label: 'Low',    badge: 'bg-secondary text-muted-foreground',    dot: 'bg-muted-foreground' },
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<WishlistStatus, { label: string; badge: string; icon: React.ElementType; next: WishlistStatus | null }> = {
  wanted:    { label: 'Wanted',    badge: 'bg-primary/15 text-primary',          icon: Star,         next: 'found'     },
  found:     { label: 'Found',     badge: 'bg-green-500/15 text-green-400',      icon: Eye,          next: 'purchased' },
  purchased: { label: 'Purchased', badge: 'bg-secondary text-muted-foreground',  icon: CheckCircle2, next: null        },
}

// ── Status filter tabs ────────────────────────────────────────────────────────

const STATUS_TABS: { value: WishlistStatus | 'all'; label: string }[] = [
  { value: 'all',       label: 'All'       },
  { value: 'wanted',    label: 'Wanted'    },
  { value: 'found',     label: 'Found'     },
  { value: 'purchased', label: 'Purchased' },
]

// ── Row ───────────────────────────────────────────────────────────────────────

function WishlistRow({ item }: { item: WishlistItem }) {
  const update  = useUpdateWishlistItem()
  const remove  = useDeleteWishlistItem()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const pCfg = PRIORITY_CONFIG[item.priority]
  const sCfg = STATUS_CONFIG[item.status]
  const StatusIcon = sCfg.icon

  const belowTarget =
    item.last_ebay_price !== null &&
    item.target_price    !== null &&
    item.last_ebay_price <= item.target_price

  function cycleStatus() {
    if (!sCfg.next) return
    update.mutate({ id: item.id, input: { status: sCfg.next } })
  }

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    remove.mutate(item.id)
  }

  return (
    <tr className={cn(
      'border-b border-border/50 hover:bg-secondary/20 transition-colors group',
      belowTarget && 'bg-amber-500/5 border-l-2 border-l-amber-500/60',
    )}>

      {/* Card name + set/variant */}
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-foreground">{item.card_name}</p>
        {(item.set_name || item.variant) && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {[item.set_name, item.variant].filter(Boolean).join(' · ')}
          </p>
        )}
      </td>

      {/* Priority */}
      <td className="px-4 py-3">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', pCfg.badge)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', pCfg.dot)} aria-hidden />
          {pCfg.label}
        </span>
      </td>

      {/* Target price */}
      <td className="px-4 py-3 tabular-nums text-sm text-foreground">
        {item.target_price != null ? formatGBP(item.target_price) : <span className="text-muted-foreground/50">—</span>}
      </td>

      {/* eBay market price */}
      <td className="px-4 py-3">
        {item.last_ebay_price !== null ? (
          <div className="flex flex-col gap-0.5">
            <span className={cn(
              'text-sm tabular-nums font-medium inline-flex items-center gap-1',
              belowTarget ? 'text-amber-400' : 'text-foreground',
            )}>
              {belowTarget && <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />}
              {formatGBP(item.last_ebay_price)}
            </span>
            {belowTarget && (
              <span className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wide">
                Below target!
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </td>

      {/* Status — clickable to advance */}
      <td className="px-4 py-3">
        <button
          onClick={cycleStatus}
          disabled={!sCfg.next || update.isPending}
          title={sCfg.next ? `Mark as ${sCfg.next}` : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all',
            sCfg.badge,
            sCfg.next ? 'cursor-pointer hover:opacity-80 active:scale-95' : 'cursor-default',
          )}
        >
          <StatusIcon className="h-3 w-3" aria-hidden />
          {sCfg.label}
        </button>
      </td>

      {/* Notes */}
      <td className="px-4 py-3 max-w-[200px]">
        {item.notes
          ? <p className="text-xs text-muted-foreground truncate">{item.notes}</p>
          : <span className="text-muted-foreground/30 text-xs">—</span>
        }
      </td>

      {/* Added */}
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
      </td>

      {/* Delete */}
      <td className="px-4 py-3 text-right">
        {confirmDelete ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-destructive">Delete?</span>
            <button
              onClick={handleDelete}
              disabled={remove.isPending}
              className="rounded px-2 py-0.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded px-2 py-0.5 text-xs border border-border text-muted-foreground hover:bg-secondary transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="invisible group-hover:visible rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function WishlistSkeleton() {
  return (
    <div className="animate-pulse space-y-2 px-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3 border-b border-border/50">
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-40 rounded bg-secondary/60" />
            <div className="h-3 w-24 rounded bg-secondary/40" />
          </div>
          <div className="h-5 w-14 rounded-full bg-secondary/60" />
          <div className="h-3.5 w-16 rounded bg-secondary/40" />
          <div className="h-5 w-20 rounded-full bg-secondary/60" />
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function WishlistView() {
  const [modalOpen,   setModalOpen]   = useState(false)
  const [statusTab,   setStatusTab]   = useState<WishlistStatus | 'all'>('all')
  const [searchInput, setSearchInput] = useState('')
  const [priceAlerts, setPriceAlerts] = useState<WishlistItem[] | null>(null)

  const priceCheck = useWishlistPriceCheck()

  const { data, isLoading } = useWishlist({
    status: statusTab,
    search: searchInput || undefined,
    limit:  200,
  })

  const items = data?.data ?? []
  const total = data?.count ?? 0

  // Priority sort: high first
  const PRIORITY_ORDER: Record<WishlistPriority, number> = { high: 0, normal: 1, low: 2 }
  const sorted = [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

  return (
    <>
      <AddWishlistModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Wishlist</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cards you're looking to buy
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                priceCheck.mutate(undefined, {
                  onSuccess: (result) => setPriceAlerts(result.alerts),
                })
              }}
              disabled={priceCheck.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', priceCheck.isPending && 'animate-spin')} aria-hidden />
              {priceCheck.isPending ? 'Checking…' : 'Check eBay Prices'}
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add to wishlist
            </button>
          </div>
        </div>

        {/* ── Price alerts banner ───────────────────────────────────────── */}
        {priceAlerts !== null && (
          <div className={cn(
            'flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm',
            priceAlerts.length > 0
              ? 'border-amber-500/30 bg-amber-500/8 text-amber-400'
              : 'border-green-500/30 bg-green-500/8 text-green-400',
          )}>
            {priceAlerts.length > 0 ? (
              <>
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  <span className="font-semibold">{priceAlerts.length} item{priceAlerts.length !== 1 ? 's' : ''}</span>
                  {' '}at or below target price:{' '}
                  {priceAlerts.map(a => a.card_name).join(', ')}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>All items checked — none are currently at or below target price.</span>
              </>
            )}
            <button
              onClick={() => setPriceAlerts(null)}
              className="ml-auto text-current opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Status tabs */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium" role="tablist">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.value}
                role="tab"
                aria-selected={statusTab === tab.value}
                onClick={() => setStatusTab(tab.value)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  statusTab === tab.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search cards…"
              className="h-7 rounded-md border border-border bg-secondary/40 pl-8 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-ring w-48"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {total > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">
              {total} item{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── Table ─────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="py-4"><WishlistSkeleton /></div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <ShoppingCart className="h-8 w-8 text-muted-foreground/30" aria-hidden />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {statusTab === 'all' && !searchInput ? 'Your wishlist is empty' : 'No items match'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {statusTab === 'all' && !searchInput
                    ? 'Add cards you want to track and buy.'
                    : 'Try a different filter or search term.'}
                </p>
              </div>
              {statusTab === 'all' && !searchInput && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors mt-1"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Add first item
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Card</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Priority</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Target</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">eBay price</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Notes</th>
                    <th className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Added</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(item => (
                    <WishlistRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
