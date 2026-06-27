// =============================================================================
// EmptyState — zero-data placeholder with icon, heading, and CTA
// Every table and list view must have an empty state — never a blank screen
// =============================================================================
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

interface EmptyStateProps {
  icon?:        React.ReactNode
  heading:      string
  description?: string
  action?:      {
    label:   string
    onClick: () => void
  }
  className?:   string
}

function EmptyState({ icon, heading, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'py-16 px-6 rounded-lg border border-dashed border-border',
        className,
      )}
      role="status"
      aria-label={heading}
    >
      {icon && (
        <div className="mb-4 text-muted-foreground/40" aria-hidden>
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-foreground mb-1">{heading}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-xs mb-4">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick} size="sm">
          {action.label}
        </Button>
      )}
    </div>
  )
}

export { EmptyState }
