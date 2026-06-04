// Canonical 16-bit PCM mono WAV encoder. Pure, zero-dependency. The header
// records the ACTUAL sampleRate passed in — a hardcoded rate would make a long
// take drift, so we always write the real value into the fmt/data chunks.

export function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample // mono: 1 channel * 2 bytes
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  // RIFF header
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')

  // fmt chunk
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // audio format: 1 = PCM
  view.setUint16(22, 1, true) // num channels: mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample

  // data chunk
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([buf], { type: 'audio/wav' })
}
