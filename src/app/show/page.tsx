'use client'
// =============================================================================
// /show — Mobile Show Mode
//
// A standalone quick-sale screen optimised for card shows.
// No sidebar, no topbar. Designed for one-handed phone use.
//
// Design principles:
//   • All touch targets ≥ 48px (Apple HIG / Material guidelines)
//   • Font-size ≥ 16px on all inputs (prevents iOS auto-zoom)
//   • Bottom-sheet drawer with spring animation for quick sale form
//   • Body scroll locked while drawer open
//   • Session stats (count + revenue) persist for the session
//   • Success toast auto-dismisses after 1.8s
//   • Platform segment control (not a dropdown) for fast tapping
//   • Safe-area padding for notched iPhones
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter }  from 'next/navigation'
import {
  Search, X, ArrowLeft, CheckCircle2, AlertCircle,
  Loader2, ChevronRight, User
} from 'lucide-react'
import { formatGBP }  from '@/lib/utils'
import type { Card }  from '@/types'

// ── Show Mode Onboarding ──────────────────────────────────────────────────────

const ONBOARDING_KEY = 'cvp_show_onboarded_v1'

const STEPS = [
  {
    icon:  '⚡',
    title: 'Welcome to Show Mode',
    body:  'A fast-sell screen built for card shows and markets. No clutter — just search, tap, and record a sale in seconds.',
  },
  {
    icon:  '🔍',
    title: 'Search your stock',
    body:  'Type any card name or set code. Only "In Stock" cards appear — everything you see is available right now.',
  },
  {
    icon:  '👆',
    title: 'Tap a card to sell',
    body:  'Tap any result to open the Quick Sale sheet. Confirm the price, choose Cash / eBay / FB, and record the sale with one tap.',
  },
  {
    icon:  '📊',
    title: 'Session tracking',
    body:  'Sales count and revenue appear in the header as you go. They reset when you leave this page.',
  },
]

function ShowOnboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const total = STEPS.length
  const current = STEPS[step]!

  function next() {
    if (step < total - 1) setStep(s => s + 1)
    else                  onDone()
  }

  return (
    <div
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     200,
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding:    '24px 16px',
        animation:  'fadeIn 250ms ease',
      }}
    >
      {/* Sheet */}
      <div style={{
        width:        '100%',
        maxWidth:     420,
        background:   'hsl(var(--card))',
        borderRadius: '24px',
        border:       '1px solid hsl(var(--border))',
        overflow:     'hidden',
        animation:    'fadeInUp 280ms cubic-bezier(0.32,0.72,0,1)',
      }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingTop: 16, paddingBottom: 4 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width:        i === step ? 20 : 6,
              height:       6,
              borderRadius: 3,
              background:   i === step ? 'hsl(var(--primary))' : 'hsl(var(--border))',
              transition:   'all 250ms',
            }} />
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '20px 28px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>{current.icon}</div>
          <p style={{ fontSize: 20, fontWeight: 800, color: 'hsl(var(--foreground))', letterSpacing: '-0.02em', marginBottom: 10 }}>
            {current.title}
          </p>
          <p style={{ fontSize: 15, color: 'hsl(var(--muted-foreground))', lineHeight: 1.55 }}>
            {current.body}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, padding: '0 20px 20px' }}>
          <button
            onClick={onDone}
            style={{
              flex:         1,
              height:       48,
              borderRadius: 12,
              border:       '1.5px solid hsl(var(--border))',
              background:   'transparent',
              color:        'hsl(var(--muted-foreground))',
              fontSize:     15,
              fontWeight:   600,
              cursor:       'pointer',
              fontFamily:   'inherit',
              touchAction:  'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Skip
          </button>
          <button
            onClick={next}
            style={{
              flex:         2,
              height:       48,
              borderRadius: 12,
              border:       'none',
              background:   'hsl(var(--primary))',
              color:        'hsl(var(--primary-foreground))',
              fontSize:     15,
              fontWeight:   700,
              cursor:       'pointer',
              fontFamily:   'inherit',
              touchAction:  'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {step === total - 1 ? "Let's go →" : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Platform = 'Face to Face' | 'eBay' | 'Facebook'

interface SessionSale {
  card_name: string
  price:     number
}

interface SaleForm {
  price:    string
  platform: Platform
  customer: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORMS: Platform[] = ['Face to Face', 'eBay', 'Facebook']
const PLATFORM_LABELS: Record<Platform, string> = {
  'Face to Face': 'Cash',
  'eBay':         'eBay',
  'Facebook':     'FB',
}
const SEARCH_LIMIT = 8

// ── Utility ───────────────────────────────────────────────────────────────────

function conditionBadgeStyle(condition: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    NM:     { bg: 'rgba(34,197,94,0.15)',  text: '#4ade80' },
    LP:     { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
    MP:     { bg: 'rgba(234,179,8,0.15)',  text: '#facc15' },
    HP:     { bg: 'rgba(239,68,68,0.15)',  text: '#f87171' },
    Sealed: { bg: 'rgba(168,85,247,0.15)', text: '#c084fc' },
  }
  return map[condition] ?? { bg: 'rgba(156,163,175,0.15)', text: '#9ca3af' }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CardRow({
  card,
  onSell,
}: {
  card:   Card
  onSell: (card: Card) => void
}) {
  const price  = card.listed_price ?? card.purchase_price
  const badge  = conditionBadgeStyle(card.condition)
  const meta   = [
    card.set_code,
    card.card_number ? `#${card.card_number}` : '',
    card.foil_type !== 'Normal' ? card.foil_type : '',
    card.language !== 'EN' ? card.language : '',
  ].filter(Boolean).join(' · ')

  return (
    <button
      onClick={() => onSell(card)}
      className="w-full text-left flex items-center gap-3 px-4 active:bg-white/5 transition-colors"
      style={{ minHeight: 64, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
    >
      {/* Condition badge */}
      <span style={{
        display:         'inline-flex',
        alignItems:      'center',
        justifyContent:  'center',
        minWidth:        36,
        height:          36,
        borderRadius:    8,
        fontSize:        11,
        fontWeight:      700,
        letterSpacing:   '0.02em',
        backgroundColor: badge.bg,
        color:           badge.text,
        flexShrink:      0,
      }}>
        {card.condition}
      </span>

      {/* Card info */}
      <div className="flex-1 min-w-0 py-3">
        <p className="text-[15px] font-semibold text-white truncate leading-tight">
          {card.card_name}
        </p>
        {meta && (
          <p className="text-[12px] text-white/40 mt-0.5 truncate">{meta}</p>
        )}
      </div>

      {/* Price + chevron */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[17px] font-bold text-white tabular-nums">
          {formatGBP(price)}
        </span>
        <ChevronRight className="h-4 w-4 text-white/30" />
      </div>
    </button>
  )
}

function Divider() {
  return <div className="h-px mx-4" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ShowPage() {
  const router = useRouter()

  // ── Onboarding ────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem(ONBOARDING_KEY)) {
      setShowOnboarding(true)
    }
  }, [])

  function dismissOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, '1')
    setShowOnboarding(false)
  }

  // ── Search state ──────────────────────────────────────────────────────────
  const [query,       setQuery]       = useState('')
  const [results,     setResults]     = useState<Card[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchErr,   setSearchErr]   = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Drawer state ──────────────────────────────────────────────────────────
  const [drawerCard, setDrawerCard]   = useState<Card | null>(null)
  const [drawerOpen, setDrawerOpen]   = useState(false)
  const [saleForm,   setSaleForm]     = useState<SaleForm>({ price: '', platform: 'Face to Face', customer: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitErr,  setSubmitErr]    = useState<string | null>(null)
  const priceRef = useRef<HTMLInputElement>(null)

  // ── Session tracking ──────────────────────────────────────────────────────
  const [sessionSales, setSessionSales] = useState<SessionSale[]>([])
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null)

  // ── Shop name (for header) ─────────────────────────────────────────────────
  const [shopName, setShopName] = useState('')

  // ── Load shop name on mount ───────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/settings/org')
      .then(r => r.ok ? r.json() : null)
      .then((d: { shop_name?: string } | null) => { if (d?.shop_name) setShopName(d.shop_name) })
      .catch(() => null)
  }, [])

  // ── Auto-focus search on mount ────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  // ── Lock body scroll when drawer open ─────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSearchErr(null)
      return
    }

    const t = setTimeout(async () => {
      setIsSearching(true)
      setSearchErr(null)
      try {
        const qs  = new URLSearchParams({
          search: query,
          status: 'In Stock',
          limit:  String(SEARCH_LIMIT),
        })
        const res = await fetch(`/api/cards?${qs}`)
        if (!res.ok) throw new Error('Search failed')
        const data = await res.json() as { data: Card[] }
        setResults(data.data ?? [])
      } catch {
        setSearchErr('Search failed — check your connection')
      } finally {
        setIsSearching(false)
      }
    }, 280)

    return () => clearTimeout(t)
  }, [query])

  // ── Open drawer for a card ────────────────────────────────────────────────
  const openDrawer = useCallback((card: Card) => {
    setDrawerCard(card)
    setSaleForm({
      price:    String((card.listed_price ?? card.purchase_price).toFixed(2)),
      platform: 'Face to Face',
      customer: '',
    })
    setSubmitErr(null)
    setDrawerOpen(true)
    // Focus price input after animation
    setTimeout(() => priceRef.current?.focus(), 340)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setTimeout(() => { setDrawerCard(null); setSubmitErr(null) }, 320)
  }, [])

  // ── Submit sale ───────────────────────────────────────────────────────────
  const submitSale = useCallback(async () => {
    if (!drawerCard) return
    const price = parseFloat(saleForm.price)
    if (isNaN(price) || price <= 0) {
      setSubmitErr('Enter a valid price')
      return
    }

    setIsSubmitting(true)
    setSubmitErr(null)

    try {
      const today = new Date().toISOString().split('T')[0]!
      const res = await fetch('/api/sales', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          card_id:        drawerCard.id,
          card_name:      drawerCard.card_name,
          set_code:       drawerCard.set_code,
          card_number:    drawerCard.card_number,
          condition:      drawerCard.condition,
          platform:       saleForm.platform,
          qty_sold:       1,
          sold_price:     price,
          fees:           0,
          shipping:       0,
          purchase_price: drawerCard.purchase_price,
          sale_date:      today,
          sale_status:    'Sold',
          buyer_name:     saleForm.customer.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Sale failed')
      }

      // Update session + show toast
      setSessionSales(prev => [...prev, { card_name: drawerCard.card_name, price }])
      setSuccessMsg(`${drawerCard.card_name} — ${formatGBP(price)}`)
      setTimeout(() => setSuccessMsg(null), 1800)

      // Remove sold card from results
      setResults(prev => prev.filter(c => c.id !== drawerCard.id))
      closeDrawer()
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Sale failed — try again')
    } finally {
      setIsSubmitting(false)
    }
  }, [drawerCard, saleForm, closeDrawer])

  // ── Derived session stats ─────────────────────────────────────────────────
  const sessionTotal   = sessionSales.reduce((s, sale) => s + sale.price, 0)
  const sessionCount   = sessionSales.length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Global mobile CSS ─────────────────────────────────────────────── */}
      <style>{`
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        html, body { overscroll-behavior: none; }
        input, textarea, select {
          font-size: 16px !important; /* Prevents iOS auto-zoom */
          -webkit-tap-highlight-color: transparent;
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <div
        className="flex flex-col bg-background"
        style={{ minHeight: '100dvh', minHeight: '100vh', userSelect: 'none' }}
      >

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header style={{
          position:     'sticky',
          top:          0,
          zIndex:       30,
          height:       56,
          display:      'flex',
          alignItems:   'center',
          padding:      '0 16px',
          gap:          12,
          background:   'linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--card)/0.95) 100%)',
          borderBottom: '1px solid hsl(var(--border))',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          {/* Back to app */}
          <button
            onClick={() => router.push('/dashboard')}
            aria-label="Back to app"
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              width:          36,
              height:         36,
              borderRadius:   10,
              color:          'hsl(var(--muted-foreground))',
              flexShrink:     0,
              touchAction:    'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <ArrowLeft size={18} />
          </button>

          {/* Title */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '-0.01em' }}>
                {shopName || 'CardVault Pro'}
              </span>
              <span style={{
                fontSize:        10,
                fontWeight:      700,
                letterSpacing:   '0.06em',
                textTransform:   'uppercase',
                color:           'hsl(var(--primary))',
                background:      'hsl(var(--primary)/0.12)',
                borderRadius:    6,
                padding:         '2px 7px',
              }}>
                Show
              </span>
            </div>

            {/* Session stats */}
            {sessionCount > 0 && (
              <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                {sessionCount} sale{sessionCount !== 1 ? 's' : ''} · {formatGBP(sessionTotal)}
              </p>
            )}
          </div>
        </header>

        {/* ── Search bar ──────────────────────────────────────────────────── */}
        <div style={{ padding: '12px 16px 8px', position: 'sticky', top: 56, zIndex: 20, backgroundColor: 'hsl(var(--background))' }}>
          <div style={{
            display:      'flex',
            alignItems:   'center',
            gap:          12,
            height:       52,
            borderRadius: 14,
            border:       '1.5px solid hsl(var(--border))',
            background:   'hsl(var(--card))',
            padding:      '0 16px',
            transition:   'border-color 150ms',
          }}>
            {isSearching
              ? <Loader2 size={18} style={{ color: 'hsl(var(--primary))', flexShrink: 0 }} className="animate-spin" />
              : <Search   size={18} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
            }
            <input
              ref={searchRef}
              type="search"
              inputMode="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Search by card name, set…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                flex:        1,
                background:  'transparent',
                border:      'none',
                outline:     'none',
                fontSize:    16,
                color:       'hsl(var(--foreground))',
                fontFamily:  'inherit',
              }}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); searchRef.current?.focus() }}
                style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* ── Results / states ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

          {/* Error */}
          {searchErr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px', color: 'hsl(var(--destructive))' }}>
              <AlertCircle size={16} />
              <span style={{ fontSize: 14 }}>{searchErr}</span>
            </div>
          )}

          {/* No results */}
          {!isSearching && query && results.length === 0 && !searchErr && (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'hsl(var(--foreground))' }}>No cards in stock</p>
              <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 6 }}>
                No In Stock cards match &ldquo;{query}&rdquo;
              </p>
            </div>
          )}

          {/* Idle empty state */}
          {!query && sessionCount === 0 && (
            <div style={{ padding: '56px 24px', textAlign: 'center', animation: 'fadeIn 300ms ease' }}>
              <div style={{
                width:          64,
                height:         64,
                borderRadius:   20,
                background:     'hsl(var(--primary)/0.1)',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                margin:         '0 auto 16px',
              }}>
                <Search size={28} style={{ color: 'hsl(var(--primary))' }} />
              </div>
              <p style={{ fontSize: 17, fontWeight: 700, color: 'hsl(var(--foreground))' }}>Search your stock</p>
              <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 8, lineHeight: 1.5 }}>
                Tap a card to record a quick sale.<br />Your session total tracks as you go.
              </p>
            </div>
          )}

          {/* Idle with session history */}
          {!query && sessionCount > 0 && (
            <div style={{ padding: '16px' }}>
              <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))', marginBottom: 12 }}>
                This session
              </p>
              <div style={{ borderRadius: 14, border: '1px solid hsl(var(--border))', overflow: 'hidden', background: 'hsl(var(--card))' }}>
                {sessionSales.slice().reverse().map((sale, i) => (
                  <div key={i} style={{
                    display:       'flex',
                    alignItems:    'center',
                    justifyContent: 'space-between',
                    padding:        '12px 16px',
                    borderBottom:   i < sessionSales.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    animation:      'fadeInUp 250ms ease',
                  }}>
                    <span style={{ fontSize: 14, color: 'hsl(var(--foreground))', flex: 1, minWidth: 0, marginRight: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sale.card_name}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'hsl(var(--foreground))', flexShrink: 0 }}>
                      {formatGBP(sale.price)}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 4px 4px' }}>
                <span style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>{sessionCount} sale{sessionCount !== 1 ? 's' : ''}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: 'hsl(var(--foreground))' }}>{formatGBP(sessionTotal)}</span>
              </div>
            </div>
          )}

          {/* Card results */}
          {results.length > 0 && (
            <div style={{ borderRadius: 14, margin: '4px 16px', border: '1px solid hsl(var(--border))', overflow: 'hidden', background: 'hsl(var(--card))', animation: 'fadeInUp 200ms ease' }}>
              {results.map((card, i) => (
                <div key={card.id}>
                  <CardRow card={card} onSell={openDrawer} />
                  {i < results.length - 1 && <Divider />}
                </div>
              ))}
            </div>
          )}

          {/* Bottom padding for safe area */}
          <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 24px)' }} />
        </div>

        {/* ── Quick Sale Drawer ────────────────────────────────────────────── */}
        {/* Backdrop */}
        {drawerOpen && (
          <div
            onClick={closeDrawer}
            style={{
              position:   'fixed',
              inset:      0,
              zIndex:     40,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              animation:  'fadeIn 200ms ease',
            }}
          />
        )}

        {/* Sheet */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quick sale"
          style={{
            position:     'fixed',
            bottom:       0,
            left:         0,
            right:        0,
            zIndex:       50,
            background:   'hsl(var(--card))',
            borderRadius: '20px 20px 0 0',
            border:       '1px solid hsl(var(--border))',
            borderBottom: 'none',
            transform:    drawerOpen ? 'translateY(0)' : 'translateY(110%)',
            transition:   'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
            willChange:   'transform',
            maxHeight:    '92dvh',
            maxHeight:    '92vh',
            overflowY:    'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Drag handle */}
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'hsl(var(--border))' }} />
          </div>

          {drawerCard && (
            <div style={{ padding: '4px 20px 0' }}>

              {/* Card info header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 20, borderBottom: '1px solid hsl(var(--border))' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 19, fontWeight: 800, color: 'hsl(var(--foreground))', lineHeight: 1.25, letterSpacing: '-0.02em' }}>
                    {drawerCard.card_name}
                  </p>
                  <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                    {[drawerCard.set_code, drawerCard.card_number ? `#${drawerCard.card_number}` : '', drawerCard.condition].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  onClick={closeDrawer}
                  aria-label="Close"
                  style={{
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    width:          36,
                    height:         36,
                    borderRadius:   10,
                    background:     'hsl(var(--secondary))',
                    color:          'hsl(var(--muted-foreground))',
                    flexShrink:     0,
                    marginLeft:     12,
                    touchAction:    'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ paddingTop: 20, paddingBottom: 8, display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Sale Price */}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'hsl(var(--muted-foreground))', letterSpacing: '0.02em', marginBottom: 8 }}>
                    SALE PRICE
                  </label>
                  <div style={{
                    display:      'flex',
                    alignItems:   'center',
                    height:       60,
                    borderRadius: 14,
                    border:       `2px solid ${submitErr && (isNaN(parseFloat(saleForm.price)) || parseFloat(saleForm.price) <= 0) ? 'hsl(var(--destructive))' : 'hsl(var(--primary)'}`,
                    background:   'hsl(var(--background))',
                    padding:      '0 18px',
                    gap:          4,
                  }}>
                    <span style={{ fontSize: 24, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>£</span>
                    <input
                      ref={priceRef}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={saleForm.price}
                      onChange={e => { setSaleForm(f => ({ ...f, price: e.target.value })); setSubmitErr(null) }}
                      style={{
                        flex:        1,
                        background:  'transparent',
                        border:      'none',
                        outline:     'none',
                        fontSize:    28,
                        fontWeight:  800,
                        color:       'hsl(var(--foreground))',
                        fontFamily:  'inherit',
                        letterSpacing: '-0.02em',
                        minWidth:    0,
                      }}
                    />
                  </div>
                </div>

                {/* Platform */}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'hsl(var(--muted-foreground))', letterSpacing: '0.02em', marginBottom: 8 }}>
                    PLATFORM
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {PLATFORMS.map(p => (
                      <button
                        key={p}
                        onClick={() => setSaleForm(f => ({ ...f, platform: p }))}
                        style={{
                          height:          48,
                          borderRadius:    12,
                          border:          `2px solid ${saleForm.platform === p ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                          background:      saleForm.platform === p ? 'hsl(var(--primary)/0.12)' : 'hsl(var(--background))',
                          color:           saleForm.platform === p ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                          fontSize:        14,
                          fontWeight:      saleForm.platform === p ? 700 : 500,
                          transition:      'all 150ms',
                          cursor:          'pointer',
                          touchAction:     'manipulation',
                          WebkitTapHighlightColor: 'transparent',
                          fontFamily:      'inherit',
                        }}
                      >
                        {PLATFORM_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Customer (optional) */}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'hsl(var(--muted-foreground))', letterSpacing: '0.02em', marginBottom: 8 }}>
                    CUSTOMER <span style={{ fontWeight: 400, opacity: 0.6 }}>(OPTIONAL)</span>
                  </label>
                  <div style={{
                    display:      'flex',
                    alignItems:   'center',
                    height:       52,
                    borderRadius: 14,
                    border:       '1.5px solid hsl(var(--border))',
                    background:   'hsl(var(--background))',
                    padding:      '0 16px',
                    gap:          12,
                  }}>
                    <User size={16} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder="Customer name…"
                      value={saleForm.customer}
                      onChange={e => setSaleForm(f => ({ ...f, customer: e.target.value }))}
                      style={{
                        flex:       1,
                        background: 'transparent',
                        border:     'none',
                        outline:    'none',
                        fontSize:   16,
                        color:      'hsl(var(--foreground))',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>
                </div>

                {/* Error */}
                {submitErr && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'hsl(var(--destructive))', fontSize: 13 }}>
                    <AlertCircle size={14} />
                    <span>{submitErr}</span>
                  </div>
                )}

                {/* CTA */}
                <button
                  onClick={() => { void submitSale() }}
                  disabled={isSubmitting}
                  style={{
                    height:          60,
                    borderRadius:    16,
                    background:      isSubmitting ? 'hsl(var(--primary)/0.5)' : 'hsl(var(--primary))',
                    color:           'hsl(var(--primary-foreground))',
                    fontSize:        17,
                    fontWeight:      700,
                    border:          'none',
                    cursor:          isSubmitting ? 'default' : 'pointer',
                    display:         'flex',
                    alignItems:      'center',
                    justifyContent:  'center',
                    gap:             10,
                    transition:      'background 200ms, transform 100ms',
                    fontFamily:      'inherit',
                    touchAction:     'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                    letterSpacing:   '-0.01em',
                    transform:       isSubmitting ? 'scale(0.98)' : 'scale(1)',
                  }}
                >
                  {isSubmitting
                    ? <><Loader2 size={18} className="animate-spin" /> Recording…</>
                    : `Record Sale  ${saleForm.price ? formatGBP(parseFloat(saleForm.price) || 0) : ''}`
                  }
                </button>
              </div>
            </div>
          )}

          {/* Safe area bottom */}
          <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 20px)' }} />
        </div>

        {/* ── Onboarding overlay ──────────────────────────────────────────── */}
        {showOnboarding && <ShowOnboarding onDone={dismissOnboarding} />}

      {/* ── Success toast ────────────────────────────────────────────────── */}
        {successMsg && (
          <div
            aria-live="polite"
            style={{
              position:     'fixed',
              bottom:       'max(env(safe-area-inset-bottom, 24px), 24px)',
              left:         '50%',
              transform:    'translateX(-50%)',
              zIndex:       60,
              display:      'flex',
              alignItems:   'center',
              gap:          10,
              background:   '#16a34a',
              color:        '#fff',
              borderRadius: 40,
              padding:      '12px 20px',
              fontSize:     14,
              fontWeight:   600,
              boxShadow:    '0 8px 24px rgba(0,0,0,0.4)',
              animation:    'fadeInUp 200ms ease',
              whiteSpace:   'nowrap',
              maxWidth:     'calc(100vw - 48px)',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Sale recorded — {successMsg}</span>
          </div>
        )}

      </div>
    </>
  )
}
