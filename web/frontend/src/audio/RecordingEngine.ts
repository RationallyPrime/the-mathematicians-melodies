// RecordingEngine — the CLOCK MASTER for the karaoke recorder.
//
// One AudioContext owns the whole show. The backing (no_vocals.wav) is decoded
// and played through an AudioBufferSourceNode started at a known future context
// time t0 — that .start(t0) call DEFINES backing-sample-0. A pcm-recorder
// AudioWorklet stamps every 128-frame quantum with its `currentFrame` index on
// the SAME context clock, so the mapping from "mic sample" to "backing sample"
// is deterministic and sample-accurate. We deliberately do NOT anchor to a
// <video> element's currentTime (rAF-polled, frame-quantized, opaque latency).
//
// Framework-free on purpose: a React component drives this, it knows nothing of
// React. Full types, no `any`.

import { encodeWavMono } from './wav'

/** Seconds of pre-roll before t0. Gives the worklet/context time to spin up so
 *  first-quantum jitter is discarded, and gives the singer a count-in. */
export const PREROLL = 3.0

/** Below this the input is almost certainly a Bluetooth HFP (call-quality) path,
 *  which silently downsamples and destroys sync/quality. We refuse to record. */
const HFP_SAMPLE_RATE_FLOOR = 32000

/** URL of the AudioWorklet processor module. Lives in /public, served at root. */
const WORKLET_URL = '/pcm-recorder.worklet.js'
/** The processor name registered inside the worklet module. */
const WORKLET_PROCESSOR = 'pcm-recorder'

/** Endpoint that range-serves the instrumental backing (no_vocals.wav). */
const BACKING_URL = '/api/media/audio'

/** A frame-stamped batch of mono PCM samples — both the message shape posted by
 *  the pcm-recorder worklet AND the unit we accumulate. `frame` is the
 *  context-clock sample index of the FIRST sample in `samples` (the worklet's
 *  `currentFrame` when the quantum was produced). */
interface PcmQuantum {
  readonly frame: number
  readonly samples: Float32Array
}

/** Discriminated error so the UI can react specifically (e.g. show the
 *  headphone/Bluetooth warning) instead of string-matching a message. */
export type RecordingEngineErrorCode =
  | 'bluetooth-hfp'
  | 'not-armed'
  | 'already-recording'
  | 'not-recording'
  | 'no-samples'
  | 'getusermedia-failed'
  | 'worklet-failed'
  | 'decode-failed'

export class RecordingEngineError extends Error {
  constructor(
    readonly code: RecordingEngineErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RecordingEngineError'
  }
}

/** What `stop()` resolves to. The Studio UI depends on this exact shape. */
export interface RecordingResult {
  /** 16-bit PCM mono WAV written at the TRUE context.sampleRate. */
  readonly wavBlob: Blob
  /** The sample rate the WAV was written at (== ctx.sampleRate). */
  readonly sampleRate: number
  /** Song-timeline position (seconds) where capture t0 landed, derived from the
   *  first KEPT sample's frame index at the true sample rate — never from a
   *  <video>. This is the sample-accurate anchor the server mixes against. */
  readonly recordStartSongSec: number
  /** Duration of the captured (kept) audio in seconds. */
  readonly durationSec: number
}

/** Options for a single `start()`. */
export interface StartOptions {
  /** Play 3 short count-in beeps at t0-3/-2/-1. Default true. */
  readonly countIn?: boolean
  /** Linear gain applied to the backing playback (monitoring). Default 0.85. */
  readonly backingGain?: number
}

/** Options for `arm()` — server-provided endpoint/constraints so the client
 *  carries no song-specific or environment magic (RecordingConfig hydration). */
export interface ArmOptions {
  /** Backing-instrumental endpoint (defaults to /api/media/audio). */
  readonly backingUrl?: string
  /** Extra getUserMedia audio constraints from RecordingConfig. The AEC/NS/AGC-off
   *  + mono invariants are always re-forced on top, so a bad config can't break
   *  capture timing. */
  readonly audioConstraints?: MediaTrackConstraints
}

/** Lifecycle state of the engine. */
export type EngineState = 'idle' | 'armed' | 'recording' | 'stopped'

/** Minimal structural type for the worklet node's port message event. We narrow
 *  manually rather than trusting the DOM lib's `any` payload. */
function parsePcmMessage(data: unknown): PcmQuantum | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as { frame?: unknown; samples?: unknown }
  if (typeof d.frame !== 'number') return null
  if (!(d.samples instanceof Float32Array)) return null
  return { frame: d.frame, samples: d.samples }
}

export class RecordingEngine {
  private readonly ctx: AudioContext
  private stream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private analyser: AnalyserNode | null = null
  private backingBuffer: AudioBuffer | null = null
  private backingSource: AudioBufferSourceNode | null = null
  private backingGainNode: GainNode | null = null

  private state: EngineState = 'idle'

  /** Context time (seconds) at which the backing starts == backing-sample-0. */
  private t0: number | null = null
  /** Frame index (on the context clock) of the first sample we KEEP. */
  private firstKeptFrame: number | null = null
  /** Total kept samples so far (for the running position + final length). */
  private keptLength = 0
  /** Accumulated kept quanta, flattened on stop(). */
  private readonly chunks: PcmQuantum[] = []

  /** Scratch buffer for the VU meter so getLevel() allocates nothing per call.
   *  Pinned to an ArrayBuffer backing — the WebAudio/DOM typings require the
   *  non-shared variant for getFloatTimeDomainData. */
  private levelBuf: Float32Array<ArrayBuffer> | null = null

  constructor() {
    // latencyHint:'interactive' minimizes output latency (we measure what's left
    // via calibrate.ts / estimateLatencyMs). Construct lazily-resumable.
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
  }

  /** True context sample rate. Meaningful only after arm(). */
  get sampleRate(): number {
    return this.ctx.sampleRate
  }

  /** AudioContext.baseLatency in seconds (output-side processing latency). */
  get baseLatency(): number {
    return this.ctx.baseLatency
  }

  /** AudioContext.outputLatency in seconds (may be 0 on some browsers). */
  get outputLatency(): number {
    return this.ctx.outputLatency
  }

  /** Backing duration in seconds, available after arm() decodes it. */
  get backingDurationSec(): number {
    return this.backingBuffer?.duration ?? 0
  }

  /** deviceId of the active input track (for per-device calibration keys). */
  get inputDeviceId(): string | null {
    const track = this.stream?.getAudioTracks()[0]
    return track?.getSettings().deviceId ?? null
  }

  getState(): EngineState {
    return this.state
  }

  /**
   * Acquire the mic, load the worklet, decode the backing, and crucially
   * `await ctx.resume()`. Without resume the autoplay policy keeps the context
   * suspended and t0 (== currentTime + PREROLL) is meaningless.
   *
   * Throws RecordingEngineError('bluetooth-hfp', ...) if the input path looks
   * like Bluetooth HFP (call-quality) — the user must switch to WIRED phones.
   */
  async arm(opts: ArmOptions = {}): Promise<void> {
    if (this.state === 'recording') {
      throw new RecordingEngineError('already-recording', 'Cannot re-arm while recording.')
    }

    // 1. Mic, with all DSP OFF (AEC/NS/AGC warp timing and mangle sustained
    //    notes), mono. Headphones are a hard requirement so backing never bleeds.
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // server-provided constraints first; the timing/quality invariants are
          // re-forced on top so config can never flip AEC/NS/AGC back on.
          ...opts.audioConstraints,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      })
    } catch (err) {
      throw new RecordingEngineError(
        'getusermedia-failed',
        `Microphone access failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    this.stream = stream

    // 2. Resume the context — t0 is meaningless on a suspended context.
    await this.ctx.resume()

    // 3. Detect Bluetooth HFP: when a BT headset opens its mic, the OS flips the
    //    whole audio path to call-quality (8–16 kHz). The track's reported rate
    //    (or the context rate) collapses below ~32 kHz. Refuse — it's unfixable
    //    client-side and silently ruins the take.
    const track = stream.getAudioTracks()[0]
    const trackRate = track?.getSettings().sampleRate
    const effectiveRate = typeof trackRate === 'number' ? trackRate : this.ctx.sampleRate
    if (effectiveRate < HFP_SAMPLE_RATE_FLOOR) {
      // Clean up the mic we just opened before bailing.
      for (const t of stream.getTracks()) t.stop()
      this.stream = null
      throw new RecordingEngineError(
        'bluetooth-hfp',
        'Use WIRED headphones — Bluetooth switched to call-quality (HFP) mode.',
      )
    }

    // 4. Load the capture worklet module.
    try {
      await this.ctx.audioWorklet.addModule(WORKLET_URL)
    } catch (err) {
      throw new RecordingEngineError(
        'worklet-failed',
        `Failed to load capture worklet: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // 5. Decode the backing instrumental at the context's native rate.
    try {
      const res = await fetch(opts.backingUrl ?? BACKING_URL)
      if (!res.ok) {
        throw new Error(`backing fetch returned ${res.status}`)
      }
      const arr = await res.arrayBuffer()
      this.backingBuffer = await this.ctx.decodeAudioData(arr)
    } catch (err) {
      throw new RecordingEngineError(
        'decode-failed',
        `Failed to decode backing audio: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // 6. Wire the mic source + VU-meter analyser tap (analyser does NOT touch
    //    the destination — it's a read-only tap, no monitoring feedback).
    this.micSource = this.ctx.createMediaStreamSource(stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.levelBuf = new Float32Array(this.analyser.fftSize)
    this.micSource.connect(this.analyser)

    this.state = 'armed'
  }

  /**
   * Schedule t0 = currentTime + PREROLL, start the backing at t0 (defines
   * backing-sample-0), start the capture worklet (NOT connected to destination),
   * and optionally schedule 3 count-in beeps at t0-3/-2/-1.
   *
   * Only samples whose context time (frame / sampleRate) >= t0 are kept; the
   * pre-roll quanta are discarded as warm-up jitter.
   */
  start(opts: StartOptions = {}): void {
    if (this.state !== 'armed') {
      throw new RecordingEngineError(
        'not-armed',
        `start() requires an armed engine (state=${this.state}). Call arm() first.`,
      )
    }
    if (!this.micSource || !this.analyser || !this.backingBuffer || !this.stream) {
      throw new RecordingEngineError('not-armed', 'Engine not fully armed.')
    }

    // Fresh capture state for this take.
    this.chunks.length = 0
    this.keptLength = 0
    this.firstKeptFrame = null

    const countIn = opts.countIn ?? true
    const backingGain = opts.backingGain ?? 0.85

    const t0 = this.ctx.currentTime + PREROLL
    this.t0 = t0

    // Backing -> gain -> destination, started exactly at t0.
    const backingSource = this.ctx.createBufferSource()
    backingSource.buffer = this.backingBuffer
    const gain = this.ctx.createGain()
    gain.gain.value = backingGain
    backingSource.connect(gain)
    gain.connect(this.ctx.destination)
    backingSource.start(t0)
    this.backingSource = backingSource
    this.backingGainNode = gain

    // Count-in beeps (capture-only window starts at t0, so these are NOT kept).
    if (countIn) {
      for (let i = 3; i >= 1; i--) {
        const when = t0 - i
        if (when <= this.ctx.currentTime) continue
        const osc = this.ctx.createOscillator()
        const beepGain = this.ctx.createGain()
        osc.frequency.value = i === 1 ? 1320 : 880 // accent the final beep
        beepGain.gain.value = 0.0001
        beepGain.gain.setValueAtTime(0.0001, when)
        beepGain.gain.exponentialRampToValueAtTime(0.3, when + 0.01)
        beepGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12)
        osc.connect(beepGain)
        beepGain.connect(this.ctx.destination)
        osc.start(when)
        osc.stop(when + 0.15)
      }
    }

    // Capture worklet: mic -> worklet (NO destination connection — capture only).
    const worklet = new AudioWorkletNode(this.ctx, WORKLET_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    })
    worklet.port.onmessage = (ev: MessageEvent): void => {
      const msg = parsePcmMessage(ev.data)
      if (msg) this.ingest(msg)
    }
    this.micSource.connect(worklet)
    this.worklet = worklet

    this.state = 'recording'
  }

  /** Accept a quantum, keeping only samples at/after t0 (sample-accurate). */
  private ingest(msg: PcmQuantum): void {
    if (this.t0 === null) return
    const sr = this.ctx.sampleRate
    const t0Frame = Math.round(this.t0 * sr)
    const quantumEndFrame = msg.frame + msg.samples.length

    // Entirely before t0 -> warm-up jitter, discard.
    if (quantumEndFrame <= t0Frame) return

    let samples = msg.samples
    let startFrame = msg.frame
    // Quantum straddles t0 -> trim the head so the first kept sample IS t0.
    if (msg.frame < t0Frame) {
      const cut = t0Frame - msg.frame
      samples = msg.samples.subarray(cut)
      startFrame = t0Frame
    } else {
      // Defensive copy: subarray above already detaches; here we copy so the
      // worklet's transferred buffer can't be mutated/reused under us.
      samples = msg.samples.slice()
    }

    if (this.firstKeptFrame === null) {
      this.firstKeptFrame = startFrame
    }
    this.chunks.push({ frame: startFrame, samples })
    this.keptLength += samples.length
  }

  /**
   * Current song position in seconds for slaving a <video> to the audio clock:
   *   (ctx.currentTime - t0), clamped to >= 0.
   * During the pre-roll (before t0) returns a NEGATIVE countdown value so the
   * UI can render "3… 2… 1…". Returns 0 when not recording.
   */
  getPosition(): number {
    if (this.t0 === null) return 0
    return this.ctx.currentTime - this.t0
  }

  /** RMS level of the mic in [0,1] for a VU meter. Allocation-free per call. */
  getLevel(): number {
    if (!this.analyser || !this.levelBuf) return 0
    this.analyser.getFloatTimeDomainData(this.levelBuf)
    let sumSq = 0
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = this.levelBuf[i]
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / this.levelBuf.length)
    return rms > 1 ? 1 : rms
  }

  /**
   * Flatten the kept Float32 chunks into one contiguous mono buffer, encode a
   * 16-bit WAV at the TRUE context sample rate, and return the take metadata.
   * Stops the backing + mic tracks but does NOT close the context, so the engine
   * can be re-armed/re-started for another take. Call dispose() to fully tear down.
   */
  async stop(): Promise<RecordingResult> {
    if (this.state !== 'recording') {
      throw new RecordingEngineError('not-recording', `stop() called while state=${this.state}.`)
    }

    // Disconnect capture first so no more quanta land mid-flatten.
    if (this.worklet) {
      this.worklet.port.onmessage = null
      this.micSource?.disconnect(this.worklet)
      this.worklet.disconnect()
      this.worklet = null
    }

    // Stop & release the backing playback.
    if (this.backingSource) {
      try {
        this.backingSource.stop()
      } catch {
        // already stopped / never started — ignore
      }
      this.backingSource.disconnect()
      this.backingSource = null
    }
    this.backingGainNode?.disconnect()
    this.backingGainNode = null

    // Stop the mic tracks AND release the capture graph. A stopped
    // MediaStreamTrack is permanently dead, so the next take MUST re-arm()
    // (which reacquires the mic). start() rejects anything but 'armed', so the
    // only supported re-record path is arm() -> start() — no silent dead-mic take.
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
    this.micSource?.disconnect()
    this.micSource = null
    this.analyser?.disconnect()
    this.analyser = null
    this.levelBuf = null

    const sampleRate = this.ctx.sampleRate

    if (this.keptLength === 0 || this.firstKeptFrame === null || this.t0 === null) {
      this.state = 'stopped'
      throw new RecordingEngineError('no-samples', 'No audio was captured.')
    }

    // Flatten kept quanta into one contiguous mono buffer.
    const flat = new Float32Array(this.keptLength)
    let offset = 0
    for (const chunk of this.chunks) {
      flat.set(chunk.samples, offset)
      offset += chunk.samples.length
    }

    // record_start_song_sec: the song-timeline position of the FIRST KEPT
    // sample, derived from its context-frame index at the TRUE sample rate —
    // sample-accurate, never from a rAF-polled <video>. t0 IS backing-sample-0
    // (we .start(t0) the backing), so the anchor is (firstKeptFrame/sr - t0).
    // By construction firstKeptFrame == round(t0*sr), so this is ~0 (we capture
    // from the top of the backing); the formula stays correct if a future
    // caller anchors the backing at a non-zero song offset.
    const recordStartSongSec = this.firstKeptFrame / sampleRate - this.t0
    const anchorSec = recordStartSongSec < 0 ? 0 : recordStartSongSec

    const wavBlob = encodeWavMono(flat, sampleRate)
    const durationSec = flat.length / sampleRate

    this.state = 'stopped'

    return {
      wavBlob,
      sampleRate,
      recordStartSongSec: anchorSec,
      durationSec,
    }
  }

  /** Tear everything down and close the context. The engine is unusable after. */
  async dispose(): Promise<void> {
    if (this.worklet) {
      this.worklet.port.onmessage = null
      this.worklet.disconnect()
      this.worklet = null
    }
    if (this.backingSource) {
      try {
        this.backingSource.stop()
      } catch {
        // ignore
      }
      this.backingSource.disconnect()
      this.backingSource = null
    }
    this.backingGainNode?.disconnect()
    this.backingGainNode = null
    this.analyser?.disconnect()
    this.analyser = null
    this.micSource?.disconnect()
    this.micSource = null
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
    this.backingBuffer = null
    this.levelBuf = null
    this.chunks.length = 0
    this.keptLength = 0
    this.state = 'idle'
    if (this.ctx.state !== 'closed') {
      await this.ctx.close()
    }
  }
}
