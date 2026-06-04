import { type RefObject, useEffect, useState } from 'react'

/** Track a <video>'s currentTime via rAF while playing (and on seek/pause). */
export function useVideoTime(ref: RefObject<HTMLVideoElement | null>): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    let raf = 0
    const tick = () => {
      setT(v.currentTime)
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      setT(v.currentTime)
    }
    v.addEventListener('play', start)
    v.addEventListener('playing', start)
    v.addEventListener('pause', stop)
    v.addEventListener('seeked', stop)
    if (!v.paused) start()
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('play', start)
      v.removeEventListener('playing', start)
      v.removeEventListener('pause', stop)
      v.removeEventListener('seeked', stop)
    }
  }, [ref])
  return t
}
