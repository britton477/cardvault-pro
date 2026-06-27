'use client'
// =============================================================================
// ErrorBoundary — catches React rendering errors, shows graceful fallback
// Must be a class component — hooks cannot catch render errors
// Sentry.captureException is called automatically via global-error.tsx
//
// Usage:
//   <ErrorBoundary>
//     <SomeComponent />
//   </ErrorBoundary>
//
//   // Custom fallback:
//   <ErrorBoundary fallback={<p>Something went wrong</p>}>
//     ...
//   </ErrorBoundary>
// =============================================================================
import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  children:  React.ReactNode
  fallback?: React.ReactNode
  /** Called when an error is caught — useful for logging */
  onError?:  (error: Error, info: React.ErrorInfo) => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info)
    // Sentry picks this up automatically via the global error handler
    console.error('[CardVault] Render error:', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div
          className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center rounded-lg border border-border"
          role="alert"
        >
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Something went wrong
            </h3>
            <p className="text-xs text-muted-foreground max-w-xs">
              {this.state.error.message || 'An unexpected error occurred in this section.'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={this.reset}
            iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Try again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

// ── Convenience wrapper for async boundaries ──────────────────────────────────

export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: React.ReactNode,
) {
  const Wrapped = (props: P) => (
    <ErrorBoundary fallback={fallback}>
      <Component {...props} />
    </ErrorBoundary>
  )
  Wrapped.displayName = `withErrorBoundary(${Component.displayName ?? Component.name})`
  return Wrapped
}
