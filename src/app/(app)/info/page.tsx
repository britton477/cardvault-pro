'use client'
// =============================================================================
// /info — App documentation & workflow guide
// Redesigned: sticky scroll-spy hotbar, compact section index, clean layout
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'workflow',      label: 'Workflow'      },
  { id: 'dashboard',    label: 'Dashboard'     },
  { id: 'stock',        label: 'Stock'         },
  { id: 'sales',        label: 'Sales'         },
  { id: 'sealed',       label: 'Sealed'        },
  { id: 'wishlist',     label: 'Wishlist'      },
  { id: 'ebay',         label: 'eBay Listings' },
  { id: 'reports',      label: 'Reports'       },
  { id: 'calendar',     label: 'Calendar'      },
  { id: 'show',         label: 'Show Mode'     },
  { id: 'lots',         label: 'Purchase Lots' },
  { id: 'buyers',       label: 'Buyers'        },
]

// ── Workflow steps ────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, title: 'Buy',        body: 'Pick up a card or collection. Create a Purchase Lot for bulk buys.' },
  { n: 2, title: 'Add',        body: 'Add each card with its cost. Use Pokémon TCG auto-fill + upload photos.' },
  { n: 3, title: 'Price',      body: 'Refresh eBay price to see sold comps. Set your listed price accordingly.' },
  { n: 4, title: 'List',       body: 'Mark as Listed or push directly to eBay with one click.' },
  { n: 5, title: 'Sell',       body: 'Record the sale from a stock row, the Sales page, or Show Mode at events.' },
  { n: 6, title: 'Ship',       body: 'Advance the status: Sold → Shipped → Fulfilled as you pack and post.' },
  { n: 7, title: 'Review',     body: 'Check Reports monthly — profit, platform split, top cards.' },
]

// ── Sections ──────────────────────────────────────────────────────────────────

interface Section {
  id:          string
  emoji:       string
  title:       string
  subtitle:    string
  description: string
  bullets:     string[]
  tip?:        string
}

const SECTIONS: Section[] = [
  {
    id:          'dashboard',
    emoji:       '📊',
    title:       'Dashboard',
    subtitle:    'Your business at a glance',
    description: 'A live snapshot of your card business — stock value, profit this month, recent activity, and opportunities to act on.',
    bullets: [
      'KPI cards: total stock value, profit this period, cards in stock, sell-through rate, and margin %',
      'Profit trend: 30-day line chart showing daily profit accumulation',
      'Platform split: donut chart breaking down which channel (Cash, eBay, Facebook) earns the most',
      'Price opportunities: cards where the eBay sold average is significantly higher than your listed price',
      'Sitting longest: cards that have been in stock the longest — useful for repricing or selling off at a show',
      'Recent activity feed: latest sales and stock additions at a glance',
    ],
    tip: 'The price opportunity widget is your quickest route to leaving money on the table — check it weekly.',
  },
  {
    id:          'stock',
    emoji:       '📦',
    title:       'Stock',
    subtitle:    'Full inventory management',
    description: 'Every card you own lives here. Add manually or use Pokémon TCG auto-fill, then filter, sort, price, list, and sell.',
    bullets: [
      'Add cards with name, set, condition, purchase cost, listed price, foil type, and photos',
      'Pokémon TCG auto-fill: search by name, select the card, and fields + thumbnail auto-populate',
      'Per-row action buttons: Edit · Mark Listed · List on eBay · Record Sale · Refresh Price · View eBay Sold',
      'Multi-select rows and use the Bulk Action Bar: change status, register multiple sales, bulk list on eBay, print labels',
      'Card # column toggle — show or hide number when space is tight',
      'All photos stored in Supabase Storage — shown as thumbnails in the table and in detail panels',
    ],
    tip: 'Use "Refresh eBay Price" regularly to keep comps fresh — especially before a show.',
  },
  {
    id:          'sales',
    emoji:       '💰',
    title:       'Sales',
    subtitle:    'Record and track every sale',
    description: 'Full profit breakdown per sale — sold price minus platform fees, shipping, and purchase cost. Every record is editable.',
    bullets: [
      'Record a sale manually or directly from a stock row, the Bulk Action Bar, or Show Mode',
      'Fields: card, platform, quantity, sold price, fees, shipping, purchase cost, sale date, status',
      'eBay fees auto-calculate at 13.5% when eBay is the selected platform',
      'One-click status progression: Sold → Shipped → Fulfilled',
      'Click any row to open the full detail panel — edit every field inline, or delete the record',
      'Filter by platform and status; page totals show cumulative revenue and profit',
    ],
    tip: 'The Edit button in the slide-over unlocks every field — useful when fees or shipping come back different from what you estimated.',
  },
  {
    id:          'sealed',
    emoji:       '📬',
    title:       'Sealed Products',
    subtitle:    'Boxes, tins, bundles, and more',
    description: 'Track sealed product inventory separate from singles. Open a box to split it into individual cards, or sell the whole product.',
    bullets: [
      'Add sealed products: booster boxes, ETBs, tins, bundles, blister packs',
      'Track purchase cost, current market value, and profit potential',
      '"Open" a product to record it as opened — then add the individual cards to Stock',
      '"Sell" records the sale directly without opening',
      'Status: In Stock · Opened · Sold',
    ],
    tip: 'When opening a sealed product, link the resulting cards to a Purchase Lot for clean cost-per-card tracking.',
  },
  {
    id:          'wishlist',
    emoji:       '⭐',
    title:       'Wishlist',
    subtitle:    'Cards you want to acquire',
    description: 'Track cards you\'re hunting with a max price target, and get live alerts when eBay comps fall below your budget.',
    bullets: [
      'Add any card with a target max price you\'re willing to pay',
      'eBay price check compares current sold averages against your target',
      'Alert highlights when a card is available below your max price',
      'Mark as "Acquired" when you\'ve bought it — it removes from the active list',
    ],
  },
  {
    id:          'ebay',
    emoji:       '🛒',
    title:       'eBay Listings',
    subtitle:    'Manage your live listings',
    description: 'Connect your eBay account via OAuth to view, revise, or end active listings — and bulk list cards from Stock.',
    bullets: [
      'Connect eBay in Settings → eBay (OAuth flow)',
      'View all active listings with current price and listing status',
      'Revise or end listings without leaving CardVault Pro',
      'Bulk list: select cards in Stock and push them all to eBay in one action',
      'Each listing links back to its stock card for easy tracking',
    ],
  },
  {
    id:          'reports',
    emoji:       '📈',
    title:       'Reports',
    subtitle:    'Profit analytics and export',
    description: 'Summarise your business performance for any time window, broken down by platform and individual card.',
    bullets: [
      'Totals: revenue, profit, fees paid, average margin %',
      'Platform breakdown: which channel earns the most for you',
      'Top cards: your highest individual-card profit',
      'Inventory snapshot: current stock value and card count',
      'Export to CSV: full sales history for your records or tax return',
    ],
  },
  {
    id:          'calendar',
    emoji:       '📅',
    title:       'Calendar',
    subtitle:    'Events and monthly objectives',
    description: 'Plan card shows, buying trips, and shipping days alongside monthly profit and sales targets.',
    bullets: [
      'Monthly grid view — click any date to add an event',
      'Event types: show, convention, buying trip, shipping day, other',
      'Events colour-coded by type for quick scanning',
      'Objectives panel: set monthly targets (profit goal, sales count, cards to acquire) and track progress',
    ],
    tip: 'Add your upcoming shows to the calendar in advance, then switch to Show Mode on the day.',
  },
  {
    id:          'show',
    emoji:       '⚡',
    title:       'Show Mode',
    subtitle:    'Fast selling at card shows',
    description: 'A stripped-down mobile screen for selling at speed. No sidebar, no tabs — just search, tap, and record a sale in under 5 seconds.',
    bullets: [
      'Search your In Stock cards in real time as you type',
      'Tap any result to open the Quick Sale sheet',
      'Confirm the price, pick Cash / eBay / Facebook, tap Record Sale',
      'Session total tracks sales count and revenue in the header as you go',
      'Designed for one hand on a phone — all targets ≥ 48px',
    ],
    tip: 'Stay on the Show Mode page all day — the session total resets if you navigate away.',
  },
  {
    id:          'lots',
    emoji:       '🗂️',
    title:       'Purchase Lots',
    subtitle:    'Bulk buys and collections',
    description: 'Group cards from the same source — a binder, a car boot, a dealer purchase — and track profit per lot as cards sell.',
    bullets: [
      'Create a lot with a total purchase price, source, and date',
      'Assign cards to a lot when adding them to Stock',
      'View all cards in a lot and their combined estimated value',
      'Lot detail shows per-lot profit as individual cards sell',
    ],
    tip: 'Lot assignment is optional, but gives you the clearest picture of which collections were actually profitable.',
  },
  {
    id:          'buyers',
    emoji:       '👤',
    title:       'Buyers',
    subtitle:    'Repeat customer records',
    description: 'A lightweight customer record for anyone who buys from you regularly — handy for show regulars and local deals.',
    bullets: [
      'Record name, email, phone, and notes per buyer',
      'View all sales linked to a buyer automatically',
      'See total spend and transaction count per customer',
    ],
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InfoPage() {
  const [activeId, setActiveId] = useState<string>('workflow')

  // Scroll-spy via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-48px 0px -65% 0px', threshold: 0 },
    )

    NAV_ITEMS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  const scrollTo = useCallback((id: string) => {
    // scrollIntoView works on any scroll container (our <main> is overflow-y-auto)
    // scroll-mt-14 on each section provides hotbar offset
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="max-w-3xl mx-auto pb-16 space-y-0">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4 pt-1 pb-6">
        <div
          className="flex-shrink-0 h-11 w-11 rounded-xl flex items-center justify-center text-xl"
          style={{ background: 'hsl(var(--primary)/0.12)' }}
          aria-hidden
        >
          📖
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground leading-tight">CardVault Pro Guide</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every tab explained — what it does, how it fits the workflow, and how to get the most from it.
          </p>
        </div>
      </div>

      {/* ── Sticky hotbar ────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 -mx-6 px-4 py-2.5 border-b"
        style={{
          background: 'hsl(var(--background)/0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderColor: 'hsl(var(--border))',
        }}
      >
        <div
          className="flex gap-1 overflow-x-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          role="navigation"
          aria-label="Page sections"
        >
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => scrollTo(item.id)}
              aria-current={activeId === item.id ? 'true' : undefined}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150',
                activeId === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Section index ─────────────────────────────────────────────────── */}
      <div className="pt-6 pb-8">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground/50 mb-3 px-0.5">
          Jump to section
        </p>
        {/* gap-px + bg-border creates crisp 1px cell dividers without border hacks */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid hsl(var(--border))' }}
        >
          <div
            className="grid grid-cols-2 sm:grid-cols-3 gap-px"
            style={{ background: 'hsl(var(--border))' }}
          >
            {[
              { id: 'workflow', emoji: '🔄', label: 'The Workflow' },
              ...SECTIONS.map(s => ({ id: s.id, emoji: s.emoji, label: s.title })),
            ].map(item => {
              const isActive = activeId === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className={cn(
                    'flex items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors duration-150',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  style={{
                    background: isActive
                      ? 'hsl(var(--primary)/0.1)'
                      : 'hsl(var(--card))',
                  }}
                >
                  <span className="text-base" aria-hidden>{item.emoji}</span>
                  <span className={cn('font-medium text-xs', isActive && 'text-primary')}>
                    {item.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Workflow ──────────────────────────────────────────────────────── */}
      <section id="workflow" className="scroll-mt-14 pb-10">
        <SectionHeading emoji="🔄" title="The Workflow" subtitle="From purchase to profit" />
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STEPS.map(step => (
            <div
              key={step.n}
              className="flex gap-3.5 rounded-xl p-4"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            >
              <div
                className="flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: 'hsl(var(--primary)/0.12)',
                  color: 'hsl(var(--primary))',
                }}
              >
                {step.n}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-snug">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section details ───────────────────────────────────────────────── */}
      <div className="space-y-8">
        {SECTIONS.map(section => (
          <SectionDetail key={section.id} section={section} />
        ))}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="pt-10 text-center">
        <p className="text-sm text-muted-foreground">
          Something not covered here?{' '}
          <Link href="/contact" className="text-primary hover:underline font-medium">
            Drop us a message →
          </Link>
        </p>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeading({ emoji, title, subtitle }: { emoji: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl" aria-hidden>{emoji}</span>
      <div>
        <h2 className="text-base font-semibold text-foreground leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

function SectionDetail({ section }: { section: Section }) {
  const cols = section.bullets.length >= 4 ? 2 : 1

  return (
    <section
      id={section.id}
      className="scroll-mt-14 rounded-xl overflow-hidden"
      style={{ border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
    >
      {/* Section header */}
      <div
        className="flex items-start gap-3 px-5 pt-5 pb-4"
        style={{ borderBottom: '1px solid hsl(var(--border)/0.6)' }}
      >
        <span className="text-2xl mt-0.5 flex-shrink-0" aria-hidden>{section.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
            <span className="text-xs text-muted-foreground">{section.subtitle}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-prose">
            {section.description}
          </p>
        </div>
      </div>

      {/* Bullets */}
      <div className="px-5 py-4">
        <ul
          className={cn(
            'gap-2',
            cols === 2 ? 'grid grid-cols-1 sm:grid-cols-2' : 'space-y-2',
          )}
        >
          {section.bullets.map((bullet, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
              <span
                className="flex-shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full"
                style={{ background: 'hsl(var(--primary)/0.5)' }}
                aria-hidden
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        {/* Tip */}
        {section.tip && (
          <div
            className="mt-4 flex gap-2.5 rounded-lg px-4 py-3"
            style={{
              background: 'hsl(var(--primary)/0.06)',
              border: '1px solid hsl(var(--primary)/0.18)',
            }}
          >
            <span
              className="flex-shrink-0 text-xs font-semibold uppercase tracking-wider mt-0.5"
              style={{ color: 'hsl(var(--primary))' }}
            >
              Tip
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed">{section.tip}</p>
          </div>
        )}
      </div>
    </section>
  )
}
