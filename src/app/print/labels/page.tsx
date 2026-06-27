'use client'
// =============================================================================
// /print/labels?ids=uuid1,uuid2,...
//
// Standalone print page — no sidebar, no topbar.
// Renders a 2-column price-label grid and auto-triggers window.print().
// Label size matches Avery L7165 (99.1 × 67.7 mm), 8 per A4 sheet.
// =============================================================================
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams }                   from 'next/navigation'
import { Printer, AlertCircle }              from 'lucide-react'
import { formatGBP }                         from '@/lib/utils'
import type { Card }                         from '@/types'

// ── Condition colour map (print-friendly, no Tailwind dynamic classes) ────────

const CONDITION_STYLES: Record<string, { bg: string; text: string }> = {
  NM:     { bg: '#dcfce7', text: '#15803d' },
  LP:     { bg: '#dbeafe', text: '#1d4ed8' },
  MP:     { bg: '#fef9c3', text: '#a16207' },
  HP:     { bg: '#fee2e2', text: '#b91c1c' },
  Sealed: { bg: '#f3e8ff', text: '#7e22ce' },
}

// ── Single label ──────────────────────────────────────────────────────────────

function Label({ card, shopName }: { card: Card; shopName: string }) {
  const cond   = CONDITION_STYLES[card.condition] ?? { bg: '#f3f4f6', text: '#374151' }
  const price  = card.listed_price ?? card.purchase_price

  return (
    <div style={{
      width:          '99.1mm',
      height:         '67.7mm',
      border:         '1px solid #d1d5db',
      borderRadius:   '4px',
      padding:        '6mm 7mm',
      boxSizing:      'border-box',
      display:        'flex',
      flexDirection:  'column',
      justifyContent: 'space-between',
      pageBreakInside: 'avoid',
      breakInside:    'avoid',
      backgroundColor: '#ffffff',
      fontFamily:     'system-ui, -apple-system, sans-serif',
    }}>
      {/* Top: card name */}
      <div>
        <div style={{
          fontSize:   '10pt',
          fontWeight: '700',
          color:      '#111827',
          lineHeight: '1.3',
          marginBottom: '2mm',
          // Clamp to 2 lines
          display:    '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow:   'hidden',
        }}>
          {card.card_name}
        </div>

        {/* Set + number */}
        <div style={{ fontSize: '7.5pt', color: '#6b7280', marginBottom: '1.5mm' }}>
          {[card.set_code, card.card_number ? `#${card.card_number}` : ''].filter(Boolean).join(' · ')}
          {card.foil_type && card.foil_type !== 'Normal' && (
            <span style={{ marginLeft: '4px', color: '#7c3aed' }}>{card.foil_type}</span>
          )}
          {card.language && card.language !== 'EN' && (
            <span style={{ marginLeft: '4px' }}>{card.language}</span>
          )}
        </div>
      </div>

      {/* Middle: condition badge */}
      <div>
        <span style={{
          display:       'inline-block',
          padding:       '1mm 3mm',
          borderRadius:  '3px',
          fontSize:      '7pt',
          fontWeight:    '600',
          backgroundColor: cond.bg,
          color:         cond.text,
        }}>
          {card.condition}
          {card.is_graded && card.grade ? ` ${card.grade}` : ''}
        </span>
      </div>

      {/* Bottom: price + shop */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{
          fontSize:   '16pt',
          fontWeight: '800',
          color:      '#111827',
          lineHeight: '1',
        }}>
          {formatGBP(price)}
        </div>
        {shopName && (
          <div style={{ fontSize: '6.5pt', color: '#9ca3af', textAlign: 'right', maxWidth: '35mm' }}>
            {shopName}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PrintLabelsPage() {
  const searchParams = useSearchParams()
  const idsParam     = searchParams.get('ids') ?? ''

  const [cards,    setCards]    = useState<Card[]>([])
  const [shopName, setShopName] = useState('')
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!idsParam) { setError('No card IDs provided.'); setLoading(false); return }

    try {
      const [cardsRes, settingsRes] = await Promise.all([
        fetch(`/api/cards/by-ids?ids=${encodeURIComponent(idsParam)}`),
        fetch('/api/settings/org'),
      ])

      if (!cardsRes.ok) throw new Error('Failed to load cards')
      const cardsJson = await cardsRes.json() as { data: Card[] }
      setCards(cardsJson.data)

      if (settingsRes.ok) {
        const s = await settingsRes.json() as { shop_name?: string }
        setShopName(s.shop_name ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [idsParam])

  useEffect(() => { void load() }, [load])

  // Auto-print once cards are loaded
  useEffect(() => {
    if (!loading && !error && cards.length > 0) {
      // Small delay so the browser has time to render fonts/layout before printing
      const t = setTimeout(() => window.print(), 600)
      return () => clearTimeout(t)
    }
  }, [loading, error, cards.length])

  // ── Screen-only states ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 rounded-full border-2 border-gray-400 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Loading {idsParam.split(',').length} cards…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Screen-only print button bar */}
      <div
        className="print:hidden flex items-center gap-3 px-6 py-3 bg-gray-900 text-white sticky top-0 z-10"
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        <Printer className="h-4 w-4" />
        <span className="text-sm font-medium">
          {cards.length} label{cards.length !== 1 ? 's' : ''} ready
          {shopName && <span className="ml-2 opacity-60">· {shopName}</span>}
        </span>
        <button
          onClick={() => window.print()}
          className="ml-auto rounded-md bg-white text-gray-900 px-4 py-1.5 text-sm font-semibold hover:bg-gray-100 transition-colors"
        >
          Print
        </button>
      </div>

      {/* Label grid — this is what gets printed */}
      <div style={{
        padding:    '10mm',
        background: '#f9fafb',
        minHeight:  '100vh',
      }}>
        <style>{`
          @media print {
            @page {
              size: A4 portrait;
              margin: 8mm;
            }
            body {
              background: white !important;
              margin: 0;
              padding: 0;
            }
            .print\\:hidden { display: none !important; }
            #label-grid {
              padding: 0 !important;
              background: white !important;
            }
          }
        `}</style>

        <div
          id="label-grid"
          style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(2, 99.1mm)',
            gap:                 '3mm',
            justifyContent:      'center',
          }}
        >
          {cards.map(card => (
            <Label key={card.id} card={card} shopName={shopName} />
          ))}
        </div>

        {/* Screen-only hint */}
        <p
          className="print:hidden"
          style={{
            textAlign:  'center',
            marginTop:  '16px',
            fontSize:   '12px',
            color:      '#9ca3af',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          Print dialog should open automatically. If not, click the Print button above.
        </p>
      </div>
    </>
  )
}
