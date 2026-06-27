// =============================================================================
// UI component library — import everything from '@/components/ui'
// =============================================================================
export { Button, buttonVariants }             from './Button'
export type { ButtonProps }                   from './Button'

export { Input }                              from './Input'
export type { InputProps }                    from './Input'

export { Select }                             from './Select'
export type { SelectProps, SelectOption }     from './Select'

export { Textarea }                           from './Textarea'
export type { TextareaProps }                 from './Textarea'

export {
  Badge, badgeVariants,
  ConditionBadge, StatusBadge, SaleStatusBadge, PlatformBadge,
}                                             from './Badge'
export type { BadgeProps }                    from './Badge'

export {
  Skeleton, SkeletonTableRow, SkeletonCard, SkeletonStatCard, SkeletonText,
}                                             from './Skeleton'

export { EmptyState }                         from './EmptyState'

export { Spinner, PageSpinner }               from './Spinner'

export { useToast, Toaster }                  from './Toast'

export { ConfirmDialog }                      from './ConfirmDialog'

export { SlideOver }                          from './SlideOver'

export { ErrorBoundary, withErrorBoundary }   from './ErrorBoundary'
