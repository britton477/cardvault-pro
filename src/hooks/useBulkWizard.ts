'use client'
// =============================================================================
// useBulkWizard — state machine for the Bulk Wizard feature
//
// Manages the full lifecycle:
//   Phase 1 · scan  — images added, each fires identify → price in series
//   Phase 2 · cost  — user enters totalSpend; costs computed client-side
//   Phase 3 · import — batch POST to /api/bulk-wizard/import
//
// Concurrency: up to MAX_CONCURRENT identify requests fire simultaneously.
// This keeps latency low without hammering the Anthropic API.
//
// Image handling: base64 strings are kept in React state (memory) only.
// They are never written to localStorage, Supabase Storage, or any DB column.
// =============================================================================
import { useState, useCallback, useMemo, useRef } from 'react'
import { resizeImageToBase64 }                      from '@/lib/image'
import type {
  BulkWizardCard,
  BulkWizardPhase,
  BulkCardStatus,
  BulkIdentifyResponse,
  BulkPriceResponse,
  CardCondition,
} from '@/types'

// At most 3 identify requests in-flight at once
const MAX_CONCURRENT = 3

// ── Pure cost-computation ──────────────────────────────────────────────────────

function computeCosts(
  cards: BulkWizardCard[],
  totalSpend: number,
): BulkWizardCard[] {
  if (totalSpend <= 0) {
    return cards.map(c => ({
      ...c,
      proportional_cost: null,
      profit_potential:  null,
      roi_pct:           null,
    }))
  }

  const pricedCards     = cards.filter(c => (c.ebay_avg_sold ?? 0) > 0)
  const totalMarketValue = pricedCards.reduce((s, c) => s + c.ebay_avg_sold!, 0)

  return cards.map(c => {
    if (!c.ebay_avg_sold || totalMarketValue === 0) {
      return { ...c, proportional_cost: null, profit_potential: null, roi_pct: null }
    }
    const weight            = c.ebay_avg_sold / totalMarketValue
    const proportional_cost = totalSpend * weight
    const profit_potential  = c.ebay_avg_sold - proportional_cost
    const roi_pct           = proportional_cost > 0
      ? (profit_potential / proportional_cost) * 100
      : null
    return {
      ...c,
      proportional_cost: Math.round(proportional_cost * 100) / 100,
      profit_potential:  Math.round(profit_potential  * 100) / 100,
      roi_pct:           roi_pct !== null ? Math.round(roi_pct * 10) / 10 : null,
    }
  })
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiIdentify(
  imageBase64: string,
  setCode?: string,
  retroMode?: boolean,
): Promise<BulkIdentifyResponse> {
  const res = await fetch('/api/bulk-wizard/identify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      image:      imageBase64,
      set_code:   setCode || undefined,
      retro_mode: retroMode || undefined,
    }),
  })
  if (!res.ok) {
    const err = await res.json() as { error?: string }
    throw new Error(err.error ?? `Identify failed: ${res.status}`)
  }
  return res.json() as Promise<BulkIdentifyResponse>
}

async function apiPrice(
  card_name:   string,
  set_code?:   string,
  card_number?: string,
  condition?:  string,
): Promise<BulkPriceResponse> {
  const res = await fetch('/api/bulk-wizard/price', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ card_name, set_code, card_number, condition }),
  })
  if (!res.ok) {
    const err = await res.json() as { error?: string }
    throw new Error(err.error ?? `Price lookup failed: ${res.status}`)
  }
  return res.json() as Promise<BulkPriceResponse>
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface BulkWizardHook {
  // State
  cards:          BulkWizardCard[]
  phase:          BulkWizardPhase
  totalSpend:     number
  lockedSetCode:  string
  retroMode:      boolean
  isImporting:    boolean
  importError:    string | null

  // Derived
  computedCards:  BulkWizardCard[]  // cards with proportional_cost etc filled in
  readyCount:     number            // cards with status === 'ready'
  pendingCount:   number            // cards still in-flight

  // Actions
  addImages:       (files: File[]) => void
  removeCard:      (uid: string) => void
  updateCard:      (uid: string, patch: Partial<BulkWizardCard>) => void
  retryCard:       (uid: string) => void
  clearAll:        () => void
  setPhase:        (p: BulkWizardPhase) => void
  setTotalSpend:   (n: number) => void
  setLockedSetCode:(s: string) => void
  setRetroMode:    (on: boolean) => void
  importAll:       (opts: { lot_id?: string; source?: string }) => Promise<{ created: number }>
}

export function useBulkWizard(): BulkWizardHook {
  const [cards,         _setCards]        = useState<BulkWizardCard[]>([])
  const cardsRef                          = useRef<BulkWizardCard[]>([])
  const [phase,         setPhase]         = useState<BulkWizardPhase>('scan')
  const [totalSpend,    setTotalSpend]    = useState(0)
  const [lockedSetCode, setLockedSetCode] = useState('')
  const [retroMode,     setRetroMode]     = useState(false)
  const [isImporting,   setIsImporting]   = useState(false)
  const [importError,   setImportError]   = useState<string | null>(null)

  // Wrapper keeps cardsRef in sync so async callbacks can read current cards
  // without triggering renders and without the state-as-getter antipattern.
  const setCards = useCallback(
    (updater: BulkWizardCard[] | ((prev: BulkWizardCard[]) => BulkWizardCard[])) => {
      _setCards(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        cardsRef.current = next
        return next
      })
    },
    [],
  )

  // Track in-flight identify count without triggering re-renders
  const inFlightRef = useRef(0)
  // Queue of UIDs waiting to be processed when a slot opens
  const queueRef    = useRef<string[]>([])

  // ── Card updater ──────────────────────────────────────────────────────────
  const updateCard = useCallback((uid: string, patch: Partial<BulkWizardCard>) => {
    setCards(prev => prev.map(c => c.uid === uid ? { ...c, ...patch } : c))
  }, [setCards])

  // ── Run the identify → price pipeline for one card ────────────────────────
  const runPipeline = useCallback(async (uid: string, setCodeOverride?: string) => {
    // Read current card directly from the ref — no render side-effect
    const card = cardsRef.current.find(c => c.uid === uid)
    if (!card || card.status === 'ready') return

    inFlightRef.current++
    updateCard(uid, { status: 'identifying', error: undefined })

    try {
      // Step 1: Identify — strip data URL prefix (API needs raw base64)
      const rawBase64 = card.imageDataUrl.replace(/^data:[^;]+;base64,/, '')
      const identified = await apiIdentify(
        rawBase64,
        setCodeOverride || lockedSetCode || undefined,
        retroMode,
      )

      updateCard(uid, {
        status:      'pricing',
        card_name:   identified.card_name,
        set_code:    identified.set_code,
        card_number: identified.card_number,
        condition:   identified.condition as CardCondition,
        foil_type:   identified.foil_type,
        language:    identified.language,
        confidence:  identified.confidence,
      })

      // Step 2: Price (immediately after identify — no wait)
      try {
        const priced = await apiPrice(
          identified.card_name,
          identified.set_code,
          identified.card_number,
          identified.condition,
        )
        updateCard(uid, {
          status:            'ready',
          ebay_avg_sold:     priced.avg_sold > 0 ? priced.avg_sold : null,
          ebay_sample_count: priced.sample_count,
        })
      } catch {
        // Price failure is non-fatal — card is still usable
        updateCard(uid, { status: 'ready', ebay_avg_sold: null, ebay_sample_count: 0 })
      }

    } catch (err) {
      updateCard(uid, {
        status: 'error',
        error:  err instanceof Error ? err.message : 'Identification failed',
      })
    } finally {
      inFlightRef.current--

      // Drain the queue if a slot has opened
      const nextUid = queueRef.current.shift()
      if (nextUid) {
        void runPipeline(nextUid)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateCard, lockedSetCode, retroMode])

  // ── Schedule a card through the concurrency-limited pipeline ─────────────
  const schedule = useCallback((uid: string) => {
    if (inFlightRef.current < MAX_CONCURRENT) {
      void runPipeline(uid)
    } else {
      queueRef.current.push(uid)
    }
  }, [runPipeline])

  // ── Add images ────────────────────────────────────────────────────────────
  const addImages = useCallback((files: File[]) => {
    // Process files sequentially to avoid blocking the main thread
    files.forEach(file => {
      const uid = crypto.randomUUID()

      // Add as queued immediately so the UI renders the row
      const blankCard: BulkWizardCard = {
        uid,
        imageDataUrl:      '',
        additionalImages:  [],
        status:            'queued',
        card_name:         '',
        set_code:          lockedSetCode,
        card_number:       '',
        condition:         'NM',
        foil_type:         'Normal',
        language:          'EN',
        confidence:        0,
        overrides:         {},
        ebay_avg_sold:     null,
        ebay_sample_count: 0,
        proportional_cost: null,
        profit_potential:  null,
        roi_pct:           null,
      }

      setCards(prev => [...prev, blankCard])

      // Resize then schedule (async — UI is already updated)
      void (async () => {
        try {
          // Use the resized base64 for both the API payload and the preview
          const base64    = await resizeImageToBase64(file)
          const dataUrl   = `data:image/jpeg;base64,${base64}`

          // Store the resized preview and the raw base64 for the API.
          // We reuse imageDataUrl for both (it IS the base64, with the prefix stripped when sending).
          // IMPORTANT: update cardsRef synchronously BEFORE calling schedule() so that
          // runPipeline() immediately reads the correct imageDataUrl from the ref.
          // setCards() schedules an async React state update — cardsRef would still
          // hold imageDataUrl:'' when runPipeline() runs if we relied on that alone.
          cardsRef.current = cardsRef.current.map(c =>
            c.uid === uid ? { ...c, imageDataUrl: dataUrl } : c
          )
          setCards(prev => prev.map(c =>
            c.uid === uid ? { ...c, imageDataUrl: dataUrl } : c
          ))

          schedule(uid)
        } catch {
          updateCard(uid, { status: 'error', error: 'Failed to read image file' })
        }
      })()
    })
  }, [lockedSetCode, schedule, updateCard])

  // ── Remove a card ─────────────────────────────────────────────────────────
  const removeCard = useCallback((uid: string) => {
    setCards(prev => prev.filter(c => c.uid !== uid))
    // Also remove from the pending queue if it's there
    queueRef.current = queueRef.current.filter(id => id !== uid)
  }, [])

  // ── Retry a failed card ───────────────────────────────────────────────────
  const retryCard = useCallback((uid: string) => {
    updateCard(uid, { status: 'queued', error: undefined })
    schedule(uid)
  }, [updateCard, schedule])

  // ── Clear all ─────────────────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setCards([])
    queueRef.current = []
    setPhase('scan')
    setTotalSpend(0)
    setImportError(null)
  }, [])

  // ── Import ────────────────────────────────────────────────────────────────
  const importAll = useCallback(async (opts: { lot_id?: string; source?: string }) => {
    setIsImporting(true)
    setImportError(null)

    try {
      const computed = computeCosts(cards, totalSpend)

      const payload = computed
        .filter(c => c.status === 'ready' && c.card_name)
        .map(c => ({
          card_name:      c.overrides.card_name   ?? c.card_name,
          set_code:       c.overrides.set_code    ?? c.set_code,
          card_number:    c.overrides.card_number ?? c.card_number,
          condition:      c.overrides.condition   ?? c.condition,
          foil_type:      c.overrides.foil_type   ?? c.foil_type,
          language:       c.language,
          purchase_price: c.proportional_cost ?? 0,
          ebay_avg_sold:  c.ebay_avg_sold,
          source:         opts.source || 'Bulk Wizard',
        }))

      const res = await fetch('/api/bulk-wizard/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          cards:  payload,
          lot_id: opts.lot_id || null,
          source: opts.source || 'Bulk Wizard',
        }),
      })

      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? `Import failed: ${res.status}`)
      }

      const result = await res.json() as { created: number; card_ids: string[] }
      setPhase('import')
      return { created: result.created }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed'
      setImportError(msg)
      throw err
    } finally {
      setIsImporting(false)
    }
  }, [cards, totalSpend])

  // ── Derived values (memoised) ─────────────────────────────────────────────
  const computedCards = useMemo(
    () => computeCosts(cards, totalSpend),
    [cards, totalSpend],
  )

  const readyCount   = useMemo(() => cards.filter(c => c.status === 'ready').length, [cards])
  const pendingCount = useMemo(
    () => cards.filter(c => c.status === 'queued' || c.status === 'identifying' || c.status === 'pricing').length,
    [cards],
  )

  return {
    cards,
    phase,
    totalSpend,
    lockedSetCode,
    retroMode,
    isImporting,
    importError,
    computedCards,
    readyCount,
    pendingCount,
    addImages,
    removeCard,
    updateCard,
    retryCard,
    clearAll,
    setPhase,
    setTotalSpend,
    setLockedSetCode,
    setRetroMode,
    importAll,
  }
}
