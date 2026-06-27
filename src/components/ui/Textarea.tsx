'use client'
// =============================================================================
// Textarea — multi-line text input with label, error, character count
// =============================================================================
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?:          string
  error?:          string
  hint?:           string
  /** Show remaining character count when maxLength is set */
  showCharCount?:  boolean
  wrapperClassName?: string
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, showCharCount, wrapperClassName, id, value, maxLength, ...props }, ref) => {
    const textareaId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
    const charCount  = typeof value === 'string' ? value.length : 0

    return (
      <div className={cn('space-y-1.5', wrapperClassName)}>
        {label && (
          <div className="flex items-center justify-between">
            <label htmlFor={textareaId} className="block text-sm font-medium text-foreground">
              {label}
              {props.required && <span className="ml-1 text-destructive" aria-hidden>*</span>}
            </label>
            {showCharCount && maxLength && (
              <span className={cn('text-xs', charCount > maxLength * 0.9 ? 'text-amber-400' : 'text-muted-foreground')}>
                {charCount}/{maxLength}
              </span>
            )}
          </div>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          value={value}
          maxLength={maxLength}
          aria-invalid={!!error}
          aria-describedby={error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined}
          className={cn(
            'w-full rounded-md border bg-input text-sm text-foreground',
            'px-3 py-2 min-h-[80px] resize-y',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors',
            error ? 'border-destructive focus:ring-destructive/50' : 'border-border',
            className,
          )}
          {...props}
        />

        {error && (
          <p id={`${textareaId}-error`} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${textareaId}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
