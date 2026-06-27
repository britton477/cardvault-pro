'use client'
// =============================================================================
// NotificationBell — TopBar bell icon with badge + dropdown.
//
// Design principles:
//   - Zero-dependency on external state; self-contained query via useNotifications
//   - Click-away via overlay (no focus-trap library needed at this scale)
//   - Notifications are navigable links — clicking closes the panel and routes
//   - No read/unread persistence: always reflects live data on mount
// =============================================================================
import { useState, useRef, useCallback } from 'react'
import { useRouter }                     from 'next/navigation'
import { Bell, CheckCircle2, AlertTriangle, Info, TrendingDown } from 'lucide-react'
import { useNotifications }              from '@/hooks/useNotifications'
import { cn }                            from '@/lib/utils'
import type { AppNotification, NotificationType, NotificationSeverity } from '@/types'

// ── Icon + colour config per notification type ────────────────────────────────

const TYPE_CONFIG: Record<NotificationType, {
  Icon:  React.ComponentType<{ className?: string }>
  label: string
}> = {
  price_drop:     { Icon: TrendingDown,  label: 'Price alert'    },
  event_today:    { Icon: AlertTriangle, label: 'Today'          },
  event_tomorrow: { Icon: Info,          label: 'Tomorrow'       },
  stale_listing:  { Icon: AlertTriangle, label: 'Stale listings' },
}

const SEVERITY_CLASSES: Record<NotificationSeverity, string> = {
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  info:    'text-blue-400',
}

// ── Individual notification row ───────────────────────────────────────────────

function NotificationRow({
  notification,
  onClick,
}: {
  notification: AppNotification
  onClick:      (n: AppNotification) => void
}) {
  const { Icon, label } = TYPE_CONFIG[notification.type]
  const iconClass       = SEVERITY_CLASSES[notification.severity]

  return (
    <button
      onClick={() => onClick(notification)}
      className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-secondary transition-colors"
    >
      <Icon className={cn('h-4 w-4 mt-0.5 flex-shrink-0', iconClass)} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{notification.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{notification.body}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5 uppercase tracking-wide">{label}</p>
      </div>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen]   = useState(false)
  const buttonRef         = useRef<HTMLButtonElement>(null)
  const router            = useRouter()
  const { data, isError } = useNotifications()

  const notifications = data?.notifications ?? []
  const count         = notifications.length

  const handleNotificationClick = useCallback((n: AppNotification) => {
    setOpen(false)
    router.push(n.href)
  }, [router])

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        aria-label={count > 0 ? `${count} notification${count !== 1 ? 's' : ''}` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          'relative flex items-center justify-center h-9 w-9 rounded-md',
          'text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors',
          open && 'bg-secondary text-foreground',
        )}
      >
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && !isError && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center px-0.5 leading-none"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Click-away overlay */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />

          <div
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 top-full mt-2 z-40 w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Notifications</h2>
              {count > 0 && (
                <span className="text-xs text-muted-foreground">{count} new</span>
              )}
            </div>

            {/* Body */}
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">All clear — no alerts</p>
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-[420px] overflow-y-auto">
                {notifications.map(n => (
                  <li key={n.id}>
                    <NotificationRow notification={n} onClick={handleNotificationClick} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
