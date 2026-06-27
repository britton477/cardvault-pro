'use client'
// =============================================================================
// Input — text input with label, error, prefix/suffix support
// Always use this instead of raw <input> for consistency + accessibility
// =============================================================================
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?:     string
  error?:     string
  hint?:      string
  /** Content rendered inside the left edge (e.g. "£") */
  prefix?:    React.ReactNode
  /** Content rendered inside the right edge (e.g. a clear button) */
  suffix?:    React.ReactNode
  /** Extra class on the outer wrapper div */
  wrapperClassName?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, prefix, suffix, wrapperClassName, id, ...props }, ref) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div className={cn('space-y-1.5', wrapperClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-foreground"
          >
            {label}
            {props.required && (
              <span className="ml-1 text-destructive" aria-hidden>*</span>
            )}
          </label>
        )}

        <div className="relative flex items-center">
          {prefix && (
            <span className="absolute left-3 text-sm text-muted-foreground pointer-events-none select-none">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={!!error}
            aria-describedby={
              error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
            }
            className={cn(
              'w-full rounded-md border bg-input text-sm text-foreground',
              'px-3 py-2',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'transition-colors',
              prefix && 'pl-7',
              suffix && 'pr-9',
              error
                ? 'border-destructive focus:ring-destructive/50'
                : 'border-border',
              className,
            )}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 text-sm text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'

export { Input }
