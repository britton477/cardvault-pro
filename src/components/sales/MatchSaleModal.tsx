'use client'
// =============================================================================
// MatchSaleModal — resolve a needs-review sale by linking it to a card.
//
// A synced eBay order that couldn't be matched has revenue but no cost basis.
// This finds the card it came from. The search is pre-seeded from the eBay
// title, so likely matches are usually on screen the moment it opens.
//
// "Not from my stock" clears the flag without linking — for genuine one-offs
// that were never tracked as inventory.
// =============================================================================
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Search, Loader2, Package, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { cn, formatGBP } from '@/lib/utils'
import type { Sale, Card, PaginatedResponse } from '@/types'

interface Props {
  sale:    Sale | null
  onClose: () => void
}

/** Strip an eBay listing title down to something worth searching on. */
function seedQuery(sale: Sale): string {
  // eBay titles are noisy ("Pokemon TCG | Pyroar BREAK 24/114 | STS | LP").
  // The card_name field already holds the cleanest version we have.
  return (sale.card_name || '')
    .replace(/pok[eé]mon|tcg|\bnm\b|\blp\b|\bmp\b|\bhp\b|holo|swirl|full art/gi, ' ')
    .split(/\s+/)
    // Keep plain words only — drops emoji, "|", "#076/132" and other noise
    .filter(w => /^[A-Za-z][A-Za-z'-]*$/.test(w))
    .slice(0, 3)
    .join(' ')
    .trim()
}

export function MatchSaleModal({ sale, onClose }: Props) {
  const { toast } = useToast()
  const qc        = useQueryClient()

  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<Card[]>([])
  const [loading,  setLoading]  = useState(false)
  const [pending,  setPending]  = useState(false)

  // Seed the search from the sale, then run it
  useEffect(() => {
    if (!sale) return
    setQuery(seedQuery(sale))
  }, [sale])

  // Debounced card search — In Stock and Listed only, since a Sold card has no
  // stock to draw down.
  useEffect(() => {
    if (!sale) return
    let cancelled = false
    const q = query.trim()
    if (!q) { setResults([]); return }

    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: q, limit: '20' })
        const res = await fetch(`/api/cards?${params}`)
        if (!res.ok || cancelled) return
        const data = await res.json() as PaginatedResponse<Card>
        if (!cancelled) setResults(data.data ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, sale])

  if (!sale) return null

  async function submit(body: { card_id: string } | { dismiss: true }) {
    setPending(true)
    try {
      const res = await fetch(`/api/sales/${sale!.id}/match`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to match sale')
      }
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['cards'] })
      toast.success(
        'card_id' in body ? 'Sale matched' : 'Marked as resolved',
        'card_id' in body ? 'Cost basis and stock updated.' : undefined,
      )
      onClose()
    } catch (err) {
      toast.error('Could not match sale', err instanceof Error ? err.message : undefined)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog.Root open={!!sale} onOpenChange={o => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh] focus:outline-none">

          {/* Header */}
          <div className="flex items-start gap-3 px-5 py-4 border-b border-border shrink-0">
            <div className="rounded-full bg-amber-500/10 p-2 shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="font-semibold text-base">Match to a card</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-0.5">
                This eBay sale isn&apos;t linked to a card, so its cost is £0. Pick the card
                it came from to set the cost and draw down stock.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* The sale being matched */}
          <div className="px-5 py-3 border-b border-border bg-secondary/30 shrink-0">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium truncate">{sale.card_name}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">
                {formatGBP(sale.sold_price)} · {sale.qty_sold} sold
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="px-5 py-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search your cards…"
                autoFocus
                className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-5 pb-3 min-h-[160px]">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <Package className="h-7 w-7 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {query.trim() ? 'No cards match that search.' : 'Type to search your cards.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {results.map(card => {
                  const thumb = card.photos?.[0]?.thumb_url ?? card.photos?.[0]?.url
                  const soldOut = card.status === 'Sold' || card.qty === 0
                  return (
                    <button
                      key={card.id}
                      onClick={() => submit({ card_id: card.id })}
                      disabled={pending}
                      className="w-full flex items-center gap-3 rounded-lg border border-border p-2.5 text-left hover:border-primary/40 hover:bg-secondary/40 transition-colors disabled:opacity-50"
                    >
                      {thumb ? (
                        <img src={thumb} alt="" className="h-11 w-8 rounded object-cover shrink-0" />
                      ) : (
                        <div className="h-11 w-8 rounded bg-secondary flex items-center justify-center text-xs shrink-0">🃏</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{card.card_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[card.set_code, card.card_number ? `#${card.card_number}` : null, card.condition]
                            .filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs tabular-nums text-muted-foreground">
                          cost {formatGBP(card.purchase_price)}
                        </p>
                        <p className={cn(
                          'text-[11px] tabular-nums',
                          soldOut ? 'text-amber-400' : 'text-muted-foreground',
                        )}>
                          {soldOut ? 'no stock left' : `${card.qty} in stock`}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer — dismiss path */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
            <button
              onClick={() => void submit({ dismiss: true })}
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Not from my stock — just clear the flag
            </button>
            {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
