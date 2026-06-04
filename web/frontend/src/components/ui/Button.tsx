import { type VariantProps, cva } from 'class-variance-authority'
import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-body transition-colors disabled:opacity-45 disabled:pointer-events-none cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary font-medium hover:bg-primary-bright',
        ghost: 'bg-surface-2 text-on-surface border border-line hover:border-line-strong',
        outline: 'border border-line text-on-surface-dim hover:bg-surface-2',
        danger:
          'bg-[color-mix(in_oklab,var(--color-error)_18%,var(--color-surface-2))] text-error border border-[color-mix(in_oklab,var(--color-error)_45%,var(--color-line))]',
        tonal:
          'bg-[color-mix(in_oklab,var(--color-tertiary)_14%,var(--color-surface-2))] text-tertiary',
      },
      size: {
        sm: 'text-sm px-3 py-1.5',
        md: 'text-sm px-4 py-2',
        lg: 'text-base px-5 py-2.5',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...rest }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...rest} />
  ),
)

Button.displayName = 'Button'
