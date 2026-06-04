import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export interface VuMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Input level, 0..1 (clamped). */
  level: number
}

export const VuMeter = forwardRef<HTMLDivElement, VuMeterProps>(
  ({ level, className, style, ...rest }, ref) => {
    const clamped = Math.max(0, Math.min(1, level))
    const clipping = clamped > 0.85

    return (
      <div
        ref={ref}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamped}
        aria-label="input level"
        className={cn(
          'relative h-6 overflow-hidden rounded-full bg-surface-3 border border-line',
          clipping &&
            'ring-1 ring-error shadow-[0_0_12px_color-mix(in_srgb,var(--color-error)_55%,transparent)]',
          className,
        )}
        style={style}
        {...rest}
      >
        <div
          className="vu-fill absolute inset-0 origin-left"
          style={{ transform: `scaleX(${clamped})` }}
        />
      </div>
    )
  },
)
VuMeter.displayName = 'VuMeter'
