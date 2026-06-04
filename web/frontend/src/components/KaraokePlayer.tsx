import { useRef } from 'react'
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

  return (
    <div className="player">
      <div className="stage">
        {render.exists ? (
          // biome-ignore lint/a11y/useMediaCaption: lyrics are rendered live in the teleprompter
          <video
            ref={ref}
            className="video"
            src={mediaUrl(render.url ?? '/api/media/render')}
            controls
            playsInline
          />
        ) : (
          <div className="stage-missing">
            Render not found — run <code>just render</code> (or the Editor&rsquo;s re-render).
          </div>
        )}
        <LyricTeleprompter lyrics={lyrics} t={t} />
      </div>
      <SlotRibbon cut={cut} clips={clips} t={t} onSeek={seek} />
    </div>
  )
}
