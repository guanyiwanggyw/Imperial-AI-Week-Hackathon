// Draws MediaPipe landmarks (face, hands, pose) over a <video>, colour-coded by the evaluation's reading:
// face outline green/red = gaze on/off target, hands amber = touching face, forearms red = arms crossed,
// shoulder line amber = slouching. Place it inside the same positioned box as the video.
import { useEffect, useRef } from 'react'
import { FaceLandmarker, HandLandmarker, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { SampleX } from '../contracts'
import { T } from '../thresholds'
import type { VisionTracker } from '../signals/vision'

export interface OverlayLayers {
  face: boolean
  hands: boolean
  pose: boolean
}

interface Props {
  tracker: VisionTracker
  /** Latest evaluated sample, for colour-coding. */
  getSample?: () => SampleX | null
  layers?: OverlayLayers
  /** Match the video's mirroring (the app mirrors the self-view). */
  mirror?: boolean
}

type Conn = { start: number; end: number }

const FACE = [...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, ...FaceLandmarker.FACE_LANDMARKS_LIPS, ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW]
const IRIS = [...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS]
const UPPER_BODY = new Set([0, 11, 12, 13, 14, 15, 16, 23, 24])
const FOREARMS = new Set(['13-15', '14-16', '15-13', '16-14'])

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function lines(ctx: CanvasRenderingContext2D, lm: NormalizedLandmark[], conns: Conn[], w: number, h: number, color: (c: Conn) => string | null) {
  for (const c of conns) {
    const a = lm[c.start]
    const b = lm[c.end]
    if (!a || !b) continue
    const col = color(c)
    if (!col) continue
    ctx.strokeStyle = col
    ctx.beginPath()
    ctx.moveTo(a.x * w, a.y * h)
    ctx.lineTo(b.x * w, b.y * h)
    ctx.stroke()
  }
}

function dots(ctx: CanvasRenderingContext2D, pts: NormalizedLandmark[], w: number, h: number, r: number, color: string) {
  ctx.fillStyle = color
  for (const p of pts) {
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2)
    ctx.fill()
  }
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
    const colors = {
      good: cssVar('--good', '#0f8a4a'),
      warn: cssVar('--warn', '#b26b00'),
      bad: cssVar('--bad', '#c43d3c'),
      accent: cssVar('--accent', '#2a78d6'),
    }
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
      const w = c.width
      const h = c.height
      const L = layersRef.current
      const s = sampleRef.current?.() ?? null
      const lw = Math.max(1.5, w / 450)
      ctx.clearRect(0, 0, w, h)
      ctx.lineWidth = lw
      ctx.lineCap = 'round'

      if (L.pose && f.raw.pose) {
        const pose = f.raw.pose
        const vis = (i: number) => (pose[i]?.visibility ?? 1) > 0.5
        ctx.lineWidth = lw * 2
        lines(ctx, pose, PoseLandmarker.POSE_CONNECTIONS, w, h, ({ start, end }) => {
          if (!UPPER_BODY.has(start) || !UPPER_BODY.has(end) || !vis(start) || !vis(end)) return null
          if (s && !s.armsOpen && FOREARMS.has(`${start}-${end}`)) return colors.bad
          if (s && s.slouch > T.body.slouchBad && ((start === 11 && end === 12) || (start === 12 && end === 11))) return colors.warn
          return colors.accent
        })
        dots(ctx, [...UPPER_BODY].filter(vis).map((i) => pose[i]), w, h, lw * 2.2, colors.accent)
        ctx.lineWidth = lw
      }

      if (L.hands) {
        const handColor = s?.faceTouch ? colors.warn : colors.good
        for (const hand of f.raw.hands) {
          lines(ctx, hand, HandLandmarker.HAND_CONNECTIONS, w, h, () => handColor)
          dots(ctx, hand, w, h, lw * 1.4, handColor)
        }
      }

      if (L.face && f.raw.face) {
        const faceColor = s ? (s.gazeOnTarget ? colors.good : colors.bad) : 'rgba(255,255,255,0.8)'
        ctx.globalAlpha = 0.85
        lines(ctx, f.raw.face, FACE, w, h, () => faceColor)
        ctx.globalAlpha = 1
        lines(ctx, f.raw.face, IRIS, w, h, () => '#ffffff')
      }
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
