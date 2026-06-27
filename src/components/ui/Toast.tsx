'use client'
// =============================================================================
// Toast notification system
// Architecture: Zustand store → useToast() hook → <Toaster /> component
//
// Usage anywhere in the app:
//   const { toast } = useToast()
//   toast.success('Card added to stock')
//   toast.error('Failed to save')
//   toast.info('eBay price updated')
// =============================================================================
import * as React from 'react'
import * as RadixToast from '@radix-ui/react-toast'
import { create } from 'zustand'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Toast store (Zustand) ─────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'info'

interface ToastItem {
  id:       string
  title:    string
  description?: string
  variant:  ToastVariant
}

interface ToastStore {
  toasts:  ToastItem[]
  add:     (toast: Omit<ToastItem, 'id'>) => void
  remove:  (id: string) => void
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) =>
    set((s) => ({
      toasts: [
        ...s.toasts.slice(-4),  // cap at 5 visible at once
        { ...toast, id: crypto.randomUUID() },
      ],
    })),
  remove: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// ── Public hook ───────────────────────────────────────────────────────────────

interface ToastHelpers {
  success: (title: string, description?: string) => void
  error:   (title: string, description?: string) => void
  info:    (title: string, description?: string) => void
}

export function useToast(): { toast: ToastHelpers } {
  const add = useToastStore((s) => s.add)

  const toast: ToastHelpers = React.useMemo(() => ({
    success: (title, description) => add({ variant: 'success', title, description }),
    error:   (title, description) => add({ variant: 'error',   title, description }),
    info:    (title, description) => add({ variant: 'info',    title, description }),
  }), [add])

  return { toast }
}

// ── Toaster — render this once in the root layout ─────────────────────────────

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-green-500/30 bg-card',
  error:   'border-destructive/40 bg-card',
  info:    'border-blue-500/30 bg-card',
}

const VARIANT_ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />,
  error:   <AlertCircle  className="h-4 w-4 text-destructive shrink-0 mt-0.5" />,
  info:    <Info         className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />,
}

export function Toaster() {
  const { toasts, remove } = useToastStore()

  return (
    <RadixToast.Provider swipeDirection="right" duration={4000}>
      {toasts.map((t) => (
        <RadixToast.Root
          key={t.id}
          onOpenChange={(open) => { if (!open) remove(t.id) }}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-full',
            'data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
            'transition-all duration-200 ease-out',
            'w-80',
            VARIANT_STYLES[t.variant],
          )}
        >
          {VARIANT_ICONS[t.variant]}
          <div className="flex-1 min-w-0">
            <RadixToast.Title className="text-sm font-semibold text-foreground">
              {t.title}
            </RadixToast.Title>
            {t.description && (
              <RadixToast.Description className="mt-0.5 text-xs text-muted-foreground">
                {t.description}
              </RadixToast.Description>
            )}
          </div>
          <RadixToast.Close
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}

      <RadixToast.Viewport
        className={cn(
          'fixed bottom-4 right-4 z-[100]',
          'flex flex-col gap-2',
          'outline-none',
        )}
      />
    </RadixToast.Provider>
  )
}
