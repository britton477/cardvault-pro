import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/shared/Providers'

const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
})

export const metadata: Metadata = {
  title:       { default: 'CardVault Pro', template: '%s | CardVault Pro' },
  description: 'Professional TCG card inventory management — built for dealers',
  keywords:    ['pokemon cards', 'tcg', 'card dealer', 'inventory', 'ebay'],
  authors:     [{ name: 'CardVault Pro' }],
  robots:      { index: false, follow: false }, // no public indexing (internal tool)
  manifest:    '/manifest.json',
  icons: {
    icon:    [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple:   '/icons/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
  appleWebApp: {
    capable:           true,
    statusBarStyle:    'black-translucent',
    title:             'CardVault Pro',
    startupImage:      '/icons/splash.png',
  },
  formatDetection: {
    telephone: false,
    date:      false,
    address:   false,
    email:     false,
    url:       false,
  },
}

export const viewport: Viewport = {
  // width=device-width prevents iOS from zooming on 16px-font inputs
  width:             'device-width',
  initialScale:      1,
  maximumScale:      1,          // prevents user-zoom on mobile (intentional — native-app feel)
  userScalable:      false,
  viewportFit:       'cover',    // safe-area-inset-* on notched devices
  themeColor:        [
    { media: '(prefers-color-scheme: dark)',  color: '#09090b' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* PWA: prevents content shift on iOS standalone mode */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Prevent touch callout on long-press (native-app feel) */}
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className={`${inter.variable} font-sans antialiased bg-background text-foreground`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
