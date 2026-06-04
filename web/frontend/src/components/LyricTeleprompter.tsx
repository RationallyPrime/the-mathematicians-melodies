import { type CSSProperties, useMemo } from 'react'
import type { LyricLine } from '../api/generated/model'

const LEAD = 0.4
const TAIL = 0.6
const POP = 0.18

function Line({
  line,
  t,
  position,
}: {
  line: LyricLine
  t: number
  position: 'prev' | 'cur' | 'next'
}) {
  const style = { '--glow': line.theme.glow } as CSSProperties
  return (
    <div className={`tp-line ${position}`} style={style}>
      {line.words.map((w, i) => {
        const sung = position === 'prev' || (position === 'cur' && t >= w.start)
        const pop = position === 'cur' && sung && t < w.start + POP
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: word list is stable per line
            key={i}
            className={`kw${sung ? ' sung' : ''}${pop ? ' pop' : ''}`}
            style={sung ? { color: line.theme.fill } : undefined}
          >
            {w.word}{' '}
          </span>
        )
      })}
    </div>
  )
}

export function LyricTeleprompter({ lyrics, t }: { lyrics: LyricLine[]; t: number }) {
  const idx = useMemo(() => {
    const active = lyrics.findIndex((l) => t >= l.start - LEAD && t <= l.end + TAIL)
    if (active !== -1) return active
    // instrumental gap: preview the next upcoming line
    const upcoming = lyrics.findIndex((l) => l.start > t)
    return upcoming === -1 ? lyrics.length - 1 : upcoming
  }, [lyrics, t])

  const inWindow = idx !== -1 && t >= lyrics[idx].start - LEAD && t <= lyrics[idx].end + TAIL
  const prev = idx > 0 ? lyrics[idx - 1] : null
  const cur = lyrics[idx] ?? null
  const next = idx < lyrics.length - 1 ? lyrics[idx + 1] : null

  return (
    <div className="teleprompter">
      {!inWindow && <div className="tp-rest">♪ &nbsp;instrumental&nbsp; ♪</div>}
      {prev && <Line line={prev} t={t} position="prev" />}
      {cur && <Line line={cur} t={inWindow ? t : -1} position={inWindow ? 'cur' : 'next'} />}
      {next && <Line line={next} t={t} position="next" />}
    </div>
  )
}
