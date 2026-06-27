// =============================================================================
// Spinner — full-page and inline loading indicators
// Prefer Skeleton for content areas; use Spinner for actions / overlays
// =============================================================================
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpinnerProps {
  size?:      'sm' | 'md' | 'lg'
  className?: string
  label?:     string  // screen reader label
}

const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }

function Spinner({ size = 'md', className, label = 'Loading…' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label}>
      <Loader2
        className={cn('animate-spin text-muted-foreground', sizes[size], className)}
        aria-hidden
      />
    </span>
  )
}

// ── Full-page loading overlay ─────────────────────────────────────────────────

function PageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex h-full min-h-64 w-full items-center justify-center"
      role="status"
      aria-label={label}
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}

export { Spinner, PageSpinner }
