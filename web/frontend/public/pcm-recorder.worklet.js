// AudioWorkletProcessor 'pcm-recorder': forwards each mono Float32 quantum to
// the main thread as a COPY (slice) via postMessage. No SharedArrayBuffer, so
// no COOP/COEP headers are required. Worklet global scope provides currentFrame,
// sampleRate and registerProcessor as ambient globals.

class PcmRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    const ch = input?.[0]
    if (ch?.length) {
      this.port.postMessage({ frame: currentFrame, samples: ch.slice(0) })
    }
    return true
  }
}

registerProcessor('pcm-recorder', PcmRecorder)
