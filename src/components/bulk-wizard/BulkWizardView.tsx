'use client'
// =============================================================================
// BulkWizardView — three-phase Bulk Wizard orchestrator
//
// Phase 1 · Scan   — drop images, watch AI identify each card in real time
// Phase 2 · Cost   — enter total spend, see proportional breakdown per card
// Phase 3 · Import — review and confirm batch create to inventory
//
// The page is split into a fixed left toolbar panel (drop zone + controls)
// and a right content area that changes per phase.
// =============================================================================
import { useRef, useEffect, useState, useCallback } from 'react'
import { Lock, X, RotateCcw, ArrowRight, ChevronLeft, AlertTriangle, ImagePlus, CheckCircle2 } from 'lucide-react'
import { useBulkWizard }   from '@/hooks/useBulkWizard'
import { ScanDropZone }    from './ScanDropZone'
import { CardScanRow }     from './CardScanRow'
import { CostBreakdownTable } from './CostBreakdownTable'
import { ImportPanel }     from './ImportPanel'
import { Button }          from '@/components/ui/Button'
import { cn }              from '@/lib/utils'

// ── Phase step indicator ───────────────────────────────────────────────────────

function PhaseStep({
  num, label, active, done,
}: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', active ? 'text-foreground' : done ? 'text-primary' : 'text-muted-foreground/40')}>
      <span className={cn(
        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold flex-shrink-0',
        active ? 'bg-primary text-primary-foreground' :
        done   ? 'bg-primary/20 text-primary' :
                 'bg-secondary text-muted-foreground/40',
      )}>
        {done ? '✓' : num}
      </span>
      <span className="text-sm font-medium hidden sm:block">{label}</span>
    </div>
  )
}

function PhaseDivider({ done }: { done: boolean }) {
  return (
    <div className={cn('h-px flex-1 mx-2', done ? 'bg-primary/30' : 'bg-border')} />
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function BulkWizardView() {
  const wiz = useBulkWizard()
  const inputRef       = useRef<HTMLInputElement>(null)
  const backsInputRef  = useRef<HTMLInputElement>(null)

  const canProceed     = wiz.readyCount > 0

  // ── Batch backs mode ───────────────────────────────────────────────────────
  // When active, the right panel shows a bulk drop zone. Dropped images are
  // assigned in sequence to cards that don't yet have a back photo.
  const [batchBacksMode,    setBatchBacksMode]    = useState(false)
  const [backsAssignCount,  setBacksAssignCount]  = useState(0)
  const [isDraggingBacks,   setIsDraggingBacks]   = useState(false)

  const readyCards      = wiz.cards.filter(c => c.status === 'ready')
  const cardsWithoutBacks = readyCards.filter(c => !c.additionalImages?.length)
  const hasAnyBacks     = readyCards.some(c => c.additionalImages?.length)

  const assignBatchBacks = useCallback(async (files: File[]) => {
    const valid = files.filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
    if (!valid.length) return

    // Dynamically import to avoid bundling image utilities in SSR
    const { resizeImageToBase64 } = await import('@/lib/image')

    // Cards that still need backs (preserve insertion order)
    const targets = wiz.cards.filter(c => c.status === 'ready' && !c.additionalImages?.length)

    let assigned = 0
    for (let i = 0; i < Math.min(valid.length, targets.length); i++) {
      try {
        const b64    = await resizeImageToBase64(valid[i]!)
        const dataUrl = `data:image/jpeg;base64,${b64}`
        wiz.updateCard(targets[i]!.uid, { additionalImages: [dataUrl] })
        assigned++
      } catch {
        // Skip images that fail to process
      }
    }
    setBacksAssignCount(prev => prev + assigned)
  }, [wiz])

  function handleBacksDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingBacks(false)
    void assignBatchBacks(Array.from(e.dataTransfer.files))
  }

  function handleBacksFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    void assignBatchBacks(files)
  }

  // ── Navigation guard ──────────────────────────────────────────────────────
  // Warn the user if they try to close/refresh the tab while cards are loaded.
  // Next.js App Router has no built-in SPA nav guard, so we pair this with
  // a visible banner (below) for in-app navigation.
  useEffect(() => {
    if (wiz.cards.length === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Chrome requires returnValue to be set (any string triggers the dialog)
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [wiz.cards.length])

  return (
    <div className="flex flex-col h-full min-h-0 gap-0 -m-6">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
        {/* Phase stepper */}
        <div className="flex items-center flex-1 min-w-0">
          <PhaseStep num={1} label="Scan"   active={wiz.phase === 'scan'}   done={wiz.phase !== 'scan'} />
          <PhaseDivider done={wiz.phase !== 'scan'} />
          <PhaseStep num={2} label="Cost"   active={wiz.phase === 'cost'}   done={wiz.phase === 'import'} />
          <PhaseDivider done={wiz.phase === 'import'} />
          <PhaseStep num={3} label="Import" active={wiz.phase === 'import'} done={false} />
        </div>

        {/* Lock Set Code */}
        {wiz.phase === 'scan' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative flex items-center">
              <Lock className="absolute left-2.5 h-3 w-3 text-muted-foreground/50 pointer-events-none" />
              <input
                ref={inputRef}
                value={wiz.lockedSetCode}
                onChange={e => wiz.setLockedSetCode(e.target.value.toUpperCase())}
                placeholder="Lock set code"
                maxLength={10}
                className={cn(
                  'rounded-md border border-border bg-secondary pl-7 pr-3 py-1.5',
                  'text-xs font-mono text-foreground uppercase placeholder:normal-case placeholder:font-sans',
                  'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary w-32',
                  wiz.lockedSetCode && 'border-primary/50 bg-primary/5',
                )}
              />
              {wiz.lockedSetCode && (
                <button
                  onClick={() => wiz.setLockedSetCode('')}
                  className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Card count + clear */}
        {wiz.cards.length > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-muted-foreground">
              {wiz.readyCount}/{wiz.cards.length} ready
              {wiz.pendingCount > 0 && <span className="text-amber-400"> · {wiz.pendingCount} in progress</span>}
            </span>
            <button
              onClick={wiz.clearAll}
              title="Clear all cards"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── Unsaved-data warning banner ─────────────────────────────── */}
      {wiz.cards.length > 0 && (
        <div className="flex items-center gap-2 px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
          <p className="text-xs text-amber-300/90">
            Navigating away will clear your scanned cards — use <strong>Import</strong> to save them first.
          </p>
        </div>
      )}

      {/* ── Phase 1: Scan ───────────────────────────────────────────── */}
      {wiz.phase === 'scan' && (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: drop zone + controls (fixed width) */}
          <div className="w-72 flex-shrink-0 border-r border-border p-5 overflow-y-auto space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-0.5">Add cards</h2>
              <p className="text-xs text-muted-foreground">
                Drop photos or use your camera. AI identifies each card automatically.
              </p>
            </div>

            {/* Retro mode toggle */}
            <div className={cn(
              'flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors',
              wiz.retroMode
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-border bg-secondary/30',
            )}>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">Retro cards</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {wiz.retroMode
                    ? 'Using symbol detection (WOTC → BW era)'
                    : 'Sets with a printed code (modern)'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={wiz.retroMode}
                onClick={() => wiz.setRetroMode(!wiz.retroMode)}
                title={wiz.retroMode ? 'Switch to modern mode' : 'Switch to retro mode'}
                className={cn(
                  'relative ml-3 inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full',
                  'transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
                  wiz.retroMode ? 'bg-amber-500' : 'bg-secondary border border-border',
                )}
              >
                <span className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                  wiz.retroMode ? 'translate-x-4' : 'translate-x-0.5',
                )} />
              </button>
            </div>

            <ScanDropZone onFiles={wiz.addImages} disabled={false} />

            {/* Batch backs — shown when there are ready cards */}
            {readyCards.length > 0 && (
              <div className="border-t border-border/60 pt-4 space-y-2">
                <div>
                  <p className="text-xs font-medium text-foreground">Back photos</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {cardsWithoutBacks.length > 0
                      ? `${cardsWithoutBacks.length} card${cardsWithoutBacks.length !== 1 ? 's' : ''} without a back`
                      : 'All cards have backs'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setBatchBacksMode(v => !v); setBacksAssignCount(0) }}
                  className={cn(
                    'w-full flex items-center justify-center gap-1.5 rounded-md border py-2 text-xs font-medium transition-colors',
                    batchBacksMode
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary',
                  )}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  {batchBacksMode ? 'Exit backs mode' : 'Add backs in batch'}
                </button>
              </div>
            )}

            {/* Proceed CTA */}
            {canProceed && (
              <Button
                className="w-full"
                iconRight={<ArrowRight className="h-4 w-4" />}
                onClick={() => wiz.setPhase('cost')}
                disabled={wiz.pendingCount > 0}
              >
                {wiz.pendingCount > 0
                  ? `Identifying… (${wiz.pendingCount} left)`
                  : `Set budget →`}
              </Button>
            )}

            {wiz.cards.length === 0 && (
              <p className="text-center text-xs text-muted-foreground/50 italic pt-2">
                Cards appear on the right as they're identified
              </p>
            )}
          </div>

          {/* Right: card list or batch backs zone */}
          <div className="flex-1 overflow-y-auto p-5">
            {batchBacksMode && readyCards.length > 0 ? (
              /* ── Batch backs drop zone ───────────────────────────── */
              <div className="flex flex-col h-full gap-5">
                {/* Header */}
                <div>
                  <h3 className="text-sm font-semibold">Add back photos in batch</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Select or drop all back photos at once — they'll be assigned to cards in order,
                    starting with cards that don't have a back yet.
                  </p>
                </div>

                {/* Progress */}
                {backsAssignCount > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                    <span className="text-sm text-green-400">
                      {backsAssignCount} back photo{backsAssignCount !== 1 ? 's' : ''} assigned
                    </span>
                  </div>
                )}

                {/* Remaining count */}
                {cardsWithoutBacks.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {cardsWithoutBacks.length} card{cardsWithoutBacks.length !== 1 ? 's' : ''} still need a back photo
                  </p>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm text-primary font-medium">All cards have back photos!</span>
                  </div>
                )}

                {/* Drop zone */}
                <div
                  className={cn(
                    'flex-1 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-4',
                    'transition-colors cursor-pointer min-h-[200px]',
                    isDraggingBacks
                      ? 'border-primary/60 bg-primary/5 text-primary'
                      : 'border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                  onDragEnter={e => { e.preventDefault(); setIsDraggingBacks(true) }}
                  onDragOver={e => { e.preventDefault(); setIsDraggingBacks(true) }}
                  onDragLeave={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingBacks(false)
                  }}
                  onDrop={handleBacksDrop}
                  onClick={() => backsInputRef.current?.click()}
                >
                  <ImagePlus className="h-10 w-10 opacity-40" />
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      {isDraggingBacks ? 'Drop backs here' : 'Drop back photos or click to select'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      JPEG, PNG, WEBP — select multiple at once
                    </p>
                  </div>
                </div>

                <input
                  ref={backsInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleBacksFileInput}
                />

                {/* Mini thumbnail grid preview */}
                {readyCards.length > 0 && (
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-2">Cards in order ({readyCards.length} total)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {readyCards.map((card) => {
                        const hasBack = !!(card.additionalImages?.length)
                        return (
                          <div
                            key={card.uid}
                            title={card.card_name ?? 'Unknown'}
                            className={cn(
                              'relative w-8 h-10 rounded overflow-hidden border flex-shrink-0',
                              hasBack ? 'border-green-500/50' : 'border-border/50',
                            )}
                          >
                            {card.imageDataUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={card.imageDataUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-secondary flex items-center justify-center">
                                <span className="text-[8px]">🃏</span>
                              </div>
                            )}
                            {hasBack && (
                              <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-green-500" />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : wiz.cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <span className="text-6xl opacity-10">🃏</span>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No cards scanned yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Drop images on the left to get started
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {wiz.cards.map((card, i) => (
                  <CardScanRow
                    key={card.uid}
                    card={card}
                    index={i}
                    onRemove={wiz.removeCard}
                    onRetry={wiz.retryCard}
                    onUpdate={wiz.updateCard}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Phase 2: Cost ───────────────────────────────────────────── */}
      {wiz.phase === 'cost' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => wiz.setPhase('scan')}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to scan
              </button>
              <div className="flex-1" />
              <Button
                onClick={() => wiz.setPhase('import')}
                disabled={!canProceed}
                iconRight={<ArrowRight className="h-4 w-4" />}
              >
                Review import →
              </Button>
            </div>

            <CostBreakdownTable
              cards={wiz.computedCards}
              totalSpend={wiz.totalSpend}
              onSpendChange={wiz.setTotalSpend}
            />
          </div>
        </div>
      )}

      {/* ── Phase 3: Import ─────────────────────────────────────────── */}
      {wiz.phase === 'import' && (
        <div className="flex-1 overflow-y-auto p-6">
          <ImportPanel
            computedCards={wiz.computedCards}
            totalSpend={wiz.totalSpend}
            isImporting={wiz.isImporting}
            importError={wiz.importError}
            onImport={wiz.importAll}
            onBack={() => wiz.setPhase('cost')}
            onClearAll={wiz.clearAll}
          />
        </div>
      )}
    </div>
  )
}
