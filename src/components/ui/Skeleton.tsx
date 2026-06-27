// =============================================================================
// Skeleton — shimmer placeholders that match content shape
// Use SkeletonTableRow for table loading states (no layout shift)
// =============================================================================
import { cn } from '@/lib/utils'

// ── Base skeleton block ───────────────────────────────────────────────────────

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-secondary/60',
        className,
      )}
      aria-hidden
      {...props}
    />
  )
}

// ── Table row skeleton — matches the stock/sales table column widths ──────────

function SkeletonTableRow({ columns = 6 }: { columns?: number }) {
  const widths = ['w-32', 'w-16', 'w-12', 'w-20', 'w-20', 'w-16', 'w-24']
  return (
    <tr className="border-b border-border" aria-hidden>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className={cn('h-4', widths[i % widths.length])} />
        </td>
      ))}
    </tr>
  )
}

// ── Card skeleton (for grid views) ───────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3" aria-hidden>
      <Skeleton className="h-40 w-full rounded-md" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-12 rounded-md" />
        <Skeleton className="h-5 w-16 rounded-md" />
      </div>
    </div>
  )
}

// ── Stat card skeleton (dashboard) ───────────────────────────────────────────

function SkeletonStatCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-2" aria-hidden>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

// ── Text line skeletons ───────────────────────────────────────────────────────

function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonTableRow, SkeletonCard, SkeletonStatCard, SkeletonText }
