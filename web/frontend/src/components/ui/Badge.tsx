import { type VariantProps, cva } from 'class-variance-authority'
import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
  {
    variants: {
      tone: {
        neutral: 'border-line text-muted bg-surface-3',
        done: 'text-success border-success/50 bg-success/10',
        mixing: 'text-primary border-primary/50 bg-primary/10',
        failed: 'text-error border-error/50 bg-error/10',
        uploaded: 'text-tertiary border-tertiary/40 bg-tertiary/10',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, dot, children, ...rest }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...rest}>
      {dot && (
        <span
          className={cn('h-2 w-2 rounded-full bg-current', tone === 'mixing' && 'animate-blink')}
        />
      )}
      {children}
    </span>
  ),
)
Badge.displayName = 'Badge'
