'use client'
// =============================================================================
// Button — single source of truth for all interactive buttons
// Variants: primary | secondary | ghost | destructive | outline
// Sizes: sm | md | lg | icon
// Supports: loading state, left/right icon, Slot polymorphism
// =============================================================================
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Base styles applied to every variant
  [
    'inline-flex items-center justify-center gap-2',
    'rounded-md font-medium text-sm',
    'transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'select-none',
  ],
  {
    variants: {
      variant: {
        primary:     'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        secondary:   'bg-secondary text-foreground hover:bg-secondary/80 active:bg-secondary/70',
        ghost:       'text-muted-foreground hover:bg-secondary hover:text-foreground active:bg-secondary/70',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80',
        outline:     'border border-border bg-transparent text-foreground hover:bg-secondary active:bg-secondary/70',
      },
      size: {
        sm:   'h-8  px-3 text-xs',
        md:   'h-9  px-4',
        lg:   'h-10 px-5 text-base',
        icon: 'h-9  w-9  p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size:    'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Show a spinner and disable interaction */
  loading?:  boolean
  /** Render as child element (Slot pattern — e.g. wrap a <Link>) */
  asChild?:  boolean
  /** Icon shown to the left of the label */
  iconLeft?: React.ReactNode
  /** Icon shown to the right of the label */
  iconRight?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading, asChild, iconLeft, iconRight, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    const isDisabled = disabled || loading

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={isDisabled}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
        ) : (
          iconLeft && <span className="shrink-0" aria-hidden>{iconLeft}</span>
        )}
        {children}
        {!loading && iconRight && (
          <span className="shrink-0" aria-hidden>{iconRight}</span>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
