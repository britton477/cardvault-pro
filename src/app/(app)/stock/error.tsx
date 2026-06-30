'use client'
// Temporary diagnostic error boundary for /stock
// Shows the actual error message + stack so we can identify the crash cause.
// Remove once the underlying bug is fixed.

import { useEffect } from 'react'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function StockError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('[StockPage error boundary]', error)
  }, [error])

  return (
    <div className="flex flex-col items-start gap-4 p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-destructive">Stock page crashed</h2>
      <div className="w-full rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm font-mono whitespace-pre-wrap break-all text-destructive">
        <p className="font-bold mb-2">{error.name}: {error.message}</p>
        {error.stack && (
          <p className="text-xs opacity-70">{error.stack}</p>
        )}
        {error.digest && (
          <p className="mt-2 text-xs opacity-50">Digest: {error.digest}</p>
        )}
      </div>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
