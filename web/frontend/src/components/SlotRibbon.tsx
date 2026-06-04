import { useMemo } from 'react'
import type { ClipInfo, Cut } from '../api/generated/model'
import { cn } from '../lib/cn'
import { clipHue, mmss } from '../lib/format'

export function SlotRibbon({
  cut,
  clips,
  t,
  onSeek,
}: {
  cut: Cut
  clips: ClipInfo[]
  t: number
  onSeek: (to: number) => void
}) {
  const total = cut.audio_duration
  const titleOf = useMemo(() => new Map(clips.map((c) => [c.id, c.title])), [clips])

  const segments = useMemo(() => {
    let acc = 0
    return cut.slots.map((s) => {
      const start = acc
      acc += s.length
      return { ...s, start }
    })
  }, [cut.slots])

  return (
    <div className="mt-4">
      <div className="relative flex h-8 overflow-hidden rounded-lg border border-line">
        {segments.map((s) => {
          const active = t >= s.start && t < s.start + s.length
          return (
            <button
              type="button"
              key={s.index}
              className={cn(
                'seg grid place-items-center transition-transform',
                active && 'active z-[1] -translate-y-px',
              )}
              style={{ width: `${(s.length / total) * 100}%`, background: clipHue(s.clip) }}
              title={`#${s.index} · clip ${s.clip} ${titleOf.get(s.clip) ?? ''} · ${s.label}`}
              aria-label={`Seek to slot ${s.index}, clip ${s.clip} ${s.label}`}
              onClick={() => onSeek(s.start)}
            >
              <span className="font-mono text-[0.62rem] font-bold text-black/70">{s.clip}</span>
            </button>
          )
        })}
        <div
          className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_white]"
          style={{ left: `${(t / total) * 100}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs text-muted tabular-nums">
        <span>{mmss(t)}</span>
        <span>{mmss(total)}</span>
      </div>
    </div>
  )
}
