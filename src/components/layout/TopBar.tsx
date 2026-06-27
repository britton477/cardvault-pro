'use client'

import { useRouter, usePathname } from 'next/navigation'
import { LogOut }                  from 'lucide-react'
import { createClient }            from '@/lib/supabase/client'
import { NotificationBell }        from '@/components/layout/NotificationBell'
import { usePageHeader }           from '@/components/layout/PageHeaderContext'
import { cn }                      from '@/lib/utils'

// Static fallback titles keyed by pathname prefix
const PATH_TITLES: Record<string, string> = {
  '/dashboard':     'Dashboard',
  '/stock':         'Stock',
  '/sales':         'Sales',
  '/sealed':        'Sealed Products',
  '/wishlist':      'Wishlist',
  '/buyers':        'Buyers',
  '/lots':          'Purchase Lots',
  '/reports':       'Reports',
  '/calendar':      'Calendar',
  '/settings':      'Settings',
  '/contact':       'Contact',
  '/info':          'Info',
  '/ebay-listings': 'eBay Listings',
}

export function TopBar() {
  const router   = useRouter()
  const pathname = usePathname()
  const { title, subtitle } = usePageHeader()

  // Use context title if set; otherwise fall back to pathname mapping
  const displayTitle = title || PATH_TITLES[pathname] || 'CardVault Pro'

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-16 flex items-center justify-between gap-4 px-6 border-b border-border bg-card shrink-0">

      {/* Left — page title + subtitle */}
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight truncate">{displayTitle}</h1>
        {subtitle && (
          <p className="text-xs text-muted-foreground leading-tight truncate mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Right — notification bell + sign out */}
      <div className="flex items-center gap-3 shrink-0">
        <NotificationBell />

        <div className="w-px h-5 bg-border" aria-hidden />

        <button
          onClick={handleSignOut}
          className={cn(
            'flex items-center gap-2 text-sm text-muted-foreground',
            'hover:text-foreground transition-colors',
          )}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </header>
  )
}
