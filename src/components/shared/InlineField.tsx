// =============================================================================
// CardVault Pro — Inline editable fields (shared primitive)
//
// One editing interaction, used everywhere a value is edited in place: the Bulk
// Wizard scan rows, the stock table, the eBay slide-over. Extracted from
// CardScanRow so "editable here" means "editable everywhere" without copy-paste.
//
// Behaviour is deliberately uniform: click to edit, Enter/blur commits, Escape
// cancels and restores. Money uses InlineNumber with prefix="£".
// =============================================================================
'use client'

import { useState } from 'react'
import { Pencil, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const EDIT_INPUT = cn(
  'w-full rounded border border-primary bg-card px-1.5 py-0.5 text-xs text-foreground',
  'focus:outline-none focus:ring-1 focus:ring-primary',
)
const TRIGGER = 'group flex items-center gap-1 text-left rounded px-1 -mx-1 hover:bg-secondary/60 transition-colors'
const HINT_ICON = 'h-2.5 w-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-colors flex-shrink-0'

export function InlineText({
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
          if (e.key === 'Enter')  { onSave(draft); setEditing(false) }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={cn(EDIT_INPUT, className)}
      />
    )
  }

  return (
    <button onClick={() => { setDraft(value); setEditing(true) }} title="Click to edit" className={cn(TRIGGER, className)}>
      <span className={value ? 'text-foreground' : 'text-muted-foreground/50 italic'}>{value || placeholder}</span>
      <Pencil className={HINT_ICON} />
    </button>
  )
}

export function InlineSelect<T extends string>({
  value, options, onSave, className,
}: { value: T; options: { value: T; label: string }[]; onSave: (v: T) => void; className?: string }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        onChange={e => { onSave(e.target.value as T); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className={cn('rounded border border-primary bg-card px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary', className)}
      >
        {options.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    )
  }

  return (
    <button onClick={() => setEditing(true)} className={cn(TRIGGER, 'gap-0.5', className)}>
      <span className="text-foreground">{options.find(o => o.value === value)?.label ?? value}</span>
      <ChevronDown className={HINT_ICON} />
    </button>
  )
}

/**
 * Inline numeric editor. Commits a parsed number (or null when cleared).
 * `prefix` renders inside the trigger only (e.g. "£") — the input stays a raw
 * number so mobile keypads show the numeric pad.
 */
export function InlineNumber({
  value, onSave, prefix, placeholder, step = 0.01, min = 0, className,
}: {
  value: number | null
  onSave: (v: number | null) => void
  prefix?: string
  placeholder?: string
  step?: number
  min?: number
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value?.toString() ?? '')

  const commit = () => {
    const trimmed = draft.trim()
    onSave(trimmed === '' ? null : Number.parseFloat(trimmed))
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter')  commit()
          if (e.key === 'Escape') { setDraft(value?.toString() ?? ''); setEditing(false) }
        }}
        className={cn(EDIT_INPUT, 'w-20', className)}
      />
    )
  }

  const display = value != null ? `${prefix ?? ''}${value.toFixed(2)}` : null
  return (
    <button onClick={() => { setDraft(value?.toString() ?? ''); setEditing(true) }} title="Click to edit" className={cn(TRIGGER, className)}>
      <span className={display != null ? 'text-foreground tabular-nums' : 'text-muted-foreground/50 italic'}>
        {display ?? (placeholder ?? '—')}
      </span>
      <Pencil className={HINT_ICON} />
    </button>
  )
}
