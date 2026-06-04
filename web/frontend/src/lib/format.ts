export const mmss = (t: number): string => {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Deterministic, readable colour per clip id (repeats share a colour). */
export const clipHue = (clip: number): string => `hsl(${(clip * 47) % 360} 55% 52%)`
