import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-2xl border border-line bg-surface-2 shadow-folio', className)}
      {...rest}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 px-4 pt-4', className)} {...rest} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('font-display text-lg leading-tight text-on-surface', className)}
      {...rest}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardBody = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('px-4 py-4', className)} {...rest} />
  ),
)
CardBody.displayName = 'CardBody'
