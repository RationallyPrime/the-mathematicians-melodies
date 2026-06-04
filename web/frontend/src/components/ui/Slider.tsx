import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode
  valueLabel?: React.ReactNode
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, label, valueLabel, ...props }, ref) => (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {(label != null || valueLabel != null) && (
        <span className="flex items-center justify-between">
          <span className="text-muted text-xs">{label}</span>
          <span className="font-mono text-xs text-on-surface-dim tabular-nums">{valueLabel}</span>
        </span>
      )}
      <input
        ref={ref}
        type="range"
        className="w-full cursor-pointer accent-[var(--color-primary)] disabled:opacity-40"
        {...props}
      />
    </label>
  ),
)
Slider.displayName = 'Slider'
