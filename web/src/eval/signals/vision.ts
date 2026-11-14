// Face, hands and pose with MediaPipe, entirely in the browser. Video never leaves the device.
// Produces raw VisionFrames; SignalSampler turns them into calibrated Samples.
import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { T } from '../thresholds'

const LOCAL = '/mediapipe'
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const CDN_MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
}

async function exists(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok && !res.headers.get('content-type')?.includes('text/html')
  } catch {
    return false
  }
}

interface Models {
  face: FaceLandmarker
  hand: HandLandmarker
  pose: PoseLandmarker | null
}

let loading: Promise<Models> | null = null

/** Loads models once. Prefers local copies (npm run setup) so the demo works offline. Pose is optional. */
export function loadVision() {
  loading ??= (async () => {
    const local = await exists(`${LOCAL}/face_landmarker.task`)
    const localPose = local && (await exists(`${LOCAL}/pose_landmarker_lite.task`))
    const fileset = await FilesetResolver.forVisionTasks(local ? `${LOCAL}/wasm` : CDN_WASM)
    const face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: local ? `${LOCAL}/face_landmarker.task` : CDN_MODELS.face, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
    const hand = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: local ? `${LOCAL}/hand_landmarker.task` : CDN_MODELS.hand, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    })
    let pose: PoseLandmarker | null = null
    try {
      pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: localPose ? `${LOCAL}/pose_landmarker_lite.task` : CDN_MODELS.pose, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
    } catch (err) {
      console.warn('Pose model unavailable, body posture will not be measured:', err)
    }
    return { face, hand, pose }
  })()
  loading.catch(() => (loading = null))
  return loading
}

export interface Point {
  x: number
  y: number
}

export interface PosePoints {
  nose: Point
  leftShoulder: Point
  rightShoulder: Point
  leftWrist: Point | null
  rightWrist: Point | null
  /** Hips, when the waist is in frame. */
  leftHip: Point | null
  rightHip: Point | null
}

/** One analysed video frame. Coordinates are normalised to the image (0–1). Angles in degrees. */
export interface VisionFrame {
  /** performance.now() when the frame was analysed */
  at: number
  face: boolean
  /** Head yaw and pitch in degrees, signed in image terms: + = turned towards image right / tilted down. */
  yaw: number
  pitch: number
  /** Eye-in-head angles from the irises (degrees, same signs). Null when the eyes are closed or not found. */
  eyeYaw: number | null
  eyePitch: number | null
  /** Eyes closed (blink). */
  blink: boolean
  /** Eyebrow raise, 0–1. */
  brow: number
  /** Distance between the outer eye corners, aspect-corrected (normalised image width units). */
  eyeSpan: number | null
  /** Video width / height, to measure distances and angles without stretching. */
  aspect: number
  eyeLook: Record<string, number>
  smile: number
  /** jawOpen blendshape, 0–1, for the mouth-movement speech gate. */
  jawOpen: number
  faceTouch: boolean
  /** Hand landmarker wrists (more reliable than pose wrists when hands are raised). */
  wrists: Point[]
  pose: PosePoints | null
  /** Raw landmarks of this frame, for drawing (TrackingOverlay). Pose is carried over on frames where it is skipped. */
  raw: RawLandmarks
}

export interface RawLandmarks {
  face: NormalizedLandmark[] | null
  hands: NormalizedLandmark[][]
  pose: NormalizedLandmark[] | null
}

const EYE_LOOK = ['eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft', 'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight']
export const EYE_LOOK_KEYS = EYE_LOOK

const deg = (rad: number) => (rad * 180) / Math.PI
const asinDeg = (v: number) => deg(Math.asin(Math.max(-0.95, Math.min(0.95, v))))

/**
 * Iris position inside one eye, as offsets relative to the eye width: h along the corner-to-corner axis
 * (+ = towards image right, 0 = centred), v perpendicular to it from the lid midpoint (+ = down).
 * x is multiplied by the aspect ratio so the geometry is in square units.
 */
export function irisOffset(lm: NormalizedLandmark[], iris: number, c1: number, c2: number, up: number, low: number, aspect: number): { h: number; v: number } | null {
  const P = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y })
  if (!lm[iris] || !lm[c1] || !lm[c2] || !lm[up] || !lm[low]) return null
  const a = P(c1)
  const b = P(c2)
  let ux = b.x - a.x
  let uy = b.y - a.y
  const w = Math.hypot(ux, uy)
  if (w < 1e-4) return null
  ux /= w
  uy /= w
  let ox = a.x
  let oy = a.y
  if (ux < 0) {
    ux = -ux
    uy = -uy
    ox = b.x
    oy = b.y
  }
  const i = P(iris)
  const along = ((i.x - ox) * ux + (i.y - oy) * uy) / w
  const m = { x: (P(up).x + P(low).x) / 2, y: (P(up).y + P(low).y) / 2 }
  const v = ((i.x - m.x) * -uy + (i.y - m.y) * ux) / w
  return { h: along - 0.5, v }
}

/**
 * The transformation matrix gives accurate head angles, but its sign convention is not documented. This keeps
 * a running agreement with a simple image-space estimate (nose offset from the eyes) and flips the sign to match,
 * so head and eye angles add up the same way.
 */
class SignAligner {
  private acc = 0
  private meanA = 0
  private meanB = 0
  private n = 0
  sign(a: number, b: number) {
    this.n++
    const k = this.n < 30 ? 1 / this.n : 0.03
    this.meanA += (a - this.meanA) * k
    this.meanB += (b - this.meanB) * k
    this.acc = this.acc * 0.999 + (a - this.meanA) * (b - this.meanB)
    return this.acc < 0 ? -1 : 1
  }
}

/**
 * Head yaw and pitch from MediaPipe's 4x4 facial transformation matrix (column-major).
 * Only differences from the calibrated baseline are used, so the sign convention does not matter.
 */
export function headAngles(m: ArrayLike<number>): { yaw: number; pitch: number } {
  // Rotation part R[row][col] = m[col * 4 + row]
  const r20 = m[2]
  const r21 = m[6]
  const r22 = m[10]
  const yaw = deg(Math.atan2(-r20, Math.hypot(r21, r22)))
  const pitch = deg(Math.atan2(r21, r22))
  return { yaw, pitch }
}

const FINGERTIPS = [4, 8, 12, 16, 20]

function touchesFace(face: NormalizedLandmark[], hands: NormalizedLandmark[][]): boolean {
  if (!hands.length) return false
  let x0 = 1
  let y0 = 1
  let x1 = 0
  let y1 = 0
  for (const p of face) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  const mx = (x1 - x0) * T.body.faceTouchMargin
  const my = (y1 - y0) * T.body.faceTouchMargin
  return hands.some((h) => FINGERTIPS.some((i) => h[i] && h[i].x > x0 - mx && h[i].x < x1 + mx && h[i].y > y0 - my && h[i].y < y1 + my))
}

const visible = (p: NormalizedLandmark | undefined) => (p && (p.visibility ?? 1) > 0.5 ? { x: p.x, y: p.y } : null)

export class VisionTracker {
  latest: VisionFrame | null = null
  ready = false
  error: string | null = null
  private timer: number | undefined
  private tick = 0
  private yawSign = new SignAligner()
  private pitchSign = new SignAligner()
  private lastEye: { yaw: number; pitch: number } | null = null
  /** Bumped by start() and stop(), so a start whose model load finishes after a stop (React StrictMode) does nothing. */
  private generation = 0

  /** Starts analysing ~7 frames a second. Calling it while running is a no-op; it can be restarted after stop(). */
  async start(video: HTMLVideoElement) {
    if (this.timer !== undefined) return
    const gen = ++this.generation
    try {
      const { face, hand, pose } = await loadVision()
      if (gen !== this.generation) return
      this.ready = true
      let lastTs = 0
      this.timer = window.setInterval(() => {
        if (video.readyState < 2) return
        // MediaPipe requires strictly increasing timestamps.
        const ts = Math.max(performance.now(), lastTs + 1)
        lastTs = ts
        this.tick++
        const f = face.detectForVideo(video, ts)
        const h = hand.detectForVideo(video, ts)
        // Pose changes slowly; run it on every other frame to save GPU time.
        const p = pose && this.tick % 2 === 0 ? pose.detectForVideo(video, ts) : null
        const lm = f.faceLandmarks[0]
        const blend = f.faceBlendshapes?.[0]?.categories ?? []
        const score = (name: string) => blend.find((c) => c.categoryName === name)?.score ?? 0
        const matrix = f.facialTransformationMatrixes?.[0]?.data
        const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
        const mat = matrix ? headAngles(matrix) : { yaw: 0, pitch: 0 }
        let yaw = mat.yaw
        let pitch = mat.pitch
        let eyeYaw: number | null = null
        let eyePitch: number | null = null
        let eyeSpan: number | null = null
        const blink = Math.max(score('eyeBlinkLeft'), score('eyeBlinkRight')) > T.gaze.blinkClosed
        if (lm) {
          // Image-space head estimates, only used to fix the matrix angles' signs.
          const eyeMid = { x: ((lm[33].x + lm[263].x) / 2) * aspect, y: (lm[33].y + lm[263].y) / 2 }
          eyeSpan = Math.hypot((lm[263].x - lm[33].x) * aspect, lm[263].y - lm[33].y)
          const faceH = Math.abs(lm[152].y - lm[10].y) || 1
          const geoYaw = (lm[1].x * aspect - eyeMid.x) / (eyeSpan || 1)
          const geoPitch = (lm[1].y - eyeMid.y) / faceH
          if (matrix) {
            yaw = mat.yaw * this.yawSign.sign(mat.yaw, geoYaw)
            pitch = mat.pitch * this.pitchSign.sign(mat.pitch, geoPitch)
          } else {
            yaw = geoYaw * 60
            pitch = (geoPitch - 0.2) * 90
          }
          if (blink) {
            if (this.lastEye) ({ yaw: eyeYaw, pitch: eyePitch } = this.lastEye)
          } else {
            const a = irisOffset(lm, 468, 33, 133, 159, 145, aspect)
            const b = irisOffset(lm, 473, 362, 263, 386, 374, aspect)
            const eyes = [a, b].filter((e): e is { h: number; v: number } => e !== null)
            if (eyes.length) {
              const h = eyes.reduce((s, e) => s + e.h, 0) / eyes.length
              const v = eyes.reduce((s, e) => s + e.v, 0) / eyes.length
              const blendPitch = ((score('eyeLookDownLeft') + score('eyeLookDownRight') - score('eyeLookUpLeft') - score('eyeLookUpRight')) / 2) * T.gaze.blendPitchDeg
              eyeYaw = asinDeg(T.gaze.irisGain * h)
              eyePitch = (1 - T.gaze.blendPitchWeight) * asinDeg(T.gaze.irisGain * v) + T.gaze.blendPitchWeight * blendPitch
              this.lastEye = { yaw: eyeYaw, pitch: eyePitch }
            }
          }
        }
        const pl = p?.landmarks[0]
        const prevPose = this.latest?.pose ?? null
        const posePoints: PosePoints | null = pl
          ? (() => {
              const nose = visible(pl[0])
              const ls = visible(pl[11])
              const rs = visible(pl[12])
              if (!nose || !ls || !rs) return null
              return { nose, leftShoulder: ls, rightShoulder: rs, leftWrist: visible(pl[15]), rightWrist: visible(pl[16]), leftHip: visible(pl[23]), rightHip: visible(pl[24]) }
            })()
          : p
            ? null
            : prevPose
        this.latest = {
          at: ts,
          face: Boolean(lm),
          yaw,
          pitch,
          eyeYaw,
          eyePitch,
          blink,
          brow: (score('browInnerUp') + (score('browOuterUpLeft') + score('browOuterUpRight')) / 2) / 2,
          eyeSpan,
          aspect,
          eyeLook: Object.fromEntries(EYE_LOOK.map((k) => [k, score(k)])),
          smile: (score('mouthSmileLeft') + score('mouthSmileRight')) / 2,
          jawOpen: score('jawOpen'),
          faceTouch: lm ? touchesFace(lm, h.landmarks) : false,
          wrists: h.landmarks.map((hl) => ({ x: hl[0].x, y: hl[0].y })),
          pose: posePoints,
          raw: { face: lm ?? null, hands: h.landmarks, pose: p ? (pl ?? null) : (this.latest?.raw.pose ?? null) },
        }
      }, Math.round(1000 / T.sampleHz))
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  stop() {
    this.generation++
    window.clearInterval(this.timer)
    this.timer = undefined
  }
}
