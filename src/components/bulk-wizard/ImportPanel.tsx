'use client'
// =============================================================================
// ImportPanel — Phase 3: final review and import confirmation
//
// Shows a summary of what will be imported, lets the user optionally
// assign to a purchase lot, then confirms the batch import.
// =============================================================================
import { useState }     from 'react'
import { useRouter }    from 'next/navigation'
import { CheckCircle2, Package, TrendingUp, Layers, AlertCircle } from 'lucide-react'
import { useLots }      from '@/hooks/useLots'
import { Button }       from '@/components/ui/Button'
import { cn, formatGBP } from '@/lib/utils'
import type { BulkWizardCard } from '@/types'

interface ImportPanelProps {
  computedCards:  BulkWizardCard[]
  totalSpend:     number
  isImporting:    boolean
  importError:    string | null
  onImport:       (opts: { lot_id?: string; source?: string }) => Promise<{ created: number }>
  onBack:         () => void
}

export function ImportPanel({
  computedCards,
  totalSpend,
  isImporting,
  importError,
  onImport,
  onBack,
}: ImportPanelProps) {
  const router      = useRouter()
  const { data: lotsData } = useLots()
  const [lotId,   setLotId]   = useState('')
  const [source,  setSource]  = useState('Bulk Wizard')
  const [imported, setImported] = useState<number | null>(null)

  const readyCards   = computedCards.filter(c => c.status === 'ready' && c.card_name)
  const pricedCards  = readyCards.filter(c => c.proportional_cost !== null)
  const totalProfit  = readyCards.reduce((s, c) => s + (c.profit_potential ?? 0), 0)
  const lots         = lotsData?.data ?? []

  async function handleImport() {
    try {
      const result = await onImport({
        lot_id: lotId || undefined,
        source: source || 'Bulk Wizard',
      })
      setImported(result.created)
    } catch {
      // error is shown via importError prop
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (imported !== null) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
        <div className="flex items-center justify-center rounded-full p-4 bg-green-500/10 border border-green-500/20">
          <CheckCircle2 className="h-10 w-10 text-green-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {imported} card{imported !== 1 ? 's' : ''} added to stock
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            All cards are now in your inventory with proportional costs recorded.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => window.location.reload()}
          >
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
            icon:  <Package className="h-4 w-4" />,
            label: 'Cards to import',
            value: readyCards.length.toString(),
            colour: 'text-primary',
          },
          {
            icon:  <Layers className="h-4 w-4" />,
            label: 'Total invested',
            value: totalSpend > 0 ? formatGBP(totalSpend) : '—',
            colour: 'text-foreground',
          },
          {
            icon:  <TrendingUp className="h-4 w-4" />,
            label: 'Potential profit',
            value: pricedCards.length ? formatGBP(totalProfit) : '—',
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
          disabled={readyCards.length === 0 || isImporting}
        >
          Import {readyCards.length} card{readyCards.length !== 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  )
}
