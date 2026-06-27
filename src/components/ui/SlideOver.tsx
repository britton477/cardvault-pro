'use client'
// =============================================================================
// SlideOver — right-side panel for detail views (card, sale, sealed)
// Keeps the user in context — no full page navigation needed
//
// Usage:
//   <SlideOver open={open} onClose={onClose} title="Card Detail">
//     <SlideOver.Body>...</SlideOver.Body>
//     <SlideOver.Footer>...</SlideOver.Footer>
//   </SlideOver>
// =============================================================================
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SlideOverProps {
  open:       boolean
  onClose:    () => void
  title:      string
  description?: string
  children:   React.ReactNode
  /** Width of the panel — default 'md' (480px) */
  size?:      'sm' | 'md' | 'lg' | 'xl'
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
}

export function SlideOver({ open, onClose, title, description, children, size = 'md' }: SlideOverProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        {/* Dim overlay */}
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] animate-in fade-in-0"
        />

        {/* Panel */}
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex flex-col',
            'w-full bg-card border-l border-border shadow-2xl',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
            'duration-300 ease-out',
            SIZES[size],
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="text-xs text-muted-foreground mt-0.5">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

SlideOver.Body = function SlideOverBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-6 py-5 space-y-5', className)}>{children}</div>
}

SlideOver.Footer = function SlideOverFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-card">
      {children}
    </div>
  )
}

SlideOver.Section = function SlideOverSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}

SlideOver.Field = function SlideOverField({
  label,
  value,
  className,
}: {
  label:     string
  value:     React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0', className)}>
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right">{value ?? '—'}</span>
    </div>
  )
}
