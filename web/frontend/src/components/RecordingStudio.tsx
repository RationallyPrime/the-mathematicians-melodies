import { useQueryClient } from '@tanstack/react-query'
import { Circle, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../api/client'
import type {
  LyricLine,
  RecordingConfig,
  RenderInfo,
  TakeKind,
  TakeMixRequest,
} from '../api/generated/model'
import {
  getGetTakeMixStatusQueryKey,
  getGetTakeQueryKey,
  getListTakesQueryKey,
  useCreateTake,
  useGetTake,
  useGetTakeMixStatus,
  useMixTake,
} from '../api/generated/takes/takes'
import { RecordingEngine, RecordingEngineError } from '../audio/RecordingEngine'
import { calibrate, loadCalibration, saveCalibration } from '../audio/calibrate'
import { LyricTeleprompter } from './LyricTeleprompter'
import { Button, buttonVariants } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Slider } from './ui/Slider'
import { VuMeter } from './ui/VuMeter'

/** Signed manual nudge bound, in ms. POSITIVE = voice pulled EARLIER (the server
 *  computes net_delay = record_start_song_sec - latency_ms/1000, so larger
 *  latency_ms = earlier voice). Mirrors the engine's plausible-latency scale. */
const NUDGE_RANGE_MS = 200

type StudioState = 'idle' | 'armed' | 'recording' | 'stopped'

/** Live transport readout, refreshed by a single rAF loop while armed/recording
 *  so React re-renders track the audio clock without per-frame allocation churn. */
interface Transport {
  /** engine.getPosition(): negative during count-in, >=0 = song seconds. */
  position: number
  /** engine.getLevel(): RMS [0,1] for the VU meter. */
  level: number
  state: StudioState
}

export function RecordingStudio({
  lyrics,
  render,
  config,
}: {
  lyrics: LyricLine[]
  render: RenderInfo
  config: RecordingConfig
}) {
  const qc = useQueryClient()

  // Secure-context guard: getUserMedia + AudioWorklet require https/localhost.
  // Render a graceful message instead of letting arm() throw on construction.
  const secure = typeof window !== 'undefined' && window.isSecureContext

  const engineRef = useRef<RecordingEngine | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number | null>(null)

  const [transport, setTransport] = useState<Transport>({
    position: 0,
    level: 0,
    state: 'idle',
  })
  const [armError, setArmError] = useState<string | null>(null)

  // Headphone acknowledgement: HARD-WARN, SOFT-BLOCK. The user must explicitly
  // confirm they are on WIRED headphones before we will arm/record.
  const [headphonesAck, setHeadphonesAck] = useState(false)

  // Latency: calibrated (measured) ms or the context fallback estimate.
  const [calibMs, setCalibMs] = useState<number | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [calibSource, setCalibSource] = useState<'measured' | 'estimated' | null>(null)
  const [calibError, setCalibError] = useState<string | null>(null)

  // Signed nudge: POSITIVE pulls the voice EARLIER (see NUDGE_RANGE_MS).
  const [nudgeMs, setNudgeMs] = useState(0)

  // Deliverable kind toggle: video (default) renders the lyric video + vocal;
  // audio renders backing + vocal only.
  const [kind, setKind] = useState<TakeKind>('video')

  const [label, setLabel] = useState('')

  // The take currently being created/mixed/previewed.
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null)

  const createTake = useCreateTake()
  const mixTake = useMixTake()

  // Lazily create the engine (constructor opens an AudioContext, which the
  // autoplay policy keeps suspended until arm()'s resume — cheap to hold).
  const getEngine = (): RecordingEngine => {
    if (engineRef.current === null) {
      engineRef.current = new RecordingEngine()
    }
    return engineRef.current
  }

  // Single rAF transport loop — runs only while armed/recording, reading the
  // engine clock (the timing master) and slaving the muted <video> to it.
  useEffect(() => {
    const live = transport.state === 'armed' || transport.state === 'recording'
    if (!live) return

    const tick = () => {
      const engine = engineRef.current
      if (engine === null) return
      const position = engine.getPosition()
      const level = engine.getLevel()
      // VIDEO SLAVED TO AUDIO: the audio engine is the clock master; we only
      // ever push its position into the video, never read the video's time.
      const video = videoRef.current
      if (video) video.currentTime = position > 0 ? position : 0
      setTransport({ position, level, state: engine.getState() })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [transport.state])

  // Fully tear the engine down on unmount (closes the AudioContext).
  useEffect(() => {
    return () => {
      void engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  // Effective latency_ms sent to the server: measured/estimated base + signed
  // nudge. Clamped at 0 (negative net latency makes no physical sense here).
  const effectiveLatencyMs = Math.max(0, (calibMs ?? 0) + nudgeMs)

  // Resolve the backing gain ONCE so the singer's monitor level and the mixed
  // backing level can't disagree (config default may be undefined).
  const backingGain = config.default_backing_gain ?? 0.85

  const onArm = async () => {
    setArmError(null)
    const engine = getEngine()
    try {
      // Hand the engine its endpoint + constraints from the typed hydration
      // payload — no song-specific or environment magic baked into the client.
      await engine.arm({
        backingUrl: config.backing_url,
        audioConstraints: config.getusermedia_constraints as unknown as MediaTrackConstraints,
      })
      // Seed the latency from a saved per-device calibration, else the honest
      // context estimate (output-side only; the nudge covers the rest).
      const deviceId = engine.inputDeviceId
      const saved = deviceId !== null ? loadCalibration(deviceId) : null
      if (saved !== null) {
        setCalibMs(saved)
        setCalibSource('measured')
      } else if (calibMs === null) {
        // Honest fallback: the context's own output-side latency estimate,
        // exposed by the engine's getters (== estimateLatencyMs's formula).
        // Underestimates the true round trip; the nudge slider covers the rest.
        setCalibMs((engine.outputLatency + engine.baseLatency) * 1000)
        setCalibSource('estimated')
      }
      setTransport({ position: 0, level: 0, state: 'armed' })
    } catch (err) {
      if (err instanceof RecordingEngineError) {
        setArmError(err.message)
      } else {
        setArmError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const onRecord = () => {
    const engine = getEngine()
    try {
      engine.start({ countIn: true, backingGain })
      setTransport({ position: engine.getPosition(), level: 0, state: 'recording' })
    } catch (err) {
      setArmError(err instanceof Error ? err.message : String(err))
    }
  }

  const onStop = async () => {
    const engine = engineRef.current
    if (engine === null) return
    try {
      const result = await engine.stop()
      setTransport({ position: 0, level: 0, state: 'stopped' })

      const takeCreate = {
        latency_ms: effectiveLatencyMs,
        record_start_song_sec: result.recordStartSongSec,
        sample_rate: result.sampleRate,
        channels: 1,
        mime: 'audio/wav',
        kind,
        // consent provably tracks the headphone/record acknowledgement.
        consent: headphonesAck,
        label: label.trim() === '' ? undefined : label.trim(),
      }

      createTake.mutate(
        {
          data: {
            // Orval typed `file` as string (binary->string); FormData.append
            // accepts a Blob at runtime, so cast through unknown.
            file: result.wavBlob as unknown as string,
            meta: JSON.stringify(takeCreate),
          },
        },
        {
          onSuccess: (created) => {
            void qc.invalidateQueries({ queryKey: getListTakesQueryKey() })
            setActiveTakeId(created.id)
            // Kick the mix immediately — gains come from config/engine, never
            // hardcoded song constants.
            mixTake.mutate(
              {
                takeId: created.id,
                data: {
                  kind,
                  backing_gain: backingGain,
                  vocal_gain: 1.0,
                  latency_ms: effectiveLatencyMs,
                } as TakeMixRequest,
              },
              {
                onSuccess: () => {
                  void qc.invalidateQueries({
                    queryKey: getGetTakeMixStatusQueryKey(created.id),
                  })
                },
              },
            )
          },
        },
      )
    } catch (err) {
      setArmError(err instanceof Error ? err.message : String(err))
    }
  }

  const onCalibrate = async () => {
    setCalibError(null)
    setCalibrating(true)
    try {
      const engine = getEngine()
      const ms = await calibrate()
      setCalibMs(ms)
      setCalibSource('measured')
      const deviceId = engine.inputDeviceId
      if (deviceId !== null) saveCalibration(deviceId, ms)
    } catch (err) {
      setCalibError(err instanceof Error ? err.message : String(err))
    } finally {
      setCalibrating(false)
    }
  }

  // Poll the mix; stop polling once it settles (done/failed/idle).
  const mixStatus = useGetTakeMixStatus(activeTakeId ?? '', {
    query: {
      refetchInterval: (q) => {
        const s = q.state.data?.state
        return s === 'running' || s === 'queued' ? 1500 : false
      },
    },
  })

  // Once the mix is done, fetch the take to get the computed mix_url.
  const status = mixStatus.data
  const mixDone = status?.state === 'done'
  const activeTake = useGetTake(activeTakeId ?? '', {
    query: { enabled: activeTakeId !== null && mixDone },
  })
  const mixUrl =
    activeTake.data?.mix_url ??
    (activeTakeId !== null && mixDone ? mediaUrl(`/api/media/take/${activeTakeId}/mix`) : null)
  // The finished mix is video/mp4 for kind=video, audio/mp4 for kind=audio.
  const mixIsVideo =
    activeTake.data?.kind === 'video' || (activeTake.data == null && kind === 'video')

  // When the inline mix settles, refresh the take list + this take so the
  // sibling <TakeList> flips it to done (with mix_url) without a page reload.
  useEffect(() => {
    if (activeTakeId === null) return
    if (status?.state === 'done' || status?.state === 'failed') {
      void qc.invalidateQueries({ queryKey: getListTakesQueryKey() })
      void qc.invalidateQueries({ queryKey: getGetTakeQueryKey(activeTakeId) })
    }
  }, [status?.state, activeTakeId, qc])

  if (!secure) {
    return (
      <div className="flex flex-col gap-6">
        <p className="rounded-xl border border-error/50 bg-error/10 p-4 text-center font-mono text-sm text-error">
          Recording needs a secure context. Open this over <code>https</code> or{' '}
          <code>localhost</code> to use the studio.
        </p>
      </div>
    )
  }

  const st = transport.state
  const canArm = headphonesAck && (st === 'idle' || st === 'stopped')
  // Re-record always goes through arm() again: stop() releases the mic, so a
  // 'stopped' engine can't capture. Only an 'armed' engine may Record.
  const canRecord = st === 'armed'
  const canStop = st === 'recording'
  const counting = st === 'recording' && transport.position < 0
  const songTime = transport.position > 0 ? transport.position : 0

  const mixing = status?.state === 'running' || status?.state === 'queued'
  const busy = createTake.isPending || mixTake.isPending

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-4xl leading-tight text-on-surface">Recording studio</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Sing over the backing through{' '}
          <strong className="text-on-surface-dim">wired headphones</strong>. The audio engine is the
          clock — the video and words below are slaved to it. Calibrate once per device for tight
          sync; nudge by hand to taste.
        </p>
      </div>

      <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-line))] bg-[color-mix(in_oklab,var(--color-primary)_12%,var(--color-surface-2))] p-4">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-on-surface-dim">
          <span aria-hidden className="text-lg leading-none">
            🎧
          </span>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-primary)]"
            checked={headphonesAck}
            onChange={(e) => setHeadphonesAck(e.target.checked)}
          />
          <span>
            I&rsquo;m on <strong className="text-on-surface">WIRED</strong> headphones (Bluetooth
            flips to call-quality and ruins the take) — proceed at my own risk.
          </span>
        </label>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-folio">
        <video
          ref={videoRef}
          className="block aspect-video w-full bg-black object-contain"
          src={mediaUrl(render.url ?? '/api/media/render')}
          muted
          playsInline
        />
        <LyricTeleprompter lyrics={lyrics} t={songTime} />
        {counting && (
          <div className="absolute inset-0 grid place-items-center bg-black/45">
            <span className="animate-count-pop font-display text-8xl font-black text-white [text-shadow:0_0_28px_color-mix(in_srgb,var(--color-primary)_75%,transparent)]">
              {Math.ceil(-transport.position)}
            </span>
          </div>
        )}
      </div>

      <VuMeter level={transport.level} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onArm}
          disabled={!canArm}
          className={st === 'armed' ? 'text-success border-success/50 bg-success/10' : undefined}
        >
          {st === 'armed' ? 'Armed' : 'Arm'}
        </Button>
        <IconButton
          type="button"
          variant="record"
          size="xl"
          recording={st === 'recording'}
          className={st === 'armed' ? 'animate-vu-pulse' : undefined}
          onClick={onRecord}
          disabled={!canRecord}
          aria-label="Record"
        >
          {st === 'recording' ? <Mic size={28} /> : <Circle size={28} fill="currentColor" />}
        </IconButton>
        <Button type="button" variant="danger" onClick={onStop} disabled={!canStop || busy}>
          <Square size={16} fill="currentColor" />
          Stop
        </Button>
        <span className="flex-1" />
        <span
          className={`font-mono text-sm tabular-nums ${counting ? 'text-primary' : 'text-on-surface-dim'}`}
        >
          {counting ? `count-in ${Math.ceil(-transport.position)}` : `${songTime.toFixed(2)}s`}
        </span>
      </div>

      {armError && (
        <pre className="whitespace-pre-wrap rounded-lg border border-error/50 bg-error/10 p-3 font-mono text-sm text-error">
          {armError}
        </pre>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-2 p-4 shadow-folio">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCalibrate}
            disabled={calibrating}
          >
            {calibrating ? 'Calibrating…' : 'Calibrate latency'}
          </Button>
          <span className="font-mono text-xs text-muted">
            {calibMs === null
              ? 'no latency yet'
              : `${calibSource === 'measured' ? 'measured' : 'estimated'} ${calibMs.toFixed(0)}ms`}
          </span>
          {calibError && <span className="font-mono text-xs text-error">{calibError}</span>}
        </div>

        <Slider
          label="nudge"
          valueLabel={
            <>
              {nudgeMs > 0 ? '+' : ''}
              {nudgeMs}ms {nudgeMs === 0 ? '' : nudgeMs > 0 ? '(voice earlier)' : '(voice later)'}
            </>
          }
          min={-NUDGE_RANGE_MS}
          max={NUDGE_RANGE_MS}
          step={5}
          value={nudgeMs}
          onChange={(e) => setNudgeMs(Number(e.target.value))}
        />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">deliverable</span>
          <Button
            type="button"
            size="sm"
            variant={kind === 'video' ? 'primary' : 'ghost'}
            onClick={() => setKind('video')}
          >
            video
          </Button>
          <Button
            type="button"
            size="sm"
            variant={kind === 'audio' ? 'primary' : 'ghost'}
            onClick={() => setKind('audio')}
          >
            audio
          </Button>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted">
          label
          <input
            type="text"
            placeholder="optional"
            className="flex-1 rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <span className="font-mono text-xs text-muted">
          effective latency {effectiveLatencyMs.toFixed(0)}ms
        </span>
      </div>

      {createTake.error && (
        <pre className="whitespace-pre-wrap rounded-lg border border-error/50 bg-error/10 p-3 font-mono text-sm text-error">
          Take upload failed: {String(createTake.error)}
        </pre>
      )}
      {mixTake.error && (
        <pre className="whitespace-pre-wrap rounded-lg border border-error/50 bg-error/10 p-3 font-mono text-sm text-error">
          Mix request failed: {String(mixTake.error)}
        </pre>
      )}

      {activeTakeId !== null && status && status.state !== 'idle' && (
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-on-surface-dim">
          <strong className="text-on-surface">mix: {status.state}</strong>
          {status.returncode != null && <span> (rc {status.returncode})</span>}
          {status.log_tail && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-3 p-2 font-mono text-xs text-muted">
              {status.log_tail}
            </pre>
          )}
        </div>
      )}

      {mixDone && mixUrl && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4 shadow-folio">
          {mixIsVideo ? (
            // biome-ignore lint/a11y/useMediaCaption: this is a karaoke take preview
            <video className="w-full rounded-lg bg-black" src={mixUrl} controls playsInline />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: this is a karaoke take preview
            <audio className="w-full" src={mixUrl} controls />
          )}
          <a className={buttonVariants({ variant: 'primary' })} href={mixUrl} download>
            Download take
          </a>
        </div>
      )}

      {mixing && (
        <p className="animate-folio-in p-2 text-center font-display text-lg text-muted">
          Mixing your take…
        </p>
      )}
    </div>
  )
}
