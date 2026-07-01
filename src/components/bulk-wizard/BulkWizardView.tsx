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
import { useRef }          from 'react'
import { Lock, X, RotateCcw, ArrowRight, ChevronLeft } from 'lucide-react'
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
  const inputRef = useRef<HTMLInputElement>(null)

  const canProceed = wiz.readyCount > 0

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

          {/* Right: identified card list */}
          <div className="flex-1 overflow-y-auto p-5">
            {wiz.cards.length === 0 ? (
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
