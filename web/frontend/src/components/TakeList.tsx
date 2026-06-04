import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { mediaUrl } from '../api/client'
import type { Take } from '../api/generated/model'
import {
  getGetTakeMixStatusQueryKey,
  getListTakesQueryKey,
  useDeleteTake,
  useGetTakeMixStatus,
  useListTakes,
  useMixTake,
  useUpdateTake,
} from '../api/generated/takes/takes'

// The voice nudge is signed: POSITIVE pulls the voice EARLIER (server subtracts
// latency_ms from record_start_song_sec). Honour that semantic in the label.
const NUDGE_MIN = -200
const NUDGE_MAX = 200
const NUDGE_STEP = 5

function human(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dur(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function size(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function badgeClass(status: Take['status']): string {
  if (status === 'done') return 'badge badge-done'
  if (status === 'failed') return 'badge badge-failed'
  if (status === 'mixing' || status === 'queued') return 'badge badge-mixing'
  return 'badge'
}

export function TakeList() {
  const { data: takes, isLoading, error } = useListTakes()

  if (isLoading) return <p className="status">Loading takes…</p>
  if (error) {
    return (
      <p className="status err">
        Couldn&rsquo;t load takes. Start the API with <code>uv run python -m abra_api</code>.
      </p>
    )
  }
  if (!takes || takes.length === 0) {
    return <p className="status takes-empty">No takes yet — go sing. 🎤</p>
  }

  return (
    <div className="takes">
      {takes.map((take) => (
        <TakeRow key={take.id} take={take} />
      ))}
    </div>
  )
}

function TakeRow({ take }: { take: Take }) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: getListTakesQueryKey() })

  // Local label-editing buffer so typing doesn't fight the server round-trip.
  const [labelDraft, setLabelDraft] = useState(take.label ?? '')
  const [nudge, setNudge] = useState(0)
  // Only poll this row's mix status while it is actively re-mixing.
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    setLabelDraft(take.label ?? '')
  }, [take.label])

  const update = useUpdateTake({
    mutation: { onSuccess: () => void invalidate() },
  })
  const remove = useDeleteTake({
    mutation: { onSuccess: () => void invalidate() },
  })
  const mix = useMixTake({
    mutation: {
      onSuccess: () => {
        setPolling(true)
        void invalidate()
      },
    },
  })

  const mixStatus = useGetTakeMixStatus(take.id, {
    query: {
      enabled: polling,
      refetchInterval: (q) => {
        const s = q.state.data?.state
        return s === 'running' || s === 'queued' ? 1500 : false
      },
    },
  })

  // When the poll settles, refresh the list (so status/mix_url update) and stop.
  useEffect(() => {
    if (!polling) return
    const s = mixStatus.data?.state
    if (s === 'done' || s === 'failed') {
      setPolling(false)
      void qc.invalidateQueries({ queryKey: getListTakesQueryKey() })
      void qc.invalidateQueries({ queryKey: getGetTakeMixStatusQueryKey(take.id) })
    }
  }, [polling, mixStatus.data?.state, qc, take.id])

  const remixing = polling || mix.isPending || take.status === 'mixing' || take.status === 'queued'

  const commitLabel = () => {
    const next = labelDraft.trim()
    if (next === (take.label ?? '')) return
    update.mutate({ takeId: take.id, data: { label: next } })
  }

  const toggleStar = () => update.mutate({ takeId: take.id, data: { starred: !take.starred } })

  const onDelete = () => {
    if (!window.confirm('Delete this take? This cannot be undone.')) return
    remove.mutate({ takeId: take.id })
  }

  // Nudge then re-mix: persist the new effective latency, then kick the mix.
  const applyNudge = () => {
    const nextLatency = take.latency_ms + nudge
    update.mutate(
      { takeId: take.id, data: { latency_ms: nextLatency } },
      {
        onSuccess: () => {
          mix.mutate({ takeId: take.id, data: { kind: take.kind } })
        },
      },
    )
  }

  const rawSrc = mediaUrl(`/api/media/take/${take.id}/raw`)
  const mixSrc = take.mix_url ?? mediaUrl(`/api/media/take/${take.id}/mix`)
  // Song-agnostic filename (no hardcoded song title — reusable for the next project).
  const downloadName = `take-${take.id.slice(0, 8)}.${take.kind === 'video' ? 'mp4' : 'm4a'}`

  return (
    <div className={`take-row${take.starred ? ' starred' : ''}`}>
      <div className="take-head">
        <button
          type="button"
          className={`star${take.starred ? ' on' : ''}`}
          onClick={toggleStar}
          disabled={update.isPending}
          aria-label={take.starred ? 'Unstar take' : 'Star take'}
          title={take.starred ? 'Unstar' : 'Star'}
        >
          {take.starred ? '★' : '☆'}
        </button>
        <input
          className="take-label"
          value={labelDraft}
          placeholder="(unlabelled take)"
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <span className={badgeClass(take.status)}>{remixing ? 'mixing' : take.status}</span>
        <button
          type="button"
          className="trash"
          onClick={onDelete}
          disabled={remove.isPending}
          aria-label="Delete take"
          title="Delete"
        >
          🗑
        </button>
      </div>

      <div className="take-meta">
        <span>{human(take.created_at)}</span>
        <span>{take.kind}</span>
        <span>{dur(take.duration)}</span>
        <span>{size(take.size_bytes)}</span>
        <span>latency {take.latency_ms}ms</span>
      </div>

      <div className="take-replay">
        <span className="take-replay-label">Raw vocal</span>
        {/* biome-ignore lint/a11y/useMediaCaption: raw recording, no caption track */}
        <audio controls preload="none" src={rawSrc} />
      </div>

      <div className="take-actions">
        <label className="nudge">
          <span>
            voice nudge {nudge > 0 ? '+' : ''}
            {nudge}ms {nudge === 0 ? '' : nudge > 0 ? '(earlier)' : '(later)'}
          </span>
          <input
            type="range"
            min={NUDGE_MIN}
            max={NUDGE_MAX}
            step={NUDGE_STEP}
            value={nudge}
            onChange={(e) => setNudge(Number(e.target.value))}
            disabled={remixing}
          />
        </label>
        <button
          type="button"
          className="primary"
          onClick={applyNudge}
          disabled={remixing || update.isPending}
          title="Re-mix with the nudged sync — no need to re-sing"
        >
          {remixing ? 'Mixing…' : 'Fix sync & re-mix'}
        </button>
      </div>

      {take.status === 'failed' && !remixing && (
        <p className="take-fail">Last mix failed. Try a nudge and re-mix.</p>
      )}

      {take.status === 'done' && !remixing && (
        <div className="take-mix">
          {take.kind === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: lyrics are burned into the render
            <video className="take-mix-media" controls playsInline src={mixSrc} />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: finished audio mix, no caption track
            <audio className="take-mix-media" controls preload="none" src={mixSrc} />
          )}
          <a className="ghost take-download" download={downloadName} href={mixSrc}>
            ⬇ Download
          </a>
        </div>
      )}
    </div>
  )
}
