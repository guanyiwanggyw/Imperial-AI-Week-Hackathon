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
  sample: Pick<SampleX, 'gazeOnTarget' | 'armsOpen' | 'faceTouch' | 'slouch' | 'gazeYaw' | 'gazePitch' | 'shoulderTilt'> | null,
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
      if (sample && (sample.slouch > T.body.slouchBad || (sample.shoulderTilt ?? 0) > T.body.tiltBad) && SHOULDERS.has(key)) return colors.warn
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
    if (sample?.gazeYaw != null && sample.gazePitch != null) drawGaze(ctx, pts.face, box, sample.gazeYaw, sample.gazePitch, sample.gazeOnTarget ? colors.good : colors.bad, lw)
  }
}

const IRIS_RINGS = [
  [469, 470, 471, 472],
  [474, 475, 476, 477],
]

/**
 * Gaze arrow from between the eyes. Its direction and length show how far the combined head + eye gaze is from
 * the calibrated target: a dot when on target, a longer arrow the further away the eyes point.
 */
function drawGaze(ctx: CanvasRenderingContext2D, face: Pt, box: Box, yaw: number, pitch: number, color: string, lw: number) {
  const centres = IRIS_RINGS.map((ring) => {
    const ps = ring.map(face).filter((p): p is { x: number; y: number } => p !== null)
    return ps.length ? { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null
  })
  if (!centres[0] || !centres[1]) return
  const x0 = box.x + ((centres[0].x + centres[1].x) / 2) * box.w
  const y0 = box.y + ((centres[0].y + centres[1].y) / 2) * box.h
  const span = Math.hypot((centres[0].x - centres[1].x) * box.w, (centres[0].y - centres[1].y) * box.h)
  const rad = (d: number) => (d * Math.PI) / 180
  const len = span * 4
  const x1 = x0 + Math.sin(rad(Math.max(-60, Math.min(60, yaw)))) * len
  const y1 = y0 + Math.sin(rad(Math.max(-60, Math.min(60, pitch)))) * len
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lw * 1.6
  if (Math.hypot(x1 - x0, y1 - y0) < span * 0.4) {
    ctx.beginPath()
    ctx.arc(x0, y0, lw * 2.5, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  const a = Math.atan2(y1 - y0, x1 - x0)
  const head = lw * 6
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45))
  ctx.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45))
  ctx.closePath()
  ctx.fill()
}

/** The rectangle a video picture occupies inside an element of size (cw, ch) with object-fit: contain or cover. */
export function fitBox(vw: number, vh: number, cw: number, ch: number, fit: 'contain' | 'cover'): Box {
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch }
  const scale = fit === 'contain' ? Math.min(cw / vw, ch / vh) : Math.max(cw / vw, ch / vh)
  const w = vw * scale
  const h = vh * scale
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
}
