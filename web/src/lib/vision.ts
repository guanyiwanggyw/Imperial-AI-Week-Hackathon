// Eye contact and gestures with MediaPipe, entirely in the browser. Video never leaves the device.
import { FaceLandmarker, FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { VisionSample } from '../types'

const LOCAL = '/mediapipe'
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const CDN_MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
}

async function exists(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok && !res.headers.get('content-type')?.includes('text/html')
  } catch {
    return false
  }
}

let loading: Promise<{ face: FaceLandmarker; hand: HandLandmarker }> | null = null

/** Loads models once. Prefers local copies (npm run setup) so the demo works offline. */
export function loadVision() {
  loading ??= (async () => {
    const local = await exists(`${LOCAL}/face_landmarker.task`)
    const fileset = await FilesetResolver.forVisionTasks(local ? `${LOCAL}/wasm` : CDN_WASM)
    const face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: local ? `${LOCAL}/face_landmarker.task` : CDN_MODELS.face, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
    })
    const hand = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: local ? `${LOCAL}/hand_landmarker.task` : CDN_MODELS.hand, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    })
    return { face, hand }
  })()
  loading.catch(() => (loading = null))
  return loading
}

/**
 * Head direction from landmark geometry: the nose tip's offset from the midpoint between the eyes,
 * relative to the face size. Plus where the irises sit within the eye openings.
 */
function isLookingAtCamera(lm: NormalizedLandmark[]): boolean {
  const leftEyeOuter = lm[33]
  const leftEyeInner = lm[133]
  const rightEyeInner = lm[362]
  const rightEyeOuter = lm[263]
  const nose = lm[1]
  const chin = lm[152]
  const forehead = lm[10]
  const eyeMidX = (leftEyeOuter.x + rightEyeOuter.x) / 2
  const eyeMidY = (leftEyeOuter.y + rightEyeOuter.y) / 2
  const faceWidth = Math.abs(rightEyeOuter.x - leftEyeOuter.x)
  const faceHeight = Math.abs(chin.y - forehead.y)
  if (faceWidth < 0.01 || faceHeight < 0.01) return false
  const yaw = (nose.x - eyeMidX) / faceWidth // about 0 when facing the camera
  const pitch = (nose.y - eyeMidY) / faceHeight // about 0.2 when facing the camera
  const headOk = Math.abs(yaw) < 0.18 && pitch > 0.08 && pitch < 0.34

  // Iris landmarks exist only in the 478-point model.
  if (lm.length < 478) return headOk
  const ratio = (iris: NormalizedLandmark, a: NormalizedLandmark, b: NormalizedLandmark) =>
    (iris.x - Math.min(a.x, b.x)) / Math.max(Math.abs(b.x - a.x), 1e-4)
  const left = ratio(lm[468], leftEyeOuter, leftEyeInner)
  const right = ratio(lm[473], rightEyeInner, rightEyeOuter)
  const gazeOk = Math.abs((left + right) / 2 - 0.5) < 0.17
  return headOk && gazeOk
}

export class VisionTracker {
  samples: VisionSample[] = []
  ready = false
  error: string | null = null
  private timer: number | undefined
  private lastWrists: { x: number; y: number }[] = []
  private lastT = 0

  async start(video: HTMLVideoElement, now: () => number, active: () => boolean = () => true) {
    try {
      const { face, hand } = await loadVision()
      this.ready = true
      this.timer = window.setInterval(() => {
        if (video.readyState < 2 || !active()) return
        const ts = performance.now()
        const t = now()
        const f = face.detectForVideo(video, ts)
        const h = hand.detectForVideo(video, ts)
        const lm = f.faceLandmarks[0]
        const wrists = h.landmarks.map((hl) => ({ x: hl[0].x, y: hl[0].y }))
        let movement = 0
        if (wrists.length && this.lastWrists.length && t > this.lastT) {
          const d = wrists.map((w) => Math.min(...this.lastWrists.map((p) => Math.hypot(w.x - p.x, w.y - p.y))))
          movement = d.reduce((a, b) => a + b, 0) / d.length / (t - this.lastT)
        }
        this.lastWrists = wrists
        this.lastT = t
        this.samples.push({
          t: Math.round(t * 100) / 100,
          face: Boolean(lm),
          eyeContact: lm ? isLookingAtCamera(lm) : false,
          handsVisible: wrists.length,
          movement: Math.round(movement * 1000) / 1000,
        })
      }, 150)
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  stop() {
    window.clearInterval(this.timer)
  }
}
