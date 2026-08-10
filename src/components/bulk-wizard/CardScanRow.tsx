'use client'
// =============================================================================
// CardScanRow — one identified card in the Bulk Wizard scan list
//
// States:
//   queued      → grey pulsing thumbnail, "Queued" pill
//   identifying → spinner, "Identifying…" pill
//   pricing     → card name visible, "Fetching price…" pill
//   ready       → full card details + eBay price + inline edit
//   error       → red row, error message, Retry button
//
// Inline editing: clicking any field opens a small input/select inline.
// The override is stored in card.overrides (never mutates AI data).
//
// List price: editable on the scan row — auto-suggests 10% above eBay avg,
// flows through to the import + eBay listing step.
//
// Image crop: CropModal (file mode) on both the primary thumbnail and any
// additional photos — updates the in-memory data URL without a server round-trip.
// =============================================================================
import { useState, useRef, useCallback, memo } from 'react'
import { X, RefreshCw, AlertCircle, Check, Pencil, ImagePlus, ExternalLink, Crop, RotateCcw } from 'lucide-react'
import { cn, formatGBP }        from '@/lib/utils'
import { getSetName }           from '@/lib/pokemon-sets'
import { resizeImageToBase64, fileToDataUrl, dataUrlToFile } from '@/lib/image'
import { CONDITIONS, FOIL_TYPES, GRADERS } from '@/components/stock/cardConstants'
import { CropModal }            from '@/components/stock/CropModal'
import { InlineText, InlineSelect, InlineNumber } from '@/components/shared/InlineField'
import { NetProceeds }          from '@/components/shared/NetProceeds'
import { RARITIES }             from '@/lib/rarity'
import type { SellerModel }     from '@/lib/fees'
import type { BulkWizardCard, CardCondition, Rarity } from '@/types'

interface CardScanRowProps {
  card:     BulkWizardCard
  index:    number
  onRemove: (uid: string) => void
  onRetry:  (uid: string) => void
  onUpdate: (uid: string, patch: Partial<BulkWizardCard>) => void
  /** Passed from the parent (computed once) so 100+ rows don't each subscribe. */
  sellerModel: SellerModel
}

// ── Status pill ────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: BulkWizardCard['status'] }) {
  const styles: Record<BulkWizardCard['status'], string> = {
    queued:      'bg-secondary text-muted-foreground',
    identifying: 'bg-blue-500/15 text-blue-400',
    pricing:     'bg-violet-500/15 text-violet-400',
    ready:       'bg-green-500/15 text-green-400',
    error:       'bg-red-500/15 text-red-400',
  }
  const labels: Record<BulkWizardCard['status'], string> = {
    queued:      'Queued',
    identifying: 'Identifying…',
    pricing:     'Pricing…',
    ready:       'Ready',
    error:       'Error',
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      styles[status],
    )}>
      {(status === 'identifying' || status === 'pricing') && (
        <span className="h-2 w-2 rounded-full border border-current border-t-transparent animate-spin" />
      )}
      {labels[status]}
    </span>
  )
}

// ── Set code editor ───────────────────────────────────────────────────────────
// Displays the full set name (e.g. "Lost Origin") but edits the short code (e.g. "LOR").
// The underlying data is always the code — the full name is derived for display only.

function SetCodeEditor({ setCode, onSave }: { setCode: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(setCode)

  const displayName = getSetName(setCode) || setCode

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onSave(draft); setEditing(false) }}
        onKeyDown={e => {
          if (e.key === 'Enter')  { onSave(draft); setEditing(false) }
          if (e.key === 'Escape') { setDraft(setCode); setEditing(false) }
        }}
        placeholder="Set code (e.g. LOR)"
        className="rounded border border-primary bg-card px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono uppercase w-28"
      />
    )
  }

  return (
    <button
      onClick={() => { setDraft(setCode); setEditing(true) }}
      title={`Set code: ${setCode || '—'} — click to edit`}
      className="group flex items-center gap-1 rounded px-1 -mx-1 hover:bg-secondary/60 transition-colors"
    >
      <span className={displayName ? 'text-foreground' : 'text-muted-foreground/50 italic'}>
        {displayName || 'Set code'}
      </span>
      <Pencil className="h-2.5 w-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-colors flex-shrink-0" />
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

function CardScanRowImpl({ card, index, onRemove, onRetry, onUpdate, sellerModel }: CardScanRowProps) {
  const isActive  = card.status !== 'queued'
  const isError   = card.status === 'error'
  const isReady   = card.status === 'ready'
  const isPending = card.status === 'identifying' || card.status === 'pricing'

  // Effective values: override takes precedence over AI result
  const cardName   = card.overrides.card_name   ?? card.card_name
  const setCode    = card.overrides.set_code    ?? card.set_code
  const cardNumber = card.overrides.card_number ?? card.card_number
  const condition  = card.overrides.condition   ?? card.condition
  const foilType   = card.overrides.foil_type   ?? card.foil_type
  const rarity     = card.overrides.rarity      ?? card.rarity
  const isGraded   = card.overrides.is_graded   ?? card.is_graded
  const grader     = card.overrides.grader      ?? card.grader
  const grade      = card.overrides.grade       ?? card.grade

  const setOverride = <K extends keyof BulkWizardCard['overrides']>(
    key: K,
    val: BulkWizardCard['overrides'][K],
  ) => {
    onUpdate(card.uid, { overrides: { ...card.overrides, [key]: val } })
  }

  const CONDITION_OPTIONS = CONDITIONS.filter(c => c.value !== 'Sealed')
  const FOIL_OPTIONS      = FOIL_TYPES.map(f => ({ value: f, label: f }))
  const RARITY_OPTIONS    = RARITIES.map(r => ({ value: r, label: r }))
  const GRADER_OPTIONS    = GRADERS.map(g => ({ value: g, label: g }))

  // ── Additional photos ──────────────────────────────────────────────────────
  const addPhotoRef      = useRef<HTMLInputElement>(null)
  const additionalImages = card.additionalImages ?? []
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const processImageFiles = useCallback(async (files: File[]) => {
    const valid = files.filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
    if (!valid.length) return
    try {
      const newImgs = await Promise.all(
        valid.map(async f => {
          const b64 = await resizeImageToBase64(f)
          return `data:image/jpeg;base64,${b64}`
        })
      )
      onUpdate(card.uid, { additionalImages: [...(card.additionalImages ?? []), ...newImgs] })
    } catch {
      // Additional photos are optional — silently ignore resize errors
    }
  }, [card.uid, card.additionalImages, onUpdate])

  const handleAddPhotos = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await processImageFiles(files)
  }, [processImageFiles])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    await processImageFiles(Array.from(e.dataTransfer.files))
  }, [processImageFiles])

  const removeAdditionalImage = useCallback((idx: number) => {
    onUpdate(card.uid, {
      additionalImages: additionalImages.filter((_, i) => i !== idx),
    })
  }, [card.uid, additionalImages, onUpdate])

  // ── Crop ──────────────────────────────────────────────────────────────────
  // cropTarget: null = closed, 'primary' = main thumbnail, number = additionalImages index
  const [cropTarget, setCropTarget] = useState<'primary' | number | null>(null)

  // Which data URL goes into the crop modal?
  const cropSrc = cropTarget === null
    ? null
    : cropTarget === 'primary'
      ? card.imageDataUrl
      : additionalImages[cropTarget] ?? null

  // Convert data URL → File for CropModal (file mode)
  const cropFile = cropSrc ? dataUrlToFile(cropSrc, 'crop-source.jpg') : null

  const handleCropConfirm = useCallback(async (blob: Blob) => {
    try {
      const newDataUrl = await fileToDataUrl(blob)
      if (cropTarget === 'primary') {
        onUpdate(card.uid, { imageDataUrl: newDataUrl })
      } else if (typeof cropTarget === 'number') {
        const updated = [...additionalImages]
        updated[cropTarget] = newDataUrl
        onUpdate(card.uid, { additionalImages: updated })
      }
    } catch {
      // Silently ignore — original image remains unchanged
    } finally {
      setCropTarget(null)
    }
  }, [card.uid, cropTarget, additionalImages, onUpdate])

  // ── eBay price refresh ────────────────────────────────────────────────────
  const [isPriceRefreshing, setIsPriceRefreshing] = useState(false)

  async function handleRefreshPrice() {
    if (isPriceRefreshing) return
    setIsPriceRefreshing(true)
    try {
      const qs = new URLSearchParams({ card_name: cardName })
      if (setCode)    qs.set('set_code',    setCode)
      if (cardNumber) qs.set('card_number', cardNumber)
      // A slab prices completely differently from a raw copy — search graded
      // comps (grader + grade) and drop the raw condition, which is meaningless
      // for a graded card. Otherwise fall back to the raw condition search.
      if (isGraded) {
        qs.set('is_graded', 'true')
        if (grader) qs.set('grader', grader)
        if (grade)  qs.set('grade',  grade)
      } else if (condition) {
        qs.set('condition', condition)
      }
      const res = await fetch(`/api/ebay/price?${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { median_price?: number | null; price_count?: number }
      if (json.median_price != null) {
        onUpdate(card.uid, {
          ebay_avg_sold:     json.median_price,
          ebay_sample_count: json.price_count ?? 0,
        })
      } else {
        onUpdate(card.uid, { ebay_avg_sold: null, ebay_sample_count: 0 })
      }
    } catch {
      // Silently ignore — stale price stays displayed
    } finally {
      setIsPriceRefreshing(false)
    }
  }

  // ── List price helpers ─────────────────────────────────────────────────────
  const suggestedPrice = card.ebay_avg_sold
    ? Math.round(card.ebay_avg_sold * 1.1 * 100) / 100
    : null

  return (
    <>
      <div className={cn(
        'flex items-start gap-3 rounded-lg p-3 border transition-colors',
        isError  ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-card',
        isPending && 'animate-pulse-subtle',
      )}>

        {/* ── Thumbnail with crop on hover ──────────────────────────── */}
        <div className={cn(
          'group relative flex-shrink-0 w-12 h-16 rounded-md overflow-hidden border border-border',
          'flex items-center justify-center bg-secondary/40',
        )}>
          {card.imageDataUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.imageDataUrl}
                alt={cardName || `Card ${index + 1}`}
                className="w-full h-full object-cover"
              />
              {isReady && (
                <button
                  onClick={() => setCropTarget('primary')}
                  title="Crop image"
                  className={cn(
                    'absolute inset-0 flex items-center justify-center',
                    'bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity',
                  )}
                >
                  <Crop className="h-4 w-4 text-white" />
                </button>
              )}
            </>
          ) : (
            <span className="text-lg text-muted-foreground/30">🃏</span>
          )}
        </div>

        {/* ── Card details ──────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-1">

          {/* Row 1: name + status */}
          <div className="flex items-center gap-2 flex-wrap">
            {isReady || isPending ? (
              <div className="text-sm font-medium text-foreground min-w-0 flex-1">
                {isReady ? (
                  <InlineText
                    value={cardName}
                    placeholder="Unknown card"
                    onSave={v => setOverride('card_name', v)}
                  />
                ) : (
                  <span className="text-muted-foreground">{cardName || `Card ${index + 1}`}</span>
                )}
              </div>
            ) : isError ? (
              <span className="text-sm text-red-400 font-medium">
                {card.error ?? 'Identification failed'}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{`Card ${index + 1}`}</span>
            )}
            <StatusPill status={card.status} />
          </div>

          {/* Row 2: set · number · condition · foil */}
          {isReady && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {/* Set name — displays full name, edits the underlying set code */}
              <SetCodeEditor
                setCode={setCode}
                onSave={v => setOverride('set_code', v.toUpperCase())}
              />
              <span className="text-border">·</span>
              <InlineText
                value={cardNumber}
                placeholder="#"
                onSave={v => setOverride('card_number', v)}
                className="font-mono"
              />
              {/* Condition is meaningless for a slabbed card — the grade replaces it. */}
              {!isGraded && (
                <>
                  <span className="text-border">·</span>
                  <InlineSelect<CardCondition>
                    value={condition}
                    options={CONDITION_OPTIONS}
                    onSave={v => setOverride('condition', v)}
                  />
                </>
              )}
              <span className="text-border">·</span>
              <InlineSelect<string>
                value={foilType}
                options={FOIL_OPTIONS}
                onSave={v => setOverride('foil_type', v)}
              />
              <span className="text-border">·</span>
              <InlineSelect<Rarity>
                value={rarity}
                options={RARITY_OPTIONS}
                onSave={v => setOverride('rarity', v)}
              />
              {card.confidence > 0 && card.confidence < 0.7 && (
                <span className="text-amber-400/80 text-[10px]">
                  ⚠ Low confidence — verify
                </span>
              )}
            </div>
          )}

          {/* Row 2b: grading — user-specified; grade stands in for condition */}
          {isReady && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setOverride('is_graded', !isGraded)}
                title="Toggle graded / raw"
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                  isGraded ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground',
                )}
              >
                {isGraded ? 'Graded' : 'Raw'}
              </button>
              {isGraded && (
                <>
                  <InlineSelect<string>
                    value={grader ?? 'PSA'}
                    options={GRADER_OPTIONS}
                    onSave={v => setOverride('grader', v)}
                  />
                  <InlineText
                    value={grade ?? ''}
                    placeholder="grade (e.g. 10)"
                    onSave={v => setOverride('grade', v)}
                    className="w-16"
                  />
                </>
              )}
            </div>
          )}

          {/* Row 3: eBay avg price + refresh + sold search link */}
          {isReady && (
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              {/* Editable — a manual correction here also re-derives purchase cost
                  (proportional split is recomputed in the wizard on change). */}
              <span className="text-green-400 font-semibold">
                <InlineNumber
                  value={card.ebay_avg_sold}
                  prefix="£"
                  placeholder="Set eBay price"
                  onSave={v => onUpdate(card.uid, {
                    ebay_avg_sold:     v,
                    ebay_sample_count: v == null ? 0 : card.ebay_sample_count,
                  })}
                />
              </span>
              {card.ebay_avg_sold != null && card.ebay_sample_count > 0 && (
                <span className="text-muted-foreground/60">
                  avg sold ({card.ebay_sample_count} sales)
                </span>
              )}
              {/* Refresh eBay price — useful after editing card name / set code */}
              <button
                type="button"
                onClick={() => { void handleRefreshPrice() }}
                title="Re-fetch eBay price with current card details"
                disabled={isPriceRefreshing}
                className="inline-flex items-center gap-0.5 text-muted-foreground/40 hover:text-primary/70 transition-colors disabled:opacity-50"
              >
                <RotateCcw className={cn('h-3 w-3', isPriceRefreshing && 'animate-spin')} />
              </button>
              {/* eBay sold search — always visible so user can verify manually */}
              <a
                href={`https://www.ebay.co.uk/sch/i.html?${new URLSearchParams({
                  _nkw:        [cardName, setCode, cardNumber.split('/')[0]].filter(Boolean).join(' '),
                  LH_Sold:     '1',
                  LH_Complete: '1',
                  _sacat:      '183454',
                }).toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View eBay sold listings"
                className="inline-flex items-center gap-0.5 text-muted-foreground/40 hover:text-primary/70 transition-colors ml-0.5"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Row 4: List price — set per-card here, flows to import + eBay listing */}
          {isReady && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground/60 flex-shrink-0">List at</span>
              <div className="relative flex items-center">
                <span className="absolute left-2 text-muted-foreground/50 text-[11px] pointer-events-none">£</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={card.listed_price ?? ''}
                  onChange={e => onUpdate(card.uid, {
                    listed_price: e.target.value !== '' ? parseFloat(e.target.value) : null,
                  })}
                  placeholder={suggestedPrice ? suggestedPrice.toFixed(2) : '0.00'}
                  className={cn(
                    'w-20 rounded border bg-secondary px-5 py-0.5 text-xs text-foreground tabular-nums',
                    'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary',
                    card.listed_price !== null
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border',
                  )}
                />
              </div>
              {/* Quick-fill: 10% above eBay avg */}
              {suggestedPrice && card.listed_price === null && (
                <button
                  type="button"
                  onClick={() => onUpdate(card.uid, { listed_price: suggestedPrice })}
                  title={`Set to ${formatGBP(suggestedPrice)} (10% above eBay avg)`}
                  className="text-[10px] text-muted-foreground/40 hover:text-primary/60 transition-colors"
                >
                  +10%
                </button>
              )}
              {card.listed_price !== null && (
                <button
                  type="button"
                  onClick={() => onUpdate(card.uid, { listed_price: null })}
                  title="Clear list price"
                  className="text-muted-foreground/40 hover:text-red-400/60 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {/* What you actually receive, excluding postage. */}
              <NetProceeds listPrice={card.listed_price} sellerModel={sellerModel} className="ml-1" />
            </div>
          )}

          {/* Row 5: Additional photos + drag-and-drop zone */}
          {isReady && (
            <div
              className={cn(
                'flex items-center gap-1 mt-0.5 flex-wrap rounded-md transition-colors',
                isDraggingOver && 'outline outline-1 outline-primary/50 bg-primary/5',
              )}
              onDragEnter={e => { e.preventDefault(); setIsDraggingOver(true) }}
              onDragOver={e => { e.preventDefault(); setIsDraggingOver(true) }}
              onDragLeave={e => {
                // Only clear if leaving the row entirely (not entering a child)
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false)
              }}
              onDrop={e => { void handleDrop(e) }}
            >
              {additionalImages.map((src, idx) => (
                <div
                  key={idx}
                  className="group relative w-7 h-9 rounded overflow-hidden border border-border flex-shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Photo ${idx + 2}`} className="w-full h-full object-cover" />
                  {/* Hover overlay: crop left, delete right */}
                  <div className={cn(
                    'absolute inset-0 flex items-center justify-center gap-0.5',
                    'bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity',
                  )}>
                    <button
                      onClick={() => setCropTarget(idx)}
                      title="Crop photo"
                      className="p-0.5 text-white hover:text-primary transition-colors"
                    >
                      <Crop className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={() => removeAdditionalImage(idx)}
                      title="Remove photo"
                      className="p-0.5 text-white hover:text-red-400 transition-colors"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Drop zone / add button — wider when no images yet */}
              <button
                type="button"
                onClick={() => addPhotoRef.current?.click()}
                title="Add back photo — click or drag & drop"
                className={cn(
                  'h-9 rounded border border-dashed flex-shrink-0 transition-colors',
                  'flex items-center justify-center gap-1',
                  additionalImages.length === 0
                    ? 'w-28 border-border/50 text-muted-foreground/40 hover:border-primary/50 hover:text-primary/60'
                    : 'w-7 border-border/40 text-muted-foreground/30 hover:border-primary/40 hover:text-primary/50',
                  isDraggingOver && 'border-primary/60 text-primary/70 bg-primary/5',
                )}
              >
                <ImagePlus className="h-3 w-3 flex-shrink-0" />
                {additionalImages.length === 0 && (
                  <span className="text-[10px] whitespace-nowrap">
                    {isDraggingOver ? 'Drop here' : 'Add back photo'}
                  </span>
                )}
              </button>

              <input
                ref={addPhotoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={handleAddPhotos}
              />
            </div>
          )}
        </div>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isError && (
            <button
              onClick={() => onRetry(card.uid)}
              title="Retry identification"
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => onRemove(card.uid)}
            title="Remove card"
            className="rounded-md p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Crop modal — rendered outside the row so it overlays the full page ── */}
      {cropFile && (
        <CropModal
          open={cropTarget !== null}
          mode="file"
          file={cropFile}
          title={cropTarget === 'primary' ? 'Crop card photo' : 'Crop additional photo'}
          onCancel={() => setCropTarget(null)}
          onConfirmFile={blob => { void handleCropConfirm(blob) }}
        />
      )}
    </>
  )
}

// Memoised: in a 100+ card batch, editing one card must not re-render every row.
// updateCard keeps unchanged cards' object identity, so only the edited row and
// rows whose props actually changed re-render.
export const CardScanRow = memo(CardScanRowImpl)
