// Shared drawing of face, hand and pose landmarks, used by the live debug overlay and the recording playback.
// Colour-coded by the evaluation's reading: face outline green/red = gaze on/off target, hands amber = touching face,
// forearms red = arms crossed, shoulder line amber = slouching.
import { FaceLandmarker, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { SampleX } from '../contracts'
import { T } from '../thresholds'

export type Pt = (i: number) => { x: number; y: number } | null

export interface TrackingPoints {
  face: Pt | null
  hands: Pt[]
  pose: Pt | null
}

export interface Layers {
  face: boolean
  hands: boolean
  pose: boolean
}

export interface Palette {
  good: string
  warn: string
  bad: string
  accent: string
}

/** Where the video picture is drawn inside the canvas (after letterboxing). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Conn = { start: number; end: number }

export const FACE_CONNS: Conn[] = [
  ...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_LIPS,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
]
export const IRIS_CONNS: Conn[] = [...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS]
/** Upper-body pose points: nose, shoulders, elbows, wrists, hips. */
export const POSE_IDX = [0, 11, 12, 13, 14, 15, 16, 23, 24]
const POSE_SET = new Set(POSE_IDX)
const POSE_CONNS: Conn[] = PoseLandmarker.POSE_CONNECTIONS.filter((c) => POSE_SET.has(c.start) && POSE_SET.has(c.end))
const FOREARMS = new Set(['13-15', '15-13', '14-16', '16-14'])
const SHOULDERS = new Set(['11-12', '12-11'])

/** The face-mesh points the drawing uses (and therefore the only ones worth recording). */
export const FACE_IDX = [...new Set([...FACE_CONNS, ...IRIS_CONNS].flatMap((c) => [c.start, c.end]))].sort((a, b) => a - b)

export function palette(): Palette {
  const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  return { good: css('--good', '#0f8a4a'), warn: css('--warn', '#b26b00'), bad: css('--bad', '#c43d3c'), accent: css('--accent', '#2a78d6') }
}

function lines(ctx: CanvasRenderingContext2D, pt: Pt, conns: Conn[], box: Box, color: (c: Conn) => string | null) {
  for (const c of conns) {
    const a = pt(c.start)
    const b = pt(c.end)
    if (!a || !b) continue
    const col = color(c)
    if (!col) continue
    ctx.strokeStyle = col
    ctx.beginPath()
    ctx.moveTo(box.x + a.x * box.w, box.y + a.y * box.h)
    ctx.lineTo(box.x + b.x * box.w, box.y + b.y * box.h)
    ctx.stroke()
  }
}

function dots(ctx: CanvasRenderingContext2D, pt: Pt, idx: number[], box: Box, r: number, color: string) {
  ctx.fillStyle = color
  for (const i of idx) {
    const p = pt(i)
    if (!p) continue
    ctx.beginPath()
    ctx.arc(box.x + p.x * box.w, box.y + p.y * box.h, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

const HAND_IDX = Array.from({ length: 21 }, (_, i) => i)

export function drawTracking(
  ctx: CanvasRenderingContext2D,
  pts: TrackingPoints,
  box: Box,
  sample: Pick<SampleX, 'gazeOnTarget' | 'armsOpen' | 'faceTouch' | 'slouch'> | null,
  layers: Layers,
  colors: Palette,
) {
  const lw = Math.max(1.5, box.w / 450)
  ctx.lineCap = 'round'

  if (layers.pose && pts.pose) {
    ctx.lineWidth = lw * 2
    lines(ctx, pts.pose, POSE_CONNS, box, ({ start, end }) => {
      const key = `${start}-${end}`
      if (sample && !sample.armsOpen && FOREARMS.has(key)) return colors.bad
      if (sample && sample.slouch > T.body.slouchBad && SHOULDERS.has(key)) return colors.warn
      return colors.accent
    })
    dots(ctx, pts.pose, POSE_IDX, box, lw * 2.2, colors.accent)
  }

  if (layers.hands) {
    ctx.lineWidth = lw
    const handColor = sample?.faceTouch ? colors.warn : colors.good
    for (const hand of pts.hands) {
      lines(ctx, hand, HandLandmarker.HAND_CONNECTIONS, box, () => handColor)
      dots(ctx, hand, HAND_IDX, box, lw * 1.4, handColor)
    }
  }

  if (layers.face && pts.face) {
    ctx.lineWidth = lw
    const faceColor = sample ? (sample.gazeOnTarget ? colors.good : colors.bad) : 'rgba(255,255,255,0.8)'
    ctx.globalAlpha = 0.85
    lines(ctx, pts.face, FACE_CONNS, box, () => faceColor)
    ctx.globalAlpha = 1
    lines(ctx, pts.face, IRIS_CONNS, box, () => '#ffffff')
  }
}

/** The rectangle a video picture occupies inside an element of size (cw, ch) with object-fit: contain or cover. */
export function fitBox(vw: number, vh: number, cw: number, ch: number, fit: 'contain' | 'cover'): Box {
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch }
  const scale = fit === 'contain' ? Math.min(cw / vw, ch / vh) : Math.max(cw / vw, ch / vh)
  const w = vw * scale
  const h = vh * scale
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
}
