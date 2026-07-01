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
// =============================================================================
import { useState, useRef, useCallback } from 'react'
import { X, RefreshCw, ChevronDown, AlertCircle, Check, Pencil, ImagePlus, ExternalLink } from 'lucide-react'
import { cn, formatGBP }  from '@/lib/utils'
import { resizeImageToBase64 } from '@/lib/image'
import { CONDITIONS, FOIL_TYPES } from '@/components/stock/cardConstants'
import type { BulkWizardCard, CardCondition } from '@/types'

interface CardScanRowProps {
  card:     BulkWizardCard
  index:    number
  onRemove: (uid: string) => void
  onRetry:  (uid: string) => void
  onUpdate: (uid: string, patch: Partial<BulkWizardCard>) => void
}

// ── Status pill ────────────────────────────────────────────────────────────────

function StatusPill({ status, error }: { status: BulkWizardCard['status']; error?: string }) {
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

// ── Inline editable field ──────────────────────────────────────────────────────

function InlineText({
  value, placeholder, onSave, className,
}: { value: string; placeholder?: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onSave(draft); setEditing(false) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { onSave(draft); setEditing(false) }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={cn(
          'w-full rounded border border-primary bg-card px-1.5 py-0.5 text-xs text-foreground',
          'focus:outline-none focus:ring-1 focus:ring-primary',
          className,
        )}
      />
    )
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Click to edit"
      className={cn(
        'group flex items-center gap-1 text-left rounded px-1 -mx-1',
        'hover:bg-secondary/60 transition-colors',
        className,
      )}
    >
      <span className={value ? 'text-foreground' : 'text-muted-foreground/50 italic'}>
        {value || placeholder}
      </span>
      <Pencil className="h-2.5 w-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-colors flex-shrink-0" />
    </button>
  )
}

function InlineSelect<T extends string>({
  value, options, onSave,
}: { value: T; options: { value: T; label: string }[]; onSave: (v: T) => void }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        onChange={e => { onSave(e.target.value as T); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="rounded border border-primary bg-card px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-center gap-0.5 rounded px-1 -mx-1 hover:bg-secondary/60 transition-colors"
    >
      <span className="text-foreground">{options.find(o => o.value === value)?.label ?? value}</span>
      <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-colors" />
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CardScanRow({ card, index, onRemove, onRetry, onUpdate }: CardScanRowProps) {
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

  const setOverride = <K extends keyof BulkWizardCard['overrides']>(
    key: K,
    val: BulkWizardCard['overrides'][K],
  ) => {
    onUpdate(card.uid, { overrides: { ...card.overrides, [key]: val } })
  }

  const CONDITION_OPTIONS = CONDITIONS.filter(c => c.value !== 'Sealed')
  const FOIL_OPTIONS = FOIL_TYPES.map(f => ({ value: f, label: f }))

  // ── Additional photos ──────────────────────────────────────────────────────
  const addPhotoRef = useRef<HTMLInputElement>(null)
  const additionalImages = card.additionalImages ?? []

  const handleAddPhotos = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(f.type)
    )
    e.target.value = ''
    if (!files.length) return
    try {
      const newImgs = await Promise.all(
        files.map(async f => {
          const b64 = await resizeImageToBase64(f)
          return `data:image/jpeg;base64,${b64}`
        })
      )
      onUpdate(card.uid, {
        additionalImages: [...additionalImages, ...newImgs],
      })
    } catch {
      // Additional photos are optional — silently ignore resize errors
    }
  }, [card.uid, additionalImages, onUpdate])

  const removeAdditionalImage = useCallback((idx: number) => {
    onUpdate(card.uid, {
      additionalImages: additionalImages.filter((_, i) => i !== idx),
    })
  }, [card.uid, additionalImages, onUpdate])

  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg p-3 border transition-colors',
      isError  ? 'border-red-500/30 bg-red-500/5'  : 'border-border bg-card',
      isPending && 'animate-pulse-subtle',
    )}>
      {/* Thumbnail */}
      <div className={cn(
        'flex-shrink-0 w-12 h-16 rounded-md overflow-hidden border border-border',
        'flex items-center justify-center bg-secondary/40',
      )}>
        {card.imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.imageDataUrl}
            alt={cardName || `Card ${index + 1}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-lg text-muted-foreground/30">🃏</span>
        )}
      </div>

      {/* Card details */}
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

          <StatusPill status={card.status} error={card.error} />
        </div>

        {/* Row 2: set · number · condition · foil */}
        {isReady && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <InlineText
              value={setCode}
              placeholder="Set code"
              onSave={v => setOverride('set_code', v.toUpperCase())}
              className="font-mono uppercase"
            />
            <span className="text-border">·</span>
            <InlineText
              value={cardNumber}
              placeholder="#"
              onSave={v => setOverride('card_number', v)}
              className="font-mono"
            />
            <span className="text-border">·</span>
            <InlineSelect<CardCondition>
              value={condition}
              options={CONDITION_OPTIONS}
              onSave={v => setOverride('condition', v)}
            />
            <span className="text-border">·</span>
            <InlineSelect<string>
              value={foilType}
              options={FOIL_OPTIONS}
              onSave={v => setOverride('foil_type', v)}
            />
            {card.confidence > 0 && card.confidence < 0.7 && (
              <span className="text-amber-400/80 text-[10px]">
                ⚠ Low confidence — verify
              </span>
            )}
          </div>
        )}

        {/* Row 3: eBay price + sold search link */}
        {isReady && (
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            {card.ebay_avg_sold ? (
              <>
                <span className="text-green-400 font-semibold tabular-nums">
                  {formatGBP(card.ebay_avg_sold)}
                </span>
                <span className="text-muted-foreground/60">
                  avg sold ({card.ebay_sample_count} sales)
                </span>
              </>
            ) : (
              <span className="text-muted-foreground/50 italic">No eBay price found</span>
            )}
            {/* Always show sold-search link so user can verify or find price manually */}
            <a
              href={`https://www.ebay.co.uk/sch/i.html?${new URLSearchParams({
                _nkw:        [cardName, setCode, cardNumber.split('/')[0]].filter(Boolean).join(' '),
                LH_Sold:     '1',
                LH_Complete: '1',
                _sacat:      '183454',  // Pokémon TCG category
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

        {/* Row 4: Additional photos (back, edge, damage) */}
        {isReady && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {additionalImages.map((src, idx) => (
              <div
                key={idx}
                className="group relative w-7 h-9 rounded overflow-hidden border border-border flex-shrink-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Photo ${idx + 2}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeAdditionalImage(idx)}
                  title="Remove photo"
                  className={cn(
                    'absolute inset-0 flex items-center justify-center',
                    'bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity',
                  )}
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addPhotoRef.current?.click()}
              title="Add another photo (card back, edge, damage)"
              className={cn(
                'w-7 h-9 rounded border border-dashed flex-shrink-0',
                'flex items-center justify-center transition-colors',
                additionalImages.length === 0
                  ? 'border-border/50 text-muted-foreground/40 hover:border-primary/50 hover:text-primary/60'
                  : 'border-border/40 text-muted-foreground/30 hover:border-primary/40 hover:text-primary/50',
              )}
            >
              <ImagePlus className="h-3 w-3" />
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

      {/* Actions */}
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
  )
}
