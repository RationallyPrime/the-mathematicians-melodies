import { useQueryClient } from '@tanstack/react-query'
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
      <div className="studio">
        <p className="status err">
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
  const vuPct = Math.round(Math.min(1, transport.level) * 100)

  const mixing = status?.state === 'running' || status?.state === 'queued'
  const busy = createTake.isPending || mixTake.isPending

  return (
    <div className="studio">
      <div className="studio-head">
        <h1>Recording studio</h1>
        <p className="hint">
          Sing over the backing through <strong>wired headphones</strong>. The audio engine is the
          clock — the video and words below are slaved to it. Calibrate once per device for tight
          sync; nudge by hand to taste.
        </p>
      </div>

      <div className="studio-warn">
        <label className="headphone-ack">
          <input
            type="checkbox"
            checked={headphonesAck}
            onChange={(e) => setHeadphonesAck(e.target.checked)}
          />
          <span>
            I&rsquo;m on <strong>WIRED</strong> headphones (Bluetooth flips to call-quality and
            ruins the take) — proceed at my own risk.
          </span>
        </label>
      </div>

      <div className="studio-stage">
        <video
          ref={videoRef}
          className="video"
          src={mediaUrl(render.url ?? '/api/media/render')}
          muted
          playsInline
        />
        <LyricTeleprompter lyrics={lyrics} t={songTime} />
        {counting && <div className="count-in">{Math.ceil(-transport.position)}</div>}
      </div>

      <div className="vu" aria-label="input level">
        <div className="vu-bar" style={{ width: `${vuPct}%` }} />
      </div>

      <div className="studio-transport">
        <button type="button" className="ghost" onClick={onArm} disabled={!canArm}>
          {st === 'armed' ? 'Armed' : 'Arm'}
        </button>
        <button type="button" className="primary" onClick={onRecord} disabled={!canRecord}>
          Record
        </button>
        <button type="button" className="render" onClick={onStop} disabled={!canStop || busy}>
          Stop
        </button>
        <span className="spacer" />
        <span className={`studio-clock ${counting ? 'counting' : ''}`}>
          {counting ? `count-in ${Math.ceil(-transport.position)}` : `${songTime.toFixed(2)}s`}
        </span>
      </div>

      {armError && <pre className="err-box">{armError}</pre>}

      <div className="studio-controls">
        <div className="calib">
          <button type="button" className="ghost" onClick={onCalibrate} disabled={calibrating}>
            {calibrating ? 'Calibrating…' : 'Calibrate latency'}
          </button>
          <span className="calib-readout">
            {calibMs === null
              ? 'no latency yet'
              : `${calibSource === 'measured' ? 'measured' : 'estimated'} ${calibMs.toFixed(0)}ms`}
          </span>
          {calibError && <span className="calib-err">{calibError}</span>}
        </div>

        <label className="nudge">
          nudge&nbsp;
          <input
            type="range"
            min={-NUDGE_RANGE_MS}
            max={NUDGE_RANGE_MS}
            step={5}
            value={nudgeMs}
            onChange={(e) => setNudgeMs(Number(e.target.value))}
          />
          <span className="nudge-val">
            {nudgeMs > 0 ? '+' : ''}
            {nudgeMs}ms {nudgeMs === 0 ? '' : nudgeMs > 0 ? '(voice earlier)' : '(voice later)'}
          </span>
        </label>

        <div className="kind-toggle">
          deliverable&nbsp;
          <button
            type="button"
            className={kind === 'video' ? 'primary' : 'ghost'}
            onClick={() => setKind('video')}
          >
            video
          </button>
          <button
            type="button"
            className={kind === 'audio' ? 'primary' : 'ghost'}
            onClick={() => setKind('audio')}
          >
            audio
          </button>
        </div>

        <label className="take-label">
          label&nbsp;
          <input
            type="text"
            placeholder="optional"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <span className="effective-latency">
          effective latency {effectiveLatencyMs.toFixed(0)}ms
        </span>
      </div>

      {createTake.error && (
        <pre className="err-box">Take upload failed: {String(createTake.error)}</pre>
      )}
      {mixTake.error && <pre className="err-box">Mix request failed: {String(mixTake.error)}</pre>}

      {activeTakeId !== null && status && status.state !== 'idle' && (
        <div className={`studio-status ${status.state}`}>
          <strong>mix: {status.state}</strong>
          {status.returncode != null && <span> (rc {status.returncode})</span>}
          {status.log_tail && <pre className="log">{status.log_tail}</pre>}
        </div>
      )}

      {mixDone && mixUrl && (
        <div className="studio-result">
          {mixIsVideo ? (
            // biome-ignore lint/a11y/useMediaCaption: this is a karaoke take preview
            <video className="video" src={mixUrl} controls playsInline />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: this is a karaoke take preview
            <audio className="result-audio" src={mixUrl} controls />
          )}
          <a className="primary download" href={mixUrl} download>
            Download take
          </a>
        </div>
      )}

      {mixing && <p className="status">Mixing your take…</p>}
    </div>
  )
}
