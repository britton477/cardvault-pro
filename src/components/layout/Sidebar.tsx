'use client'

import Link      from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  TrendingUp,
  Box,
  Star,
  Calendar,
  Settings,
  ShoppingBag,
  BarChart3,
  Zap,
  Users,
  Layers,
  BookOpen,
  Mail,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Nav config ─────────────────────────────────────────────────────────────────

type NavItem = {
  href:  string
  label: string
  icon:  React.ElementType
}

type NavSection = {
  label?:  string
  items:   NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
      { href: '/stock',         label: 'Stock',         icon: Package         },
      { href: '/sales',         label: 'Sales',         icon: TrendingUp      },
      { href: '/sealed',        label: 'Sealed',        icon: Box             },
      { href: '/wishlist',      label: 'Wishlist',      icon: Star            },
      { href: '/ebay-listings', label: 'eBay Listings', icon: ShoppingBag     },
      { href: '/bulk-wizard',   label: 'Bulk Wizard',   icon: Wand2           },
      { href: '/reports',       label: 'Reports',       icon: BarChart3       },
      { href: '/calendar',      label: 'Calendar',      icon: Calendar        },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/lots',    label: 'Purchase Lots', icon: Layers },
      { href: '/buyers',  label: 'Buyers',        icon: Users  },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings  },
      { href: '/info',     label: 'Info',     icon: BookOpen  },
      { href: '/contact',  label: 'Contact',  icon: Mail      },
    ],
  },
]

// ── Component ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-card border-r border-border">
      {/* Logo */}
      <div className="h-16 flex items-center gap-2 px-4 border-b border-border">
        <span className="text-2xl" aria-hidden>🃏</span>
        <span className="font-bold text-sm tracking-wide">CardVault Pro</span>
      </div>

      {/* Show Mode CTA */}
      <div className="px-3 pt-3 pb-1">
        <Link
          href="/show"
          className={cn(
            'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm font-semibold transition-all',
            'bg-primary/10 text-primary hover:bg-primary/20',
            'border border-primary/20',
          )}
        >
          <Zap className="h-4 w-4 flex-shrink-0" />
          Show Mode
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-4 px-2">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            {section.label && (
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/60 select-none">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                // Exact match for dashboard, prefix match for everything else
                const active = href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
