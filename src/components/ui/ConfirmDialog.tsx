'use client'
// =============================================================================
// ConfirmDialog — accessible confirmation for destructive actions
// Traps focus, keyboard-navigable, clearly labels the danger
//
// Usage:
//   <ConfirmDialog
//     open={open}
//     onConfirm={() => deleteCard(id)}
//     onCancel={() => setOpen(false)}
//     title="Delete card?"
//     description="This card will be removed from your stock. This cannot be undone."
//     confirmLabel="Delete"
//   />
// =============================================================================
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open:          boolean
  onConfirm:     () => void
  onCancel:      () => void
  title:         string
  description?:  string
  confirmLabel?: string
  cancelLabel?:  string
  /** Makes the confirm button destructive red (default: true) */
  destructive?:  boolean
  loading?:      boolean
  /**
   * Optional extra content rendered between the description and the buttons —
   * for options that modify what confirming actually does (e.g. a "return card
   * to stock" toggle on a delete).
   */
  children?:     React.ReactNode
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  destructive  = true,
  loading      = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-sm',
            'bg-card border border-border rounded-xl shadow-2xl p-6',
            'animate-in fade-in-0 zoom-in-95',
          )}
          aria-describedby={description ? 'confirm-desc' : undefined}
        >
          <div className="flex items-start gap-4">
            {destructive && (
              <div className="shrink-0 rounded-full bg-destructive/10 p-2" aria-hidden>
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description && (
                <p id="confirm-desc" className="mt-1.5 text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>

          {children && <div className="mt-4">{children}</div>}

          <div className="flex justify-end gap-3 mt-6">
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'primary'}
              onClick={onConfirm}
              loading={loading}
              autoFocus
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
