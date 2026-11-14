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
}

/** One analysed video frame. Coordinates are normalised to the image (0–1). Angles in degrees. */
export interface VisionFrame {
  /** performance.now() when the frame was analysed */
  at: number
  face: boolean
  yaw: number
  pitch: number
  eyeLook: Record<string, number>
  smile: number
  faceTouch: boolean
  /** Hand landmarker wrists (more reliable than pose wrists when hands are raised). */
  wrists: Point[]
  pose: PosePoints | null
}

const EYE_LOOK = ['eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft', 'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight']
export const EYE_LOOK_KEYS = EYE_LOOK

const deg = (rad: number) => (rad * 180) / Math.PI

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

  /** Starts analysing ~7 frames a second. Safe to call once; later calls are ignored. */
  async start(video: HTMLVideoElement) {
    if (this.timer !== undefined || this.ready) return
    try {
      const { face, hand, pose } = await loadVision()
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
        const angles = matrix ? headAngles(matrix) : { yaw: 0, pitch: 0 }
        const pl = p?.landmarks[0]
        const prevPose = this.latest?.pose ?? null
        const posePoints: PosePoints | null = pl
          ? (() => {
              const nose = visible(pl[0])
              const ls = visible(pl[11])
              const rs = visible(pl[12])
              if (!nose || !ls || !rs) return null
              return { nose, leftShoulder: ls, rightShoulder: rs, leftWrist: visible(pl[15]), rightWrist: visible(pl[16]) }
            })()
          : p
            ? null
            : prevPose
        this.latest = {
          at: ts,
          face: Boolean(lm),
          yaw: angles.yaw,
          pitch: angles.pitch,
          eyeLook: Object.fromEntries(EYE_LOOK.map((k) => [k, score(k)])),
          smile: (score('mouthSmileLeft') + score('mouthSmileRight')) / 2,
          faceTouch: lm ? touchesFace(lm, h.landmarks) : false,
          wrists: h.landmarks.map((hl) => ({ x: hl[0].x, y: hl[0].y })),
          pose: posePoints,
        }
      }, Math.round(1000 / T.sampleHz))
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  stop() {
    window.clearInterval(this.timer)
    this.timer = undefined
  }
}
