import { useMemo } from 'react'
import type { ClipInfo, Cut } from '../api/generated/model'
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
    <div className="ribbon">
      <div className="ribbon-track">
        {segments.map((s) => {
          const active = t >= s.start && t < s.start + s.length
          return (
            <button
              type="button"
              key={s.index}
              className={`seg${active ? ' active' : ''}`}
              style={{ width: `${(s.length / total) * 100}%`, background: clipHue(s.clip) }}
              title={`#${s.index} · clip ${s.clip} ${titleOf.get(s.clip) ?? ''} · ${s.label}`}
              onClick={() => onSeek(s.start)}
            >
              <span className="seg-label">{s.clip}</span>
            </button>
          )
        })}
        <div className="playhead" style={{ left: `${(t / total) * 100}%` }} />
      </div>
      <div className="ribbon-time">
        <span>{mmss(t)}</span>
        <span>{mmss(total)}</span>
      </div>
    </div>
  )
}
