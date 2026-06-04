// calibrate.ts — per-device round-trip latency measurement.
//
// The whole point: the singer hears the backing through (output buffer -> DAC ->
// air/headphone -> ear), reacts, and the mic captures (air -> ADC -> input
// buffer). Every link adds delay the server must compensate for so the vocal
// lands on the beat. We measure the *whole* loop physically: emit a known click
// through the output at a known context time with AEC OFF, capture the mic,
// cross-correlate the recording against the emit time to recover the lag in
// samples -> ms. Persist per deviceId so the user calibrates a device once.
//
// When the user skips calibration we fall back to the context's own estimate
// (outputLatency + baseLatency). It's a guess, and we say so.

/** localStorage key namespace; one entry per input deviceId. */
const STORAGE_PREFIX = 'abra.calib.'

/** Plausible round-trip window. Outside this the cross-correlation almost
 *  certainly locked onto noise/echo, not the click — reject and fall back. */
const MIN_PLAUSIBLE_MS = 20
const MAX_PLAUSIBLE_MS = 400

/** Click impulse length in samples (~1–2 ms depending on rate). Short enough to
 *  give a sharp correlation peak, long enough to survive the output path. */
const CLICK_MS = 1.5

/** How long to listen for the click to come back, in seconds. Comfortably more
 *  than MAX_PLAUSIBLE_MS plus the scheduling offset. */
const CAPTURE_WINDOW_SEC = 0.6

/** Seconds in the future to schedule the click so the graph is settled. */
const EMIT_OFFSET_SEC = 0.15

/** Build a short impulse: a single-cycle-ish click (a couple of full-scale
 *  samples) followed by silence. A true unit impulse smears through the output
 *  filter; a 1–2 ms burst correlates more robustly. */
function makeClickBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate
  const clickSamples = Math.max(1, Math.round((CLICK_MS / 1000) * sr))
  const buf = ctx.createBuffer(1, clickSamples, sr)
  const ch = buf.getChannelData(0)
  for (let i = 0; i < clickSamples; i++) {
    // Alternating full-scale gives broadband energy -> a sharp xcorr peak.
    ch[i] = i % 2 === 0 ? 1 : -1
  }
  return buf
}

/**
 * Cross-correlate the recorded signal against the click reference and return the
 * lag (in samples) of the best match, searched only within the plausible window.
 * Straightforward O(window * clickLen) — not real-time, but honest and correct.
 */
function bestLagSamples(
  recorded: Float32Array,
  click: Float32Array,
  emitFrame: number,
  sampleRate: number,
): number | null {
  const minLag = Math.floor((MIN_PLAUSIBLE_MS / 1000) * sampleRate)
  const maxLag = Math.ceil((MAX_PLAUSIBLE_MS / 1000) * sampleRate)
  const clickLen = click.length

  let bestLag = -1
  let bestScore = Number.NEGATIVE_INFINITY

  for (let lag = minLag; lag <= maxLag; lag++) {
    const base = emitFrame + lag
    if (base + clickLen > recorded.length) break
    let dot = 0
    for (let k = 0; k < clickLen; k++) {
      dot += recorded[base + k] * click[k]
    }
    if (dot > bestScore) {
      bestScore = dot
      bestLag = lag
    }
  }

  // No positive correlation -> nothing that looks like our click came back.
  if (bestLag < 0 || bestScore <= 0) return null
  return bestLag
}

/** Record the mic into one contiguous Float32Array for `seconds`, returning the
 *  buffer and the context-frame index at which capture started. We need the LIVE
 *  mic, so we tap a MediaStreamAudioSourceNode through an AnalyserNode and poll
 *  getFloatTimeDomainData on a rAF — worklet-light and dependency-free. The emit
 *  is scheduled on the SAME ctx clock, so the lag stays recoverable. (Polling is
 *  coarse but the cross-correlation peak survives it; this is a one-shot calibration,
 *  not a real-time path.) */
async function captureMic(
  ctx: AudioContext,
  stream: MediaStream,
  startContextTime: number,
  seconds: number,
): Promise<{ data: Float32Array; startFrame: number }> {
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)

  const sr = ctx.sampleRate
  const total = Math.ceil(seconds * sr)
  const out = new Float32Array(total)
  const frame = new Float32Array(analyser.fftSize)
  let written = 0
  const startFrame = Math.round(startContextTime * sr)

  await new Promise<void>((resolve) => {
    const endTime = startContextTime + seconds
    const pump = (): void => {
      analyser.getFloatTimeDomainData(frame)
      const room = total - written
      const n = room < frame.length ? room : frame.length
      if (n > 0) {
        out.set(frame.subarray(0, n), written)
        written += n
      }
      if (ctx.currentTime >= endTime || written >= total) {
        resolve()
        return
      }
      requestAnimationFrame(pump)
    }
    // Wait until the scheduled start before pumping.
    const waitForStart = (): void => {
      if (ctx.currentTime >= startContextTime) {
        pump()
        return
      }
      requestAnimationFrame(waitForStart)
    }
    waitForStart()
  })

  source.disconnect()
  analyser.disconnect()
  return { data: out, startFrame }
}

/**
 * Measure round-trip latency in ms via click-loopback cross-correlation.
 *
 * Acquires its OWN mic stream (AEC/NS/AGC OFF) so it can run independently of
 * the RecordingEngine, schedules a click on the provided (or a fresh) context,
 * captures the mic bleed, and cross-correlates to find the lag.
 *
 * Returns the measured latency in ms, clamped to the plausible 20–400 ms window.
 * Throws if the click could not be located (caller should fall back to
 * estimateLatencyMs and/or the manual nudge slider).
 *
 * NOTE: the caller is responsible for persisting via saveCalibration(deviceId,
 * ms) using the deviceId of the input device this was measured on.
 */
export async function calibrate(engineCtx?: AudioContext): Promise<number> {
  const ownsCtx = engineCtx === undefined
  const ctx = engineCtx ?? new AudioContext({ latencyHint: 'interactive' })

  // AEC OFF is essential: echo cancellation would try to remove the very click
  // bleed we are trying to measure.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  })

  try {
    await ctx.resume()

    const clickBuffer = makeClickBuffer(ctx)
    const click = clickBuffer.getChannelData(0).slice()
    const sr = ctx.sampleRate

    const emitTime = ctx.currentTime + EMIT_OFFSET_SEC
    const emitFrameAbs = Math.round(emitTime * sr)

    // Schedule the click through the output.
    const src = ctx.createBufferSource()
    src.buffer = clickBuffer
    src.connect(ctx.destination)
    src.start(emitTime)

    // Capture starting at emitTime for the full window.
    const { data, startFrame } = await captureMic(ctx, stream, emitTime, CAPTURE_WINDOW_SEC)

    src.disconnect()

    // The click was emitted at emitFrameAbs; capture began at startFrame
    // (== emitFrameAbs by construction). Lag is measured from the start of the
    // captured buffer, i.e. emitFrame within `data` is 0.
    const emitFrameInBuffer = emitFrameAbs - startFrame
    const lag = bestLagSamples(data, click, emitFrameInBuffer, sr)
    if (lag === null) {
      throw new Error('calibration click not detected in capture')
    }

    const ms = (lag / sr) * 1000
    if (ms < MIN_PLAUSIBLE_MS || ms > MAX_PLAUSIBLE_MS) {
      throw new Error(`measured latency ${ms.toFixed(1)}ms outside plausible range`)
    }
    return ms
  } finally {
    for (const t of stream.getTracks()) t.stop()
    if (ownsCtx && ctx.state !== 'closed') {
      await ctx.close()
    }
  }
}

/** Read a previously saved calibration (ms) for a device, or null if none/invalid. */
export function loadCalibration(deviceId: string): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + deviceId)
    if (raw === null) return null
    const ms = Number.parseFloat(raw)
    if (!Number.isFinite(ms)) return null
    if (ms < MIN_PLAUSIBLE_MS || ms > MAX_PLAUSIBLE_MS) return null
    return ms
  } catch {
    // localStorage can throw in private mode / disabled storage.
    return null
  }
}

/** Persist a calibration (ms) for a device. Silently no-ops if out of range or
 *  storage is unavailable — calibration is an optimization, never load-bearing. */
export function saveCalibration(deviceId: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < MIN_PLAUSIBLE_MS || ms > MAX_PLAUSIBLE_MS) {
    return
  }
  try {
    localStorage.setItem(STORAGE_PREFIX + deviceId, String(ms))
  } catch {
    // ignore — non-fatal
  }
}

/** Honest fallback when the user skips calibration: the context's own estimate
 *  of output-side latency. Does NOT include input/air latency, so it
 *  underestimates the true round trip — the manual nudge slider covers the rest. */
export function estimateLatencyMs(ctx: AudioContext): number {
  return (ctx.outputLatency + ctx.baseLatency) * 1000
}
