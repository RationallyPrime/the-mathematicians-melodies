import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useMemo } from 'react'
import type { ClipInfo, EditSlot } from '../api/generated/model'
import { clipHue } from '../lib/format'
import { IconButton } from './ui/IconButton'

const EPS = 1e-6

const cellBorder = 'border-b border-[color-mix(in_oklab,var(--color-line)_70%,transparent)]'
const inputBase =
  'bg-surface-3 border border-line rounded px-2 py-1 text-on-surface focus:border-primary focus:outline-none'

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
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['#', 'clip', 'start (ss)', 'length', 'src', 'label', ''].map((h, i) => (
              <th
                key={h || `actions-${i}`}
                className="border-b border-line px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((s, i) => {
            const err = slotError(clips, s)
            return (
              <tr
                key={s.index}
                className={
                  err ? 'bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]' : undefined
                }
              >
                <td
                  className={`${cellBorder} px-3 py-2 align-middle font-mono tabular-nums text-muted`}
                >
                  {i}
                </td>
                <td className={`${cellBorder} px-3 py-2 align-middle`}>
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: clipHue(s.clip) }}
                  />
                  <select
                    className={inputBase}
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
                <td className={`${cellBorder} px-3 py-2 align-middle font-mono tabular-nums`}>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    className={`${inputBase} w-20`}
                    value={s.ss}
                    onChange={(e) => onPatch(i, { ss: Number(e.target.value) })}
                  />
                </td>
                <td className={`${cellBorder} px-3 py-2 align-middle font-mono tabular-nums`}>
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    className={`${inputBase} w-20`}
                    value={s.length}
                    onChange={(e) => onPatch(i, { length: Number(e.target.value) })}
                  />
                </td>
                <td
                  className={`${cellBorder} px-3 py-2 align-middle font-mono tabular-nums text-muted`}
                >
                  {slotSource(clips, s.clip)}
                </td>
                <td className={`${cellBorder} px-3 py-2 align-middle`}>
                  <input
                    type="text"
                    className={`${inputBase} w-full`}
                    value={s.label ?? ''}
                    onChange={(e) => onPatch(i, { label: e.target.value })}
                  />
                </td>
                <td className={`${cellBorder} px-3 py-2 align-middle`}>
                  <div className="flex items-center gap-1">
                    <IconButton
                      type="button"
                      size="md"
                      className="h-8 w-8"
                      disabled={i === 0}
                      onClick={() => onMove(i, -1)}
                      aria-label="up"
                    >
                      <ChevronUp size={16} />
                    </IconButton>
                    <IconButton
                      type="button"
                      size="md"
                      className="h-8 w-8"
                      disabled={i === slots.length - 1}
                      onClick={() => onMove(i, 1)}
                      aria-label="down"
                    >
                      <ChevronDown size={16} />
                    </IconButton>
                    <IconButton
                      type="button"
                      size="md"
                      className="h-8 w-8 border-[color-mix(in_oklab,var(--color-error)_45%,var(--color-line))] bg-[color-mix(in_oklab,var(--color-error)_18%,var(--color-surface-2))] text-error"
                      onClick={() => onRemove(i)}
                      aria-label="remove"
                    >
                      <X size={16} />
                    </IconButton>
                    {err && <span className="ml-1 text-xs text-error">{err}</span>}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
