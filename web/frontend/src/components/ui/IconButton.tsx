import { type VariantProps, cva } from 'class-variance-authority'
import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

const iconButtonVariants = cva(
  'grid place-items-center rounded-full transition-colors cursor-pointer disabled:opacity-45 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        ghost: 'bg-surface-2 border border-line text-on-surface hover:border-line-strong',
        primary: 'bg-primary text-on-primary hover:bg-primary-bright',
        tonal:
          'bg-[color-mix(in_oklab,var(--color-tertiary)_16%,var(--color-surface-2))] text-tertiary',
        record:
          'text-white bg-[radial-gradient(circle_at_30%_30%,#ff7a86,var(--color-error))] shadow-lift',
      },
      size: {
        md: 'h-11 w-11',
        lg: 'h-14 w-14',
        xl: 'h-20 w-20',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
)

type IconButtonVariant = NonNullable<VariantProps<typeof iconButtonVariants>['variant']>
type IconButtonSize = NonNullable<VariantProps<typeof iconButtonVariants>['size']>

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  size?: IconButtonSize
  recording?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = 'ghost', size = 'md', recording = false, style, ...rest }, ref) => {
    const isRecPulse = variant === 'record' && recording
    const recStyle = isRecPulse
      ? ({
          '--rec-shadow': 'color-mix(in srgb, var(--color-error) 45%, transparent)',
          '--rec-ring': 'color-mix(in srgb, var(--color-error) 26%, transparent)',
          ...style,
        } as React.CSSProperties)
      : style

    return (
      <button
        ref={ref}
        className={cn(
          iconButtonVariants({ variant, size }),
          isRecPulse && 'animate-rec-pulse',
          className,
        )}
        style={recStyle}
        {...rest}
      />
    )
  },
)

IconButton.displayName = 'IconButton'
