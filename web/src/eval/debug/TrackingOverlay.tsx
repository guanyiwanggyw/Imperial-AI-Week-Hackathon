// Live overlay: draws the current MediaPipe landmarks over a <video> (debug page). Place it inside the same
// positioned box as the video. Colours: see draw.ts.
import { useEffect, useRef } from 'react'
import type { SampleX } from '../contracts'
import type { VisionTracker } from '../signals/vision'
import { drawTracking, fitBox, palette, type Layers, type Pt } from './draw'

export type OverlayLayers = Layers

interface Props {
  tracker: VisionTracker
  /** Latest evaluated sample, for colour-coding. */
  getSample?: () => SampleX | null
  layers?: Layers
  /** Match the video's mirroring (the app mirrors the self-view). */
  mirror?: boolean
}

type Lm = { x: number; y: number; visibility?: number }
const pts = (lm: Lm[], needVisible = false): Pt => (i) => {
  const p = lm[i]
  return p && (!needVisible || (p.visibility ?? 1) > 0.5) ? p : null
}

export function TrackingOverlay({ tracker, getSample, layers = { face: true, hands: true, pose: true }, mirror = true }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const layersRef = useRef(layers)
  const sampleRef = useRef(getSample)
  useEffect(() => {
    layersRef.current = layers
    sampleRef.current = getSample
  }, [layers, getSample])

  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const colors = palette()
    let raf = 0
    let lastAt = -1
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const f = tracker.latest
      const video = c.parentElement?.querySelector('video')
      if (video && video.videoWidth && (c.width !== video.videoWidth || c.height !== video.videoHeight)) {
        c.width = video.videoWidth
        c.height = video.videoHeight
      }
      if (!f || f.at === lastAt) return
      lastAt = f.at
      ctx.clearRect(0, 0, c.width, c.height)
      drawTracking(
        ctx,
        { face: f.raw.face ? pts(f.raw.face) : null, hands: f.raw.hands.map((h) => pts(h)), pose: f.raw.pose ? pts(f.raw.pose, true) : null },
        fitBox(c.width, c.height, c.width, c.height, 'contain'),
        sampleRef.current?.() ?? null,
        layersRef.current,
        colors,
      )
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [tracker])

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined, pointerEvents: 'none' }}
    />
  )
}
