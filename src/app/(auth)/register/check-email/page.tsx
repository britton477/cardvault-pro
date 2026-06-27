'use client'
// =============================================================================
// /register/check-email — Post-registration holding page
// Shown after account creation. User must click the confirmation link in their
// email before they can sign in. No session exists at this point.
// =============================================================================
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'

function CheckEmailContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email')

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center space-y-6">

        {/* Icon */}
        <div className="flex items-center justify-center">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <svg
              className="h-8 w-8 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We sent a confirmation link to{' '}
            {email ? (
              <strong className="text-foreground">{email}</strong>
            ) : (
              'your email address'
            )}
            . Click the link to activate your account and sign in.
          </p>
        </div>

        {/* Tips */}
        <div className="rounded-lg border border-border bg-card p-4 text-left space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Didn't receive it?
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Check your spam or junk folder</li>
            <li>The link expires after 24 hours</li>
            <li>Make sure you used the right email address</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Link
            href="/login"
            className="block w-full py-2.5 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors text-center"
          >
            Go to sign in
          </Link>
          <Link
            href="/register"
            className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Use a different email address
          </Link>
        </div>

      </div>
    </div>
  )
}

export default function CheckEmailPage() {
  return (
    <Suspense>
      <CheckEmailContent />
    </Suspense>
  )
}
