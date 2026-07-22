'use client'
// =============================================================================
// CreateSetListingModal — create a multi-variation "Complete Your Set" eBay
// listing from the current bulk selection.
//
// Flow:
//   idle    — form + card preview. Warns about missing prices / mixed conditions.
//   creating — POST in flight, spinner shown.
//   done    — success card with eBay listing link.
//
// Auto-detects:
//   set_code  — most common set code among selected cards
//   condition — most common condition (warning shown if mixed)
//   title     — "{SET_CODE} Pokémon Cards — Complete Your Set!" (editable)
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { X, ExternalLink, AlertTriangle, CheckCircle2, Layers, Loader2, RotateCcw, ImagePlus } from 'lucide-react'
import { cn, formatGBP } from '@/lib/utils'
import { useOrgSettings } from '@/hooks/useSettings'
import { buildSetListingDescription, setDisplayName } from '@/lib/listing-templates'
import type { Card } from '@/types'

type Phase = 'idle' | 'creating' | 'done'

interface Props {
  open:          boolean
  onClose:       () => void
  selectedCards: Card[]
  onSuccess:     () => void   // called after successful creation so parent can refetch + clear selection
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the most-common value from an array, or undefined. */
function mode<T>(arr: T[]): T | undefined {
  const counts = new Map<T, number>()
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | undefined
  let max = 0
  for (const [v, n] of counts) { if (n > max) { max = n; best = v } }
  return best
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CreateSetListingModal({ open, onClose, selectedCards, onSuccess }: Props) {
  const { data: orgSettings } = useOrgSettings()
  const [phase,   setPhase]   = useState<Phase>('idle')
  const [listingUrl, setListingUrl] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  // ── Auto-detected defaults ────────────────────────────────────────────────
  const autoSetCode   = useMemo(() => mode(selectedCards.map(c => c.set_code).filter(Boolean)) ?? '', [selectedCards])
  const autoCondition = useMemo(() => mode(selectedCards.map(c => c.condition)), [selectedCards])
  const mixedConditions = useMemo(() => {
    const unique = new Set(selectedCards.map(c => c.condition))
    return unique.size > 1
  }, [selectedCards])

  // Form state
  const [coverUrl,      setCoverUrl]      = useState<string | null>(null)
  const [coverUploading, setCoverUploading] = useState(false)
  const [title,     setTitle]     = useState('')
  const [description, setDescription] = useState('')
  const [condition, setCondition] = useState<string>('')

  // Re-seed when modal opens or selection changes
  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setError(null)
    setListingUrl(null)
    setCoverUrl(null)
    const setCode = mode(selectedCards.map(c => c.set_code).filter(Boolean)) ?? ''
    const cond    = mode(selectedCards.map(c => c.condition)) ?? 'NM'
    setCondition(cond)
    setTitle(
      setCode
        ? `${setCode} Pokémon Cards — Complete Your Set!`
        : 'Pokémon Cards — Complete Your Set!',
    )
    // Pre-fill from the saved template so every set listing reads consistently
    // without retyping. Fully editable before submitting.
    setDescription(buildSetListingDescription(orgSettings?.set_listing_template, {
      setName:   setDisplayName(setCode),
      condition: cond,
      shopName:  orgSettings?.shop_name,
    }))
  }, [open, selectedCards, orgSettings])

  /** Upload a cover image — leads the eBay gallery and becomes the search thumbnail */
  async function handleCoverUpload(file: File) {
    setCoverUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/images/listing-cover', { method: 'POST', body: fd })
      const json = await res.json() as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed')
      setCoverUrl(json.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover upload failed')
    } finally {
      setCoverUploading(false)
    }
  }

  /** Restore the description to the saved template, discarding local edits */
  function resetDescription() {
    const setCode = mode(selectedCards.map(c => c.set_code).filter(Boolean)) ?? ''
    setDescription(buildSetListingDescription(orgSettings?.set_listing_template, {
      setName:   setDisplayName(setCode),
      condition,
      shopName:  orgSettings?.shop_name,
    }))
  }

  if (!open) return null

  // ── Validation ────────────────────────────────────────────────────────────
  const unpriced    = selectedCards.filter(c => !c.listed_price)
  const readyCards  = selectedCards.filter(c => !!c.listed_price)
  const canSubmit   = readyCards.length > 0 && title.trim().length > 0 && phase === 'idle'

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!canSubmit) return
    setPhase('creating')
    setError(null)

    try {
      const res = await fetch('/api/ebay/set-listings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_ids:    readyCards.map(c => c.id),
          title:       title.trim(),
          description: description.trim(),
          set_code:    autoSetCode,
          condition,
          ...(coverUrl ? { cover_image_url: coverUrl } : {}),
        }),
      })

      const json = await res.json() as { set_listing?: { ebay_url?: string }; error?: string; message?: string }

      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? `Error ${res.status}`)
      }

      setListingUrl(json.set_listing?.ebay_url ?? null)
      setPhase('done')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setPhase('idle')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={phase === 'creating' ? undefined : onClose} />

      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <Layers className="h-5 w-5 text-teal-400 shrink-0" />
          <h2 className="font-semibold text-base flex-1">Create Set Listing</h2>
          {phase !== 'creating' && (
            <button
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ── DONE state ─────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <div className="flex flex-col items-center gap-4 px-5 py-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-400" />
            <div>
              <p className="font-semibold text-lg">Set listing created!</p>
              <p className="text-sm text-muted-foreground mt-1">
                {readyCards.length} card{readyCards.length !== 1 ? 's' : ''} are now live on eBay.
              </p>
            </div>
            {listingUrl && (
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-primary/15 border border-primary/30 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/25 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View on eBay
              </a>
            )}
            <button
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {/* ── IDLE / CREATING state ───────────────────────────────────────── */}
        {phase !== 'done' && (
          <>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Mixed condition warning */}
              {mixedConditions && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Selected cards have mixed conditions. eBay set listings use a single condition —
                    choose the one that best describes the majority of your cards.
                  </span>
                </div>
              )}

              {/* Unpriced warning */}
              {unpriced.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {unpriced.length} card{unpriced.length !== 1 ? 's have' : ' has'} no listed price
                    and will be skipped. Set a price in the stock table first.
                  </span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Cover image — first in the gallery, and the search thumbnail */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Cover image <span className="text-muted-foreground/60">(optional)</span>
                </label>

                {coverUrl ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-2">
                    <img
                      src={coverUrl}
                      alt="Listing cover"
                      className="h-20 w-20 rounded object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">Cover set</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Shown first in the gallery and used as the search thumbnail.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCoverUrl(null)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      aria-label="Remove cover image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border border-dashed border-border',
                    'px-3 py-4 text-xs text-muted-foreground cursor-pointer transition-colors',
                    'hover:border-primary/40 hover:text-foreground hover:bg-secondary/40',
                    coverUploading && 'opacity-60 pointer-events-none',
                  )}>
                    {coverUploading
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                      : <><ImagePlus className="h-3.5 w-3.5" /> Upload a cover image</>}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) void handleCoverUpload(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Without one, the gallery is built from your card photos.
                </p>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Listing Title <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. SVI Pokémon Cards — Complete Your Set!"
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground text-right">{title.length}/80</p>
              </div>

              {/* Condition */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Condition (listing-level)
                </label>
                <select
                  value={condition}
                  onChange={e => setCondition(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {(['NM', 'LP', 'MP', 'HP'] as const).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Description — pre-filled from the saved template */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Description
                  </label>
                  <button
                    type="button"
                    onClick={resetDescription}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset to template
                  </button>
                </div>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={10}
                  placeholder="Describe the listing, postage info, etc."
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground resize-y font-mono text-xs leading-relaxed"
                />
                <p className="text-[11px] text-muted-foreground">
                  Edit the saved template in Settings → eBay to change the default.
                </p>
              </div>

              {/* Card list preview */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Cards ({readyCards.length} ready{unpriced.length > 0 ? `, ${unpriced.length} skipped` : ''})
                </p>
                <div className="rounded-lg border border-border divide-y divide-border max-h-48 overflow-y-auto">
                  {selectedCards.map(card => (
                    <div
                      key={card.id}
                      className={cn(
                        'flex items-center justify-between px-3 py-2 text-sm',
                        !card.listed_price && 'opacity-40',
                      )}
                    >
                      <div className="min-w-0">
                        <span className="font-medium truncate block">{card.card_name}</span>
                        {card.card_number && (
                          <span className="text-xs text-muted-foreground">#{card.card_number}</span>
                        )}
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        {card.listed_price
                          ? <span className="font-medium tabular-nums">{formatGBP(card.listed_price)}</span>
                          : <span className="text-xs text-amber-400">No price</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
              <button
                onClick={onClose}
                disabled={phase === 'creating'}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleCreate() }}
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {phase === 'creating' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {phase === 'creating' ? 'Creating listing…' : `Create Set Listing (${readyCards.length} cards)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
