import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn/ui utility — merge Tailwind classes without conflicts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Currency formatting ───────────────────────────────────────────────────────

export function formatGBP(amount: number, opts?: { showSign?: boolean }): string {
  const formatted = new Intl.NumberFormat('en-GB', {
    style:    'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))

  if (opts?.showSign && amount !== 0) {
    return amount >= 0 ? `+${formatted}` : `-${formatted}`
  }
  return amount < 0 ? `-${formatted}` : formatted
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n)
}

// ── Date formatting ───────────────────────────────────────────────────────────

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  })
}

export function todayIso(): string {
  return new Date().toISOString().split('T')[0]!
}

// ── Median ────────────────────────────────────────────────────────────────────

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : (sorted[mid]!)
}

// ── Slugify ───────────────────────────────────────────────────────────────────

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isNonNull<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined
}
