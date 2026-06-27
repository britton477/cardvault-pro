'use client'
// =============================================================================
// ActivityFeed — scrollable list of recent org activity from the audit log.
//
// Maps AuditAction strings → human-readable descriptions using the changes
// payload that writeAuditLog() stores (e.g. changes.after.card_name).
// Falls back gracefully if the entity name isn't available.
//
// Timestamps shown as relative ("2h ago", "3d ago") up to 7 days, then
// as a short date — keeps the feed feeling live without stale timestamps.
// =============================================================================
import {
  Plus, ReceiptText, Pencil, Trash2,
  Package, PackageOpen, Settings, Image as ImageIcon, Key,
} from 'lucide-react'
import { useDashboardCharts } from '@/hooks/useDashboard'
import type { ActivityEntry } from '@/types'

// ── Relative time helper ──────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)       return 'just now'
  if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800)   return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Action → display config ───────────────────────────────────────────────────

interface ActionConfig {
  icon:    React.ElementType
  colour:  string   // Tailwind bg class for the icon badge
  iconCls: string   // Tailwind text class for the icon
  label:   (entry: ActivityEntry) => string
}

function entityName(entry: ActivityEntry, fallback = 'item'): string {
  const c = entry.changes
  if (!c) return fallback
  const after  = c.after  as Record<string, unknown> | null | undefined
  const before = c.before as Record<string, unknown> | null | undefined
  return (
    (after?.card_name    as string | undefined) ??
    (after?.product_name as string | undefined) ??
    (before?.card_name   as string | undefined) ??
    fallback
  )
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  'card.create': {
    icon: Plus, colour: 'bg-primary/15', iconCls: 'text-primary',
    label: e => `Added ${entityName(e, 'card')}`,
  },
  'card.update': {
    icon: Pencil, colour: 'bg-secondary', iconCls: 'text-muted-foreground',
    label: e => `Updated ${entityName(e, 'card')}`,
  },
  'card.delete': {
    icon: Trash2, colour: 'bg-destructive/15', iconCls: 'text-destructive',
    label: e => `Deleted ${entityName(e, 'card')}`,
  },
  'sale.create': {
    icon: ReceiptText, colour: 'bg-green-500/15', iconCls: 'text-green-400',
    label: e => `Sold ${entityName(e, 'card')}`,
  },
  'sale.update': {
    icon: Package, colour: 'bg-blue-500/15', iconCls: 'text-blue-400',
    label: e => {
      const after  = e.changes?.after  as Record<string, unknown> | null | undefined
      const status = after?.sale_status as string | undefined
      // Capitalise first letter for display (e.g. "shipped" → "Shipped")
      if (status) return `Marked as ${status.charAt(0).toUpperCase()}${status.slice(1).toLowerCase()}`
      return 'Updated sale'
    },
  },
  'sale.delete': {
    icon: Trash2, colour: 'bg-destructive/15', iconCls: 'text-destructive',
    label: () => 'Deleted sale record',
  },
  'sealed.create': {
    icon: Package, colour: 'bg-violet-500/15', iconCls: 'text-violet-400',
    label: e => `Added ${entityName(e, 'sealed product')}`,
  },
  'sealed.update': {
    icon: Pencil, colour: 'bg-secondary', iconCls: 'text-muted-foreground',
    label: e => `Updated ${entityName(e, 'sealed product')}`,
  },
  'sealed.delete': {
    icon: Trash2, colour: 'bg-destructive/15', iconCls: 'text-destructive',
    label: () => 'Deleted sealed product',
  },
  'sealed.open': {
    icon: PackageOpen, colour: 'bg-amber-500/15', iconCls: 'text-amber-400',
    label: e => {
      const after = e.changes?.after as Record<string, unknown> | null | undefined
      const qty   = after?.qty as number | undefined
      return qty ? `Opened ${qty} unit${qty !== 1 ? 's' : ''}` : 'Opened sealed product'
    },
  },
  'image.upload': {
    icon: ImageIcon, colour: 'bg-secondary', iconCls: 'text-muted-foreground',
    label: () => 'Uploaded photo',
  },
  'settings.update': {
    icon: Settings, colour: 'bg-secondary', iconCls: 'text-muted-foreground',
    label: () => 'Updated org settings',
  },
  'ebay.credentials.update': {
    icon: Key, colour: 'bg-secondary', iconCls: 'text-muted-foreground',
    label: () => 'Updated eBay credentials',
  },
}

const FALLBACK_CONFIG: ActionConfig = {
  icon: Settings, colour: 'bg-secondary', iconCls: 'text-muted-foreground',
  label: e => e.action.replace('.', ' '),
}

// ── Time-window entry grouping ────────────────────────────────────────────────
// Groups entries with the same action type that occur within 5 minutes of each
// other. This handles bulk operations (e.g. marking 6 sales across Shipped/
// Fulfilled in a single session) that alternate and wouldn't be caught by a
// consecutive-only check.
//
// mixed=true → different resolved labels in the group → use a generic plural label

interface GroupedEntry extends ActivityEntry { count: number; mixed: boolean }

// Generic plural labels for mixed-status groups (e.g. mix of Shipped/Fulfilled)
const MIXED_LABEL: Partial<Record<string, (count: number) => string>> = {
  'sale.update':   n => `Updated ${n} sales`,
  'card.update':   n => `Updated ${n} cards`,
  'sealed.update': n => `Updated ${n} sealed products`,
}

function groupByWindow(entries: ActivityEntry[]): GroupedEntry[] {
  const config  = ACTION_CONFIG
  const result: GroupedEntry[] = []
  const WINDOW  = 5 * 60 * 1000  // 5-minute bucket

  for (const entry of entries) {
    const last       = result[result.length - 1]
    const timeDiff   = last
      ? Math.abs(new Date(entry.created_at).getTime() - new Date(last.created_at).getTime())
      : Infinity
    const sameAction = last?.action === entry.action
    const withinWin  = timeDiff <= WINDOW

    if (sameAction && withinWin) {
      // Check if label changed — flag as mixed if so
      const lastLabel  = config[last.action]?.label(last) ?? last.action
      const thisLabel  = config[entry.action]?.label(entry) ?? entry.action
      if (!last.mixed && lastLabel !== thisLabel) last.mixed = true
      last.count++
    } else {
      result.push({ ...entry, count: 1, mixed: false })
    }
  }
  return result
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-3 w-28 rounded bg-secondary/60" />
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-secondary/60 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 rounded bg-secondary/60" style={{ width: `${50 + (i % 3) * 15}%` }} />
            <div className="h-2.5 w-14 rounded bg-secondary/40" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: GroupedEntry }) {
  const config = ACTION_CONFIG[entry.action] ?? FALLBACK_CONFIG
  const Icon   = config.icon

  // For mixed-status groups, fall back to a generic plural; otherwise use specific label
  const label = entry.count > 1 && entry.mixed
    ? (MIXED_LABEL[entry.action]?.(entry.count) ?? `${entry.count} actions`)
    : config.label(entry)

  return (
    <li className="flex items-start gap-3 py-2">
      {/* Icon badge */}
      <span
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${config.colour}`}
        aria-hidden
      >
        <Icon className={`h-3.5 w-3.5 ${config.iconCls}`} />
      </span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug flex items-center gap-1.5 flex-wrap">
          <span className="truncate">{label}</span>
          {entry.count > 1 && !entry.mixed && (
            <span className="inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
              ×{entry.count}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {entry.user_name ? (
            <><span className="text-foreground/70">{entry.user_name}</span> · </>
          ) : null}
          {relativeTime(entry.created_at)}
        </p>
      </div>
    </li>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ActivityFeed() {
  const { data, isLoading } = useDashboardCharts(30)

  if (isLoading) return <FeedSkeleton />

  const activity = data?.activity ?? []
  const grouped  = groupByWindow(activity)

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col" style={{ maxHeight: 'clamp(320px, 38vw, 480px)' }}>

      {/* Header */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
        Recent activity
      </p>

      {grouped.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No activity yet — start by adding a card.
        </div>
      ) : (
        <ul
          className="flex-1 overflow-y-auto divide-y divide-border/50 -mx-1 px-1"
          aria-label="Recent activity"
        >
          {grouped.map(entry => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  )
}
