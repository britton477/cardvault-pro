'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const URL_ERRORS: Record<string, string> = {
  auth_callback_failed:  'Sign-in link expired or already used. Please sign in below.',
  confirmation_expired:  'Your confirmation link has expired. Please sign in — if your email isn\'t confirmed yet, request a new link from your email app.',
}

export default function LoginPage() {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const redirect      = searchParams.get('redirect') ?? '/dashboard'
  const urlError      = searchParams.get('error')

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(
    urlError ? (URL_ERRORS[urlError] ?? 'Something went wrong. Please try again.') : null
  )
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      const supabase = createClient()
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })

      if (authErr) {
        setError(authErr.message)
        return
      }

      router.push(redirect)
      router.refresh()
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="text-5xl">🃏</div>
          <h1 className="text-2xl font-bold tracking-tight">CardVault Pro</h1>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-md border bg-input text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring',
                'placeholder:text-muted-foreground',
              )}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-md border bg-input text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring',
              )}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className={cn(
              'w-full py-2 px-4 rounded-md font-semibold text-primary-foreground',
              'bg-primary hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-primary hover:underline font-medium">
            Sign up free
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          CardVault Pro &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
