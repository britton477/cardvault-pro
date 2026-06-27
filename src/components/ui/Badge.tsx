// =============================================================================
// Badge — colour-coded labels for status, condition, platform
// Pure presentational — no client directive needed (no interactivity)
// =============================================================================
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { CardCondition, CardStatus, SalePlatform, SaleStatus } from '@/types'

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
  {
    variants: {
      variant: {
        // Generic
        default:     'bg-secondary text-foreground ring-border',
        primary:     'bg-primary/15 text-primary ring-primary/30',
        success:     'bg-green-500/15 text-green-400 ring-green-500/30',
        warning:     'bg-amber-500/15 text-amber-400 ring-amber-500/30',
        danger:      'bg-red-500/15 text-red-400 ring-red-500/30',
        info:        'bg-blue-500/15 text-blue-400 ring-blue-500/30',
        purple:      'bg-purple-500/15 text-purple-400 ring-purple-500/30',
        // Card conditions
        'cond-NM':     'bg-green-500/15 text-green-400 ring-green-500/30',
        'cond-LP':     'bg-lime-500/15 text-lime-400 ring-lime-500/30',
        'cond-MP':     'bg-amber-500/15 text-amber-400 ring-amber-500/30',
        'cond-HP':     'bg-orange-500/15 text-orange-400 ring-orange-500/30',
        'cond-Sealed': 'bg-blue-500/15 text-blue-400 ring-blue-500/30',
        // Card status
        'status-In Stock': 'bg-blue-500/15 text-blue-400 ring-blue-500/30',
        'status-Listed':   'bg-purple-500/15 text-purple-400 ring-purple-500/30',
        'status-Sold':     'bg-green-500/15 text-green-400 ring-green-500/30',
        // Sale status
        'sale-Sold':      'bg-amber-500/15 text-amber-400 ring-amber-500/30',
        'sale-Shipped':   'bg-blue-500/15 text-blue-400 ring-blue-500/30',
        'sale-Fulfilled': 'bg-green-500/15 text-green-400 ring-green-500/30',
        // Platforms
        'platform-eBay':         'bg-amber-500/15 text-amber-400 ring-amber-500/30',
        'platform-Face to Face': 'bg-teal-500/15 text-teal-400 ring-teal-500/30',
        'platform-Facebook':     'bg-blue-500/15 text-blue-400 ring-blue-500/30',
        'platform-Other':        'bg-secondary text-muted-foreground ring-border',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

// ── Specialised convenience components ───────────────────────────────────────

function ConditionBadge({ condition }: { condition: CardCondition }) {
  const labels: Record<CardCondition, string> = {
    NM:     'NM',
    LP:     'LP',
    MP:     'MP',
    HP:     'HP',
    Sealed: 'Sealed',
  }
  return (
    <Badge variant={`cond-${condition}` as VariantProps<typeof badgeVariants>['variant']}>
      {labels[condition]}
    </Badge>
  )
}

function StatusBadge({ status }: { status: CardStatus }) {
  return (
    <Badge variant={`status-${status}` as VariantProps<typeof badgeVariants>['variant']}>
      {status}
    </Badge>
  )
}

function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return (
    <Badge variant={`sale-${status}` as VariantProps<typeof badgeVariants>['variant']}>
      {status}
    </Badge>
  )
}

function PlatformBadge({ platform }: { platform: SalePlatform }) {
  return (
    <Badge variant={`platform-${platform}` as VariantProps<typeof badgeVariants>['variant']}>
      {platform}
    </Badge>
  )
}

export { Badge, badgeVariants, ConditionBadge, StatusBadge, SaleStatusBadge, PlatformBadge }
