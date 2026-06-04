import { type CSSProperties, useRef } from 'react'
import { mediaUrl } from '../api/client'
import type { ClipInfo, Cut, LyricLine, RenderInfo } from '../api/generated/model'
import { useVideoTime } from '../lib/useVideoTime'
import { LyricTeleprompter } from './LyricTeleprompter'
import { SlotRibbon } from './SlotRibbon'

export function KaraokePlayer({
  cut,
  clips,
  lyrics,
  render,
}: {
  cut: Cut
  clips: ClipInfo[]
  lyrics: LyricLine[]
  render: RenderInfo
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const t = useVideoTime(ref)
  const seek = (to: number) => {
    const v = ref.current
    if (v) {
      v.currentTime = to
      void v.play().catch(() => undefined)
    }
  }

  // Verse identity breathes through the frame: tint the ring by the active
  // line's glow (the same data the teleprompter consumes), gold between lines.
  // --frame-glow is @property-registered as <color>, so it interpolates
  // smoothly gold->cyan->magenta across the song instead of hard-cutting.
  const activeLine =
    lyrics.find((l) => t >= l.start - 0.4 && t <= l.end + 0.6) ?? lyrics.find((l) => l.start > t)
  const frameGlow = activeLine?.theme.glow ?? 'var(--color-primary)'

  return (
    <div className="animate-folio-in">
      <div
        className="overflow-hidden rounded-2xl border border-line bg-black shadow-folio ring-1 ring-[color-mix(in_oklab,var(--frame-glow)_30%,transparent)] [transition:--frame-glow_0.7s_ease]"
        style={{ '--frame-glow': frameGlow } as CSSProperties}
      >
        {render.exists ? (
          // biome-ignore lint/a11y/useMediaCaption: lyrics are rendered live in the teleprompter
          <video
            ref={ref}
            className="block w-full"
            src={mediaUrl(render.url ?? '/api/media/render')}
            controls
            playsInline
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-8 py-20 text-center text-muted">
            <p className="font-display text-2xl text-on-surface-dim">Render not found</p>
            <p className="text-sm">
              Run <code>just render</code> (or the Editor&rsquo;s re-render).
            </p>
          </div>
        )}
        <LyricTeleprompter lyrics={lyrics} t={t} />
      </div>
      <SlotRibbon cut={cut} clips={clips} t={t} onSeek={seek} />
    </div>
  )
}
