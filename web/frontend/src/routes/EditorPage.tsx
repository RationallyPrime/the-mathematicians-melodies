import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { getGetCutQueryKey, useUpdateCut } from '../api/generated/cut/cut'
import type { EditSlot } from '../api/generated/model'
import { getGetProjectQueryKey, useGetProject } from '../api/generated/project/project'
import { useGetRenderStatus, useStartRender } from '../api/generated/render/render'
import { CutTable, slotError } from '../components/CutTable'

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

  if (isLoading) return <p className="status">Loading the cut…</p>
  if (error || !data || !slots) {
    return (
      <p className="status err">
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
    <div className="editor">
      <div className="editor-head">
        <h1>Cut editor</h1>
        <p className="hint">
          Reorder, retrim, and re-clip the timeline. Saving writes <code>cut.json</code> — the same
          file the render pipeline reads. Lyrics stay synced (they&rsquo;re burned at absolute audio
          times).
        </p>
      </div>

      <CutTable slots={slots} clips={clips} onPatch={patch} onMove={move} onRemove={remove} />

      <div className="editor-bar">
        <button type="button" className="ghost" onClick={addSlot}>
          + slot
        </button>
        <label className="xfade">
          crossfade&nbsp;
          <input
            type="number"
            step={0.05}
            min={0}
            max={3}
            value={crossfade}
            onChange={(e) => setCrossfade(Number(e.target.value))}
          />
          s
        </label>
        <span className={`total ${Math.abs(drift) > 0.5 ? 'warn' : 'ok'}`}>
          total {total}s / audio {audio}s {drift === 0 ? '' : `(${drift > 0 ? '+' : ''}${drift}s)`}
        </span>
        {invalidCount > 0 && <span className="total warn">{invalidCount} invalid</span>}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={reset} disabled={update.isPending}>
          Reset
        </button>
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={update.isPending || invalidCount > 0}
        >
          {update.isPending ? 'Saving…' : 'Save cut'}
        </button>
        <button
          type="button"
          className="render"
          onClick={() => startRender.mutate()}
          disabled={rendering || startRender.isPending}
        >
          {rendering ? 'Rendering…' : 'Re-render'}
        </button>
      </div>

      {update.error && <pre className="err-box">Save failed: {String(update.error)}</pre>}

      {status && status.state !== 'idle' && (
        <div className={`render-status ${status.state}`}>
          <strong>render: {status.state}</strong>
          {status.returncode != null && <span> (rc {status.returncode})</span>}
          {status.log_tail && <pre className="log">{status.log_tail}</pre>}
        </div>
      )}
    </div>
  )
}
