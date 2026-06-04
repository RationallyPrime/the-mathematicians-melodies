import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { getGetCutQueryKey, useUpdateCut } from '../api/generated/cut/cut'
import type { EditSlot } from '../api/generated/model'
import { getGetProjectQueryKey, useGetProject } from '../api/generated/project/project'
import { useGetRenderStatus, useStartRender } from '../api/generated/render/render'
import { CutTable, slotError } from '../components/CutTable'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'

export function EditorPage() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useGetProject()

  const [slots, setSlots] = useState<EditSlot[] | null>(null)
  const [crossfade, setCrossfade] = useState(0.4)

  // seed local editing state once the project loads (reseeded after save/reset)
  useEffect(() => {
    if (data && slots === null) {
      setSlots(structuredClone(data.cut.slots))
      setCrossfade(data.cut.crossfade)
    }
  }, [data, slots])

  const update = useUpdateCut({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetProjectQueryKey() })
        void qc.invalidateQueries({ queryKey: getGetCutQueryKey() })
        setSlots(null) // reseed from the server's normalised cut
      },
    },
  })
  const startRender = useStartRender()
  const renderStatus = useGetRenderStatus({
    query: {
      refetchInterval: (q) => {
        const s = q.state.data?.state
        return s === 'running' || s === 'queued' ? 1500 : false
      },
    },
  })

  const clips = data?.clips ?? []
  const total = useMemo(
    () => (slots ? Math.round(slots.reduce((a, s) => a + s.length, 0) * 100) / 100 : 0),
    [slots],
  )
  const invalidCount = useMemo(
    () => (slots ? slots.filter((s) => slotError(clips, s)).length : 0),
    [slots, clips],
  )

  if (isLoading) return <p className="text-muted">Loading the cut…</p>
  if (error || !data || !slots) {
    return (
      <p className="text-error">
        Couldn&rsquo;t reach the API. Start it with <code>uv run python -m abra_api</code>.
      </p>
    )
  }

  const audio = data.cut.audio_duration
  const drift = Math.round((total - audio) * 100) / 100
  const patch = (index: number, p: Partial<EditSlot>) =>
    setSlots((cur) => cur?.map((s, i) => (i === index ? { ...s, ...p } : s)) ?? cur)
  const move = (index: number, dir: -1 | 1) =>
    setSlots((cur) => {
      if (!cur) return cur
      const j = index + dir
      if (j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  const remove = (index: number) => setSlots((cur) => cur?.filter((_, i) => i !== index) ?? cur)
  const addSlot = () =>
    setSlots((cur) => [
      ...(cur ?? []),
      { index: cur?.length ?? 0, clip: 1, ss: 0, length: 4, label: 'new slot' },
    ])
  const reset = () => setSlots(null)
  const save = () =>
    update.mutate({ data: { slots: slots.map((s, i) => ({ ...s, index: i })), crossfade } })

  const status = renderStatus.data
  const rendering = status?.state === 'running' || status?.state === 'queued'

  return (
    <div className="animate-folio-in">
      <div className="mb-5">
        <h1 className="font-display text-2xl">Cut editor</h1>
        <p className="text-sm leading-relaxed text-muted">
          Reorder, retrim, and re-clip the timeline. Saving writes <code>cut.json</code> — the same
          file the render pipeline reads. Lyrics stay synced (they&rsquo;re burned at absolute audio
          times).
        </p>
      </div>

      <CutTable slots={slots} clips={clips} onPatch={patch} onMove={move} onRemove={remove} />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={addSlot}>
          + slot
        </Button>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          crossfade
          <input
            type="number"
            step={0.05}
            min={0}
            max={3}
            className="w-20 rounded border border-line bg-surface-3 px-2 py-1 font-mono tabular-nums text-on-surface focus:border-primary focus:outline-none"
            value={crossfade}
            onChange={(e) => setCrossfade(Number(e.target.value))}
          />
          s
        </label>
        <Badge tone={Math.abs(drift) > 0.5 ? 'mixing' : 'neutral'} className="normal-case">
          total {total}s / audio {audio}s {drift === 0 ? '' : `(${drift > 0 ? '+' : ''}${drift}s)`}
        </Badge>
        {invalidCount > 0 && (
          <Badge tone="failed" className="normal-case">
            {invalidCount} invalid
          </Badge>
        )}
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={update.isPending}>
          Reset
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={save}
          disabled={update.isPending || invalidCount > 0}
        >
          {update.isPending ? 'Saving…' : 'Save cut'}
        </Button>
        <Button
          type="button"
          variant="tonal"
          size="sm"
          onClick={() => startRender.mutate()}
          disabled={rendering || startRender.isPending}
        >
          {rendering ? 'Rendering…' : 'Re-render'}
        </Button>
      </div>

      {update.error && (
        <pre className="mt-4 overflow-x-auto rounded-lg border border-error bg-error/10 p-3 font-mono text-xs text-error">
          Save failed: {String(update.error)}
        </pre>
      )}

      {status && status.state !== 'idle' && (
        <div
          className={`mt-4 rounded-lg border bg-surface-2 p-3 ${
            status.state === 'done'
              ? 'border-success'
              : status.state === 'failed'
                ? 'border-error'
                : 'border-line'
          }`}
        >
          <strong className="text-on-surface">render: {status.state}</strong>
          {status.returncode != null && (
            <span className="text-muted"> (rc {status.returncode})</span>
          )}
          {status.log_tail && (
            <pre className="mt-2 overflow-x-auto rounded border border-line bg-surface-3 p-2 font-mono text-xs text-on-surface-dim">
              {status.log_tail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
