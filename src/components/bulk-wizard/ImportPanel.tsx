'use client'
// =============================================================================
// ImportPanel — Phase 3: final review and import confirmation
//
// Shows a summary of what will be imported, lets the user optionally:
//   • Assign to a purchase lot
//   • Import to stock only (default)
//   • Import + immediately list on eBay (requires eBay connected)
//
// The "List on eBay" path sets a markup % over the eBay avg sold price,
// imports all cards to inventory, then calls /api/ebay/bulk-list so listings
// go live without any extra steps.
// =============================================================================
import { useState, useEffect } from 'react'
import { useRouter }    from 'next/navigation'
import { CheckCircle2, Package, TrendingUp, Layers, AlertCircle, Tag, PackagePlus, ExternalLink, Boxes } from 'lucide-react'
import { useLots }      from '@/hooks/useLots'
import { useOrgSettings } from '@/hooks/useSettings'
import { Button }       from '@/components/ui/Button'
import { cn, formatGBP } from '@/lib/utils'
import { derivePrice, describeStrategy, type PricingStrategy } from '@/lib/pricing'
import type { ListingMode } from '@/hooks/useBulkWizard'
import type { BulkWizardCard } from '@/types'

interface RestockPreview {
  input_index:      number
  card_name:        string
  is_restock:       boolean
  existing_card_id: string | null
  qty_before:       number | null
  qty_after:        number | null
  cost_before:      number | null
  cost_after:       number | null
  in_set_listing:   boolean
}

interface ImportPanelProps {
  computedCards:  BulkWizardCard[]
  totalSpend:     number
  isImporting:    boolean
  importError:    string | null
  onImport:       (opts: {
    lot_id?:         string
    source?:         string
    listing_mode?:   ListingMode
    strategy?:       PricingStrategy
    set_title?:      string
    merge_restocks?: boolean
  }) => Promise<{
    created:            number
    restocked?:         number
    restocked_details?: Array<{ card_id: string; card_name: string; qty_before: number; qty_after: number }>
    ebay_pushed?:       number
    listing_mode?:      ListingMode
    set_listing_url?:   string | null
    set_listing_error?: string | null
    ebay_listed?:       number
    ebay_failed?:       number
    ebay_failed_ids?:   string[]
  }>
  onBack:         () => void
  onClearAll:     () => void
}

export function ImportPanel({
  computedCards,
  totalSpend,
  isImporting,
  importError,
  onImport,
  onBack,
  onClearAll,
}: ImportPanelProps) {
  const router      = useRouter()
  const { data: lotsData } = useLots()
  const [lotId,       setLotId]       = useState('')
  const [source,      setSource]      = useState('Bulk Wizard')
  const { data: orgSettings } = useOrgSettings()

  const [listingMode, setListingMode] = useState<ListingMode>('none')
  const [priceMode,   setPriceMode]   = useState<'market' | 'cost'>('market')
  const [adjustPct,   setAdjustPct]   = useState(0)
  const [setTitle,    setSetTitle]    = useState('')
  const [mergeRestocks, setMergeRestocks] = useState(true)
  const [restockPreview, setRestockPreview] = useState<RestockPreview[] | null>(null)
  const [imported,    setImported]    = useState<{
    created:            number
    restocked?:         number
    restocked_details?: Array<{ card_id: string; card_name: string; qty_before: number; qty_after: number }>
    ebay_pushed?:       number
    listing_mode?:      ListingMode
    set_listing_url?:   string | null
    set_listing_error?: string | null
    ebay_listed?:       number
    ebay_failed?:       number
    ebay_failed_ids?:   string[]
  } | null>(null)
  const [isRetrying,  setIsRetrying]  = useState(false)
  const [retryResult, setRetryResult] = useState<{ listed: number; failed: number } | null>(null)

  const readyCards   = computedCards.filter(c => c.status === 'ready' && c.card_name)
  const pricedCards  = readyCards.filter(c => (c.ebay_avg_sold ?? 0) > 0)
  const totalProfit  = readyCards.reduce((s, c) => s + (c.profit_potential ?? 0), 0)
  const lots         = lotsData?.data ?? []

  // The org's configured markup is the fallback when a card has no eBay
  // comparables. Previously this setting existed but was read by nothing.
  const orgMarkup = orgSettings?.markup_pct ?? 40

  // Seed a sensible set-listing title once the dominant set code is known
  const dominantSet = (() => {
    const counts = new Map<string, number>()
    for (const c of readyCards) {
      const code = c.overrides.set_code ?? c.set_code
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    let best = ''; let max = 0
    for (const [code, n] of counts) if (n > max) { max = n; best = code }
    return best
  })()

  useEffect(() => {
    if (listingMode === 'set' && !setTitle) {
      setSetTitle(dominantSet
        ? `${dominantSet} Pokémon Cards — Complete Your Set!`
        : 'Pokémon Cards — Complete Your Set!')
    }
  }, [listingMode, dominantSet, setTitle])

  // The single strategy object driving every price on this screen
  const strategy: PricingStrategy = priceMode === 'market'
    ? { mode: 'market', adjustmentPct: adjustPct }
    : { mode: 'cost',   markupPct:     adjustPct }

  /**
   * Price preview — uses the exact same function the import will use, so what
   * is shown here is what gets written. No parallel implementation.
   */
  function effectiveListPrice(c: BulkWizardCard): number {
    if (c.listed_price !== null) return c.listed_price
    return derivePrice(
      { purchase_price: c.proportional_cost ?? 0, ebay_avg_sold: c.ebay_avg_sold },
      strategy,
      orgMarkup,
    ).price ?? 0
  }

  // Every card that can be given a price. With the market strategy falling back
  // to cost-plus, this is now effectively everything with either a cost or a
  // market value — which is why cards no longer land unpriced.
  const listableCards = readyCards.filter(c => effectiveListPrice(c) > 0)
  const listableCount   = listableCards.length
  const unlistableCount = readyCards.length - listableCount

  // Estimated total list value
  const totalListValue = listableCards.reduce((s, c) => s + effectiveListPrice(c), 0)

  // ── Restock preview ────────────────────────────────────────────────────────
  // Fetched once on mount so the user sees which scans will top up existing
  // stock before committing — restocking blends cost basis, so it shouldn't be
  // a surprise after the fact.
  useEffect(() => {
    if (readyCards.length === 0) return
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch('/api/bulk-wizard/check-restock', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cards: readyCards.map(c => ({
              card_name:      c.overrides.card_name   ?? c.card_name,
              set_code:       c.overrides.set_code    ?? c.set_code,
              card_number:    c.overrides.card_number ?? c.card_number,
              condition:      c.overrides.condition   ?? c.condition,
              foil_type:      c.overrides.foil_type   ?? c.foil_type,
              language:       c.language,
              purchase_price: c.proportional_cost ?? 0,
            })),
          }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { matches: RestockPreview[] }
        setRestockPreview(data.matches)
      } catch {
        // Preview is advisory — import still works without it
      }
    })()

    return () => { cancelled = true }
    // Intentionally mount-only: re-running on every card edit would spam the
    // endpoint while the user tweaks names in Phase 2.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restocks       = (restockPreview ?? []).filter(p => p.is_restock)
  const restockCount   = restocks.length
  const newCount       = readyCards.length - restockCount
  const setListingHits = restocks.filter(p => p.in_set_listing).length

  async function handleImport() {
    try {
      const result = await onImport({
        lot_id:         lotId || undefined,
        source:         source || 'Bulk Wizard',
        listing_mode:   listingMode,
        strategy,
        set_title:      listingMode === 'set' ? setTitle.trim() : undefined,
        merge_restocks: mergeRestocks,
      })
      setImported(result)
    } catch {
      // error is shown via importError prop
    }
  }

  async function handleRetryEbay() {
    if (!imported?.ebay_failed_ids?.length) return
    setIsRetrying(true)
    try {
      const res = await fetch('/api/ebay/bulk-list', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ card_ids: imported.ebay_failed_ids }),
      })
      if (res.ok) {
        const data = await res.json() as {
          succeeded: Array<{ card_id: string }>
          failed:    Array<{ card_id: string }>
        }
        const listedNow  = data.succeeded?.length ?? 0
        const stillFailed = data.failed?.length   ?? 0
        // Update the imported state — remove IDs that succeeded this time
        const succeededIds = new Set((data.succeeded ?? []).map(s => s.card_id))
        setImported(prev => prev ? {
          ...prev,
          ebay_listed:    (prev.ebay_listed ?? 0) + listedNow,
          ebay_failed:    stillFailed,
          ebay_failed_ids: (prev.ebay_failed_ids ?? []).filter(id => !succeededIds.has(id)),
        } : prev)
        setRetryResult({ listed: listedNow, failed: stillFailed })
      }
    } catch {
      setRetryResult({ listed: 0, failed: imported.ebay_failed_ids.length })
    } finally {
      setIsRetrying(false)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (imported !== null) {
    const ebayListed    = imported.ebay_listed     ?? 0
    const ebayFailed    = imported.ebay_failed     ?? 0
    const failedIds     = imported.ebay_failed_ids ?? []

    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center max-w-sm mx-auto">
        <div className="flex items-center justify-center rounded-full p-4 bg-green-500/10 border border-green-500/20">
          <CheckCircle2 className="h-10 w-10 text-green-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {imported.created > 0
              ? `${imported.created} card${imported.created !== 1 ? 's' : ''} added to stock`
              : 'Stock updated'}
          </h2>
          {(imported.restocked ?? 0) > 0 && (
            <p className="text-sm text-teal-400 mt-1">
              {imported.restocked} existing card{imported.restocked !== 1 ? 's' : ''} restocked
              {(imported.ebay_pushed ?? 0) > 0 && (
                <> · quantities pushed to {imported.ebay_pushed} eBay set listing{imported.ebay_pushed !== 1 ? 's' : ''}</>
              )}
            </p>
          )}
          {imported.listing_mode === 'set' && imported.set_listing_url && (
            <p className="text-sm text-teal-400 mt-1">
              {ebayListed} card{ebayListed !== 1 ? 's' : ''} published as one set listing
            </p>
          )}
          {imported.listing_mode === 'set' && imported.set_listing_error && (
            <p className="text-sm text-amber-400 mt-1">
              Cards imported, but the set listing failed: {imported.set_listing_error}
            </p>
          )}
          {imported.listing_mode === 'individual' && ebayListed > 0 && (
            <p className="text-sm text-green-400 mt-1">
              {ebayListed} listing{ebayListed !== 1 ? 's' : ''} published on eBay
            </p>
          )}
          {imported.listing_mode === 'individual' && ebayListed === 0 && ebayFailed === 0 && failedIds.length === 0 && (
            <p className="text-sm text-amber-400 mt-1">
              eBay listing skipped — check eBay is connected in Settings
            </p>
          )}
          {imported.listing_mode === 'none' && (
            <p className="text-sm text-muted-foreground mt-1">
              All cards are in your inventory, priced and ready to list whenever you want.
            </p>
          )}
        </div>

        {/* Direct link to the new set listing */}
        {imported.set_listing_url && (
          <a
            href={imported.set_listing_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-teal-500/15 border border-teal-500/30 text-teal-400 px-4 py-2 text-sm font-medium hover:bg-teal-500/25 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View set listing on eBay
          </a>
        )}

        {/* ── Failed eBay listings retry block ─────────────────────── */}
        {failedIds.length > 0 && (
          <div className="w-full rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-left space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">
                  {failedIds.length} listing{failedIds.length !== 1 ? 's' : ''} failed
                </p>
                <p className="text-xs text-red-400/70 mt-0.5">
                  Cards are in stock — only the eBay listing step failed.
                </p>
              </div>
            </div>
            {retryResult && (
              <p className="text-xs text-muted-foreground">
                Last retry: {retryResult.listed} listed
                {retryResult.failed > 0 && ` · ${retryResult.failed} still failing`}
              </p>
            )}
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleRetryEbay}
              loading={isRetrying}
              disabled={isRetrying}
            >
              {isRetrying ? 'Retrying…' : `Retry ${failedIds.length} failed listing${failedIds.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onClearAll}>
            Scan more cards
          </Button>
          <Button onClick={() => router.push('/stock')}>
            View in stock →
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-foreground">Ready to import</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review the summary below, then confirm to add all cards to your inventory.
        </p>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            icon:   <Package className="h-4 w-4" />,
            label:  'Cards to import',
            value:  readyCards.length.toString(),
            colour: 'text-primary',
          },
          {
            icon:   <Layers className="h-4 w-4" />,
            label:  'Total invested',
            value:  totalSpend > 0 ? formatGBP(totalSpend) : '—',
            colour: 'text-foreground',
          },
          {
            icon:   <TrendingUp className="h-4 w-4" />,
            label:  'Potential profit',
            value:  pricedCards.length ? formatGBP(totalProfit) : '—',
            colour: totalProfit >= 0 ? 'text-green-400' : 'text-red-400',
          },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4 text-center">
            <div className="flex justify-center mb-2 text-muted-foreground">{s.icon}</div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className={cn('text-lg font-bold mt-0.5 tabular-nums', s.colour)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Restock detection ────────────────────────────────────────── */}
      {restockCount > 0 && (
        <div className={cn(
          'rounded-xl border px-4 py-3.5 transition-colors',
          mergeRestocks
            ? 'border-teal-500/30 bg-teal-500/5'
            : 'border-border bg-card',
        )}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <PackagePlus className="h-3.5 w-3.5 text-teal-400" />
                {restockCount} card{restockCount !== 1 ? 's' : ''} already in your stock
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {mergeRestocks
                  ? `Quantities will be topped up instead of creating duplicate rows${newCount > 0 ? ` · ${newCount} new card${newCount !== 1 ? 's' : ''} will be added` : ''}`
                  : 'Duplicate rows will be created for each scan'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={mergeRestocks}
              onClick={() => setMergeRestocks(!mergeRestocks)}
              className={cn(
                'relative ml-3 inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full',
                'transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
                mergeRestocks ? 'bg-teal-500' : 'bg-secondary border border-border',
              )}
            >
              <span className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                mergeRestocks ? 'translate-x-4' : 'translate-x-0.5',
              )} />
            </button>
          </div>

          {mergeRestocks && (
            <div className="mt-3 space-y-2">
              {/* Per-card restock detail */}
              <div className="rounded-lg border border-border bg-secondary/40 overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <span>Card</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Avg cost</span>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-border/50">
                  {restocks.map(p => (
                    <div key={p.input_index} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5 text-xs items-center">
                      <span className="text-foreground truncate flex items-center gap-1.5">
                        {p.card_name}
                        {p.in_set_listing && (
                          <span className="rounded px-1 py-px text-[9px] font-semibold bg-teal-500/15 text-teal-400 shrink-0">
                            SET
                          </span>
                        )}
                      </span>
                      <span className="text-right tabular-nums text-muted-foreground">
                        {p.qty_before} → <span className="text-foreground font-medium">{p.qty_after}</span>
                      </span>
                      <span className="text-right tabular-nums text-muted-foreground">
                        {p.cost_before != null ? formatGBP(p.cost_before) : '—'}
                        {' → '}
                        <span className="text-foreground font-medium">
                          {p.cost_after != null ? formatGBP(p.cost_after) : '—'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Cost per card is recalculated as a weighted average across old and new stock,
                so profit reporting stays accurate.
                {setListingHits > 0 && (
                  <> {setListingHits} card{setListingHits !== 1 ? 's are' : ' is'} in a
                  set listing — the new quantit{setListingHits !== 1 ? 'ies' : 'y'} will be
                  pushed to eBay automatically.</>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Options ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card divide-y divide-border">

        {/* Lot assignment */}
        <div className="px-4 py-3.5">
          <label className="block text-sm font-medium text-foreground mb-1">
            Assign to lot <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <select
            value={lotId}
            onChange={e => setLotId(e.target.value)}
            className={cn(
              'w-full rounded-lg border border-border bg-secondary px-3 py-2',
              'text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary',
            )}
          >
            <option value="">No lot</option>
            {lots.map(lot => (
              <option key={lot.id} value={lot.id}>
                {lot.name}{lot.source ? ` · ${lot.source}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div className="px-4 py-3.5">
          <label className="block text-sm font-medium text-foreground mb-1">Source</label>
          <input
            type="text"
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="e.g. Card Show, eBay, Collection"
            className={cn(
              'w-full rounded-lg border border-border bg-secondary px-3 py-2',
              'text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary',
              'placeholder:text-muted-foreground/40',
            )}
          />
        </div>

        {/* ── Pricing — always applied, independent of listing ──────── */}
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                Asking price
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {describeStrategy(strategy)} · applied whether or not you list now
              </p>
            </div>
            {listableCount > 0 && (
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-muted-foreground">Est. total list value</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  {formatGBP(totalListValue)}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Strategy: relative to market, or margin over cost */}
            <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
              {([
                { id: 'market' as const, label: 'vs eBay price' },
                { id: 'cost'   as const, label: 'over cost' },
              ]).map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setPriceMode(m.id); setAdjustPct(m.id === 'cost' ? orgMarkup : 0) }}
                  className={cn(
                    'px-3 py-2 text-xs font-medium transition-colors',
                    priceMode === m.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex-1">
              <div className="relative flex items-center">
                <input
                  type="number"
                  min={priceMode === 'market' ? -50 : 0}
                  max={priceMode === 'market' ? 200 : 500}
                  step={1}
                  value={adjustPct}
                  onChange={e => setAdjustPct(Number(e.target.value))}
                  className={cn(
                    'w-full rounded-lg border border-border bg-secondary px-3 py-2 pr-8',
                    'text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary',
                  )}
                />
                <span className="absolute right-3 text-muted-foreground text-sm">%</span>
              </div>
            </div>
          </div>

          {unlistableCount > 0 && (
            <p className="text-[11px] text-amber-400/80 mt-2">
              {unlistableCount} card{unlistableCount !== 1 ? 's have' : ' has'} neither a cost nor
              eBay data, so no price can be derived. They&apos;ll import to stock unpriced.
            </p>
          )}

          {/* Per-card price preview */}
          <div className="mt-3">
              {pricedCards.length > 0 && (
                <div className="rounded-lg border border-border bg-secondary/40 overflow-hidden">
                  <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <span>Card</span>
                    <span className="text-right">eBay avg</span>
                    <span className="text-right">List price</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-border/50">
                    {listableCards.map(c => {
                      const listPrice = effectiveListPrice(c)
                      const isManual  = c.listed_price !== null
                      return (
                        <div key={c.uid} className="grid grid-cols-3 px-3 py-1.5 text-xs">
                          <span className="text-foreground truncate pr-2">
                            {c.overrides.card_name ?? c.card_name}
                          </span>
                          <span className="text-right text-muted-foreground tabular-nums">
                            {c.ebay_avg_sold ? formatGBP(c.ebay_avg_sold) : '—'}
                          </span>
                          <span className={cn(
                            'text-right font-medium tabular-nums',
                            isManual ? 'text-primary' : 'text-foreground',
                          )}>
                            {formatGBP(listPrice)}
                            {isManual && <span className="ml-0.5 text-[9px] text-primary/60">manual</span>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
        </div>

        {/* ── Listing mode ──────────────────────────────────────────── */}
        <div className="px-4 py-3.5">
          <p className="text-sm font-medium text-foreground mb-0.5">After import</p>
          <p className="text-xs text-muted-foreground mb-3">
            Cards are priced either way — this only decides where they go on eBay.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {([
              {
                id: 'none' as const,
                icon: <Package className="h-4 w-4" />,
                label: 'Stock only',
                hint: 'List later',
              },
              {
                id: 'individual' as const,
                icon: <Tag className="h-4 w-4" />,
                label: 'Individual',
                hint: `${listableCount} listing${listableCount !== 1 ? 's' : ''}`,
              },
              {
                id: 'set' as const,
                icon: <Boxes className="h-4 w-4" />,
                label: 'One set listing',
                hint: `${listableCount} variation${listableCount !== 1 ? 's' : ''}`,
              },
            ]).map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setListingMode(m.id)}
                aria-pressed={listingMode === m.id}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border px-3 py-3 transition-colors text-center',
                  listingMode === m.id
                    ? m.id === 'set'
                      ? 'border-teal-500/50 bg-teal-500/10 text-teal-400'
                      : 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {m.icon}
                <span className="text-xs font-medium">{m.label}</span>
                <span className="text-[10px] opacity-70">{m.hint}</span>
              </button>
            ))}
          </div>

          {/* Set listing title */}
          {listingMode === 'set' && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-muted-foreground">
                Listing title
              </label>
              <input
                type="text"
                value={setTitle}
                onChange={e => setSetTitle(e.target.value)}
                maxLength={80}
                placeholder="e.g. Black Star Promos — Complete Your Set!"
                className={cn(
                  'w-full rounded-lg border border-border bg-secondary px-3 py-2',
                  'text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary',
                  'placeholder:text-muted-foreground/40',
                )}
              />
              <p className="text-[10px] text-muted-foreground text-right">{setTitle.length}/80</p>

              {listableCount > 250 && (
                <p className="text-xs text-amber-400/90">
                  ⚠ eBay caps a listing at 250 variations. Only the first 250 would be
                  accepted — split this into multiple set listings.
                </p>
              )}
              {restockCount > 0 && mergeRestocks && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  The {restockCount} restocked card{restockCount !== 1 ? 's' : ''} won&apos;t be added
                  to this listing — {restockCount !== 1 ? 'they already belong' : 'it already belongs'} somewhere,
                  and re-adding would advertise the same stock twice.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {importError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {importError}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={onBack} disabled={isImporting}>
          ← Back
        </Button>
        <Button
          className="flex-1"
          onClick={handleImport}
          loading={isImporting}
          disabled={
            readyCards.length === 0 ||
            isImporting ||
            (listingMode === 'set' && setTitle.trim().length === 0)
          }
        >
          {listingMode === 'set'
            ? `Import ${readyCards.length} & create set listing`
            : listingMode === 'individual'
              ? `Import & list ${listableCount > 0 ? listableCount : readyCards.length} on eBay`
              : mergeRestocks && restockCount > 0
                ? `Import ${newCount} new · restock ${restockCount}`
                : `Import ${readyCards.length} card${readyCards.length !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}
