import { useQueryClient } from '@tanstack/react-query'
import { Download, Trash2 } from 'lucide-react'
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
import type { BadgeProps } from './ui/Badge'
import { Badge } from './ui/Badge'
import { Button, buttonVariants } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { IconButton } from './ui/IconButton'
import { Slider } from './ui/Slider'

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

function badgeTone(status: Take['status']): BadgeProps['tone'] {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'mixing' || status === 'queued') return 'mixing'
  return 'neutral'
}

export function TakeList() {
  const { data: takes, isLoading, error } = useListTakes()

  if (isLoading) return <p className="text-muted text-sm">Loading takes…</p>
  if (error) {
    return (
      <p className="text-error text-sm">
        Couldn&rsquo;t load takes. Start the API with <code>uv run python -m abra_api</code>.
      </p>
    )
  }
  if (!takes || takes.length === 0) {
    return <p className="text-muted text-sm">No takes yet — go sing. 🎤</p>
  }

  return (
    <div className="flex flex-col gap-4">
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

  const status = remixing ? 'mixing' : take.status
  // tone tracks the DISPLAYED status so the colour/animated dot match a live
  // client-side remix (not just the persisted take.status).
  const tone = badgeTone(status)

  return (
    <Card className="animate-folio-in">
      <CardHeader className="gap-2">
        <button
          type="button"
          className={`text-lg leading-none transition-colors${
            take.starred
              ? ' text-primary [text-shadow:0_0_10px_color-mix(in_srgb,var(--color-primary)_60%,transparent)]'
              : ' text-faint hover:text-on-surface'
          }`}
          onClick={toggleStar}
          disabled={update.isPending}
          aria-label={take.starred ? 'Unstar take' : 'Star take'}
          title={take.starred ? 'Unstar' : 'Star'}
        >
          {take.starred ? '★' : '☆'}
        </button>
        <input
          className="min-w-0 flex-1 rounded border border-line bg-surface-3 px-2.5 py-1.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
          value={labelDraft}
          aria-label="Take label"
          placeholder="(unlabelled take)"
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <Badge tone={tone} dot={tone === 'mixing'}>
          {status}
        </Badge>
        <IconButton
          variant="ghost"
          size="md"
          className="h-9 w-9 border-transparent bg-transparent text-error hover:border-line"
          onClick={onDelete}
          disabled={remove.isPending}
          aria-label="Delete take"
          title="Delete"
        >
          <Trash2 size={16} />
        </IconButton>
      </CardHeader>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 font-mono text-xs text-muted tabular-nums">
        <span>{human(take.created_at)}</span>
        <span>{take.kind}</span>
        <span>{dur(take.duration)}</span>
        <span>{size(take.size_bytes)}</span>
        <span>latency {take.latency_ms}ms</span>
      </div>

      <div className="flex flex-col gap-1.5 px-4 pt-3">
        <span className="text-muted text-xs">Raw vocal</span>
        {/* biome-ignore lint/a11y/useMediaCaption: raw recording, no caption track */}
        <audio className="w-full" controls preload="none" src={rawSrc} />
      </div>

      <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
        <Slider
          label="voice nudge"
          valueLabel={`${nudge > 0 ? '+' : ''}${nudge}ms${
            nudge === 0 ? '' : nudge > 0 ? ' (earlier)' : ' (later)'
          }`}
          min={NUDGE_MIN}
          max={NUDGE_MAX}
          step={NUDGE_STEP}
          value={nudge}
          onChange={(e) => setNudge(Number(e.target.value))}
          disabled={remixing}
        />
        <Button
          type="button"
          variant="primary"
          onClick={applyNudge}
          disabled={remixing || update.isPending}
          title="Re-mix with the nudged sync — no need to re-sing"
        >
          {remixing ? 'Mixing…' : 'Fix sync & re-mix'}
        </Button>
      </div>

      {take.status === 'failed' && !remixing && (
        <p className="px-4 pb-4 text-error text-sm">Last mix failed. Try a nudge and re-mix.</p>
      )}

      {take.status === 'done' && !remixing && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {take.kind === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: lyrics are burned into the render
            <video className="w-full rounded-lg bg-black" controls playsInline src={mixSrc} />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: finished audio mix, no caption track
            <audio className="w-full rounded-lg bg-black" controls preload="none" src={mixSrc} />
          )}
          <a
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            download={downloadName}
            href={mixSrc}
          >
            <Download size={16} />
            Download
          </a>
        </div>
      )}
    </Card>
  )
}
