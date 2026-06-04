import { useMemo } from 'react'
import type { ClipInfo, EditSlot } from '../api/generated/model'
import { clipHue } from '../lib/format'

const EPS = 1e-6

export function slotSource(clips: ClipInfo[], clip: number): number {
  return clips.find((c) => c.id === clip)?.source_seconds ?? 10
}

export function slotError(clips: ClipInfo[], s: EditSlot): string | null {
  if (s.ss < 0) return 'ss < 0'
  if (s.length <= 0) return 'length ≤ 0'
  const src = slotSource(clips, s.clip)
  if (s.ss + s.length > src + EPS) return `ss+len > ${src}s source`
  return null
}

export function CutTable({
  slots,
  clips,
  onPatch,
  onMove,
  onRemove,
}: {
  slots: EditSlot[]
  clips: ClipInfo[]
  onPatch: (index: number, patch: Partial<EditSlot>) => void
  onMove: (index: number, dir: -1 | 1) => void
  onRemove: (index: number) => void
}) {
  const sortedClips = useMemo(() => [...clips].sort((a, b) => a.id - b.id), [clips])

  return (
    <table className="cut-table">
      <thead>
        <tr>
          <th>#</th>
          <th>clip</th>
          <th>start (ss)</th>
          <th>length</th>
          <th>src</th>
          <th>label</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {slots.map((s, i) => {
          const err = slotError(clips, s)
          return (
            <tr key={s.index} className={err ? 'row-bad' : undefined}>
              <td className="muted">{i}</td>
              <td>
                <span className="clip-dot" style={{ background: clipHue(s.clip) }} />
                <select
                  value={s.clip}
                  onChange={(e) => onPatch(i, { clip: Number(e.target.value) })}
                >
                  {sortedClips.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} · {c.title}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={s.ss}
                  onChange={(e) => onPatch(i, { ss: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  value={s.length}
                  onChange={(e) => onPatch(i, { length: Number(e.target.value) })}
                />
              </td>
              <td className="muted">{slotSource(clips, s.clip)}</td>
              <td>
                <input
                  type="text"
                  className="label-input"
                  value={s.label ?? ''}
                  onChange={(e) => onPatch(i, { label: e.target.value })}
                />
              </td>
              <td className="row-actions">
                <button type="button" disabled={i === 0} onClick={() => onMove(i, -1)} title="up">
                  ▲
                </button>
                <button
                  type="button"
                  disabled={i === slots.length - 1}
                  onClick={() => onMove(i, 1)}
                  title="down"
                >
                  ▼
                </button>
                <button type="button" className="del" onClick={() => onRemove(i)} title="remove">
                  ✕
                </button>
                {err && <span className="cell-err">{err}</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
