// Merges the latest vision and audio frames into one calibrated Sample, ~7 times a second.
import type { AudioSample, VisionSample } from '../../types'
import type { Calibration, LandmarkTrack, SampleX } from '../contracts'
import { FACE_IDX, POSE_IDX } from '../debug/draw'
import { emptyTrack, encodeFrame } from '../landmarks'
import { DEFAULT_CALIBRATION, facingRatio, headRise } from '../calibration'
import { T } from '../thresholds'
import type { AudioMeter } from './audio'
import type { Point, VisionFrame, VisionTracker } from './vision'

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
/** Frames older than this are treated as missing (camera stalled or models still loading). */
const STALE_MS = 500

type VisionPart = Omit<SampleX, 't' | 'handSpeed' | 'pitchHz' | 'rms' | 'speaking' | 'mouthMoving' | 'micVoice' | 'jawOpen'>

const deg = (rad: number) => (rad * 180) / Math.PI

/** Pure conversion from one vision frame (or none) to the vision half of a Sample. */
export function visionToSample(frame: VisionFrame | null, cal: Calibration): VisionPart {
  if (!frame) {
    return { gazeOnTarget: false, headYaw: 0, headPitch: 0, armsOpen: true, faceTouch: false, slouch: 0, smile: 0, face: false, handsVisible: 0, bodyX: null }
  }
  const headYaw = frame.yaw - cal.yaw0
  const headPitch = frame.pitch - cal.pitch0
  // Where the eyes actually point: head angle plus eye-in-head angle, relative to looking at the target.
  const gazeYaw = frame.yaw + (frame.eyeYaw ?? 0) - (cal.gazeYaw0 ?? cal.yaw0)
  const gazePitch = frame.pitch + (frame.eyePitch ?? 0) - (cal.gazePitch0 ?? cal.pitch0)
  const gazeOnTarget =
    frame.face &&
    Math.abs(gazeYaw) < T.gaze.maxGazeYawDeg &&
    Math.abs(gazePitch) < T.gaze.maxGazePitchDeg &&
    Math.abs(headYaw) < T.gaze.maxHeadYawDeg &&
    Math.abs(headPitch) < T.gaze.maxHeadPitchDeg

  let armsOpen = true
  let slouch = 0
  let bodyX: number | null = null
  let shoulderTilt: number | null = null
  let facing: number | null = null
  let armSpan: number | null = null
  let handsTogether = false
  let handsHidden = false
  const p = frame.pose
  if (p) {
    const a = frame.aspect
    const midX = (p.leftShoulder.x + p.rightShoulder.x) / 2
    const shoulderY = (p.leftShoulder.y + p.rightShoulder.y) / 2
    const sw = Math.hypot((p.leftShoulder.x - p.rightShoulder.x) * a, p.leftShoulder.y - p.rightShoulder.y) || 0.2
    bodyX = midX
    const tilt = Math.abs(deg(Math.atan2(p.leftShoulder.y - p.rightShoulder.y, Math.abs(p.leftShoulder.x - p.rightShoulder.x) * a)))
    shoulderTilt = tilt
    const ratio = facingRatio(frame)
    if (ratio !== null && cal.facing0) facing = Math.min(1.5, ratio / cal.facing0)
    const lw = p.leftWrist
    const rw = p.rightWrist
    // Crossed: each wrist is on the opposite side of the body midline from its own shoulder, below the shoulders.
    if (lw && rw && lw.y > shoulderY && rw.y > shoulderY) {
      const leftCrossed = (lw.x - midX) * (p.leftShoulder.x - midX) < 0
      const rightCrossed = (rw.x - midX) * (p.rightShoulder.x - midX) < 0
      armsOpen = !(leftCrossed && rightCrossed)
    }
    // Both wrists: pose wrists if visible, else the hand model's two wrists.
    const pair = lw && rw ? [lw, rw] : frame.wrists.length === 2 ? frame.wrists : null
    if (pair) {
      armSpan = Math.hypot((pair[0].x - pair[1].x) * a, pair[0].y - pair[1].y) / sw
      handsTogether = armSpan < T.body.handsTogether
    }
    // Only judge hidden hands when the waist is in frame; a head-and-shoulders shot never shows them.
    handsHidden = Boolean(p.leftHip || p.rightHip) && !lw && !rw && frame.wrists.length === 0
    const hr = headRise(frame)
    if (hr && cal.headRise0) slouch = clamp01((cal.headRise0 - hr.rise) / cal.headRise0)
  }

  return {
    gazeOnTarget,
    headYaw: round(headYaw, 1),
    headPitch: round(headPitch, 1),
    gazeYaw: frame.face ? round(gazeYaw, 1) : null,
    gazePitch: frame.face ? round(gazePitch, 1) : null,
    eyeYaw: frame.eyeYaw === null ? null : round(frame.eyeYaw, 1),
    eyePitch: frame.eyePitch === null ? null : round(frame.eyePitch, 1),
    armsOpen,
    faceTouch: frame.faceTouch,
    slouch: round(slouch),
    smile: round(frame.smile),
    brow: frame.face ? round(frame.brow, 3) : null,
    face: frame.face,
    handsVisible: frame.wrists.length,
    bodyX: bodyX === null ? null : round(bodyX, 3),
    shoulderTilt: shoulderTilt === null ? null : round(shoulderTilt, 1),
    shoulderW: p ? round(Math.abs(p.leftShoulder.x - p.rightShoulder.x), 3) : null,
    facing: facing === null ? null : round(facing),
    armSpan: armSpan === null ? null : round(armSpan),
    handsTogether,
    handsHidden,
  }
}

export class SignalSampler {
  samples: SampleX[] = []
  /** Legacy shapes kept in step for the audience-reaction engine and the current report screen. */
  legacyVision: VisionSample[] = []
  legacyAudio: AudioSample[] = []
  calibration: Calibration = DEFAULT_CALIBRATION
  /** Landmarks of every analysed frame while recording, for the playback overlay. */
  landmarks: LandmarkTrack = emptyTrack(FACE_IDX, POSE_IDX)
  private timer: number | undefined
  private prevWrists: Point[] = []
  private prevAt = 0
  private handSpeed = 0
  private lastFrameAt = 0
  private jaw: { at: number; v: number }[] = []
  private lastFaceAt = -Infinity
  private vision: VisionTracker
  private audio: AudioMeter
  private agentAudible: () => boolean

  /** `agentAudible`: a panel voice is playing right now (its audio can leak into the mic). */
  constructor(vision: VisionTracker, audio: AudioMeter, agentAudible: () => boolean = () => false) {
    this.vision = vision
    this.audio = audio
    this.agentAudible = agentAudible
  }

  /**
   * Whose voice is it? The mic hears everyone in the room (and the panel through the speakers), so voice activity
   * only counts as the speaker when their mouth is moving. Without a visible face we fall back to the mic alone,
   * except while a panel voice is playing.
   */
  private mouthMoving(vf: VisionFrame | null, now: number): boolean | null {
    if (!vf?.face) {
      // Face seen recently: it is hidden or turned away, so we can't attribute the voice. Otherwise the camera is off.
      return now - this.lastFaceAt < T.voice.faceRecentSec * 1000 ? false : null
    }
    this.lastFaceAt = now
    if (vf.at !== this.jaw[this.jaw.length - 1]?.at) this.jaw.push({ at: vf.at, v: vf.jawOpen })
    while (this.jaw.length && vf.at - this.jaw[0].at > 10_000) this.jaw.shift()
    const recent = this.jaw.filter((j) => vf.at - j.at <= 1000).map((j) => j.v)
    if (recent.length < 3) return false
    const sorted = this.jaw.map((j) => j.v).sort((a, b) => a - b)
    const rest = sorted[Math.floor(sorted.length * 0.2)]
    const max = Math.max(...recent)
    return max - Math.min(...recent) > T.voice.mouthMoveMin && max - rest > T.voice.mouthOpenMin
  }

  /** `now` is the shared session clock (seconds since recording start). */
  start(now: () => number, active: () => boolean = () => true, onSample?: (s: SampleX) => void) {
    if (this.timer !== undefined) return
    this.timer = window.setInterval(() => {
      if (!active()) return
      const s = this.sample(now())
      this.samples.push(s)
      onSample?.(s)
    }, Math.round(1000 / T.sampleHz))
  }

  stop() {
    window.clearInterval(this.timer)
    this.timer = undefined
  }

  private sample(t: number): SampleX {
    const at = performance.now()
    const vf = this.vision.latest && at - this.vision.latest.at < STALE_MS ? this.vision.latest : null
    const af = this.audio.latest && at - this.audio.latest.at < STALE_MS ? this.audio.latest : null

    // Hand speed in shoulder widths per second, only for wrists in the waist-to-shoulder zone.
    let movement = 0
    if (vf && vf.at !== this.lastFrameAt) {
      this.landmarks.frames.push(encodeFrame(this.landmarks, t, vf.raw))
      const sw = vf.pose ? Math.abs(vf.pose.leftShoulder.x - vf.pose.rightShoulder.x) || 0.25 : (this.calibration.shoulderWidth0 ?? 0.25)
      const shoulderY = vf.pose ? (vf.pose.leftShoulder.y + vf.pose.rightShoulder.y) / 2 : null
      const inZone = vf.wrists.filter((w) => shoulderY === null || (w.y > shoulderY - 0.3 * sw && w.y < shoulderY + 2.5 * sw))
      const dt = (vf.at - this.prevAt) / 1000
      if (inZone.length && this.prevWrists.length && dt > 0 && dt < 1) {
        const d = inZone.map((w) => Math.min(...this.prevWrists.map((q) => Math.hypot(w.x - q.x, w.y - q.y))))
        movement = d.reduce((a, b) => a + b, 0) / d.length / dt
        this.handSpeed = 0.6 * this.handSpeed + 0.4 * (movement / sw)
      } else if (!inZone.length) {
        this.handSpeed *= 0.6
      }
      this.prevWrists = inZone
      this.prevAt = vf.at
      this.lastFrameAt = vf.at
    }

    const v = visionToSample(vf, this.calibration)
    const tt = round(t)
    const micVoice = af?.speaking ?? false
    const mouth = this.mouthMoving(vf, at)
    const speaking = micVoice && (mouth === null ? !this.agentAudible() : mouth)
    const s: SampleX = {
      t: tt,
      ...v,
      handSpeed: round(this.handSpeed, 3),
      // Pitch only counts when it is the speaker's own voice.
      pitchHz: speaking && af?.pitchHz ? Math.round(af.pitchHz) : null,
      rms: af ? round(af.rms, 4) : 0,
      speaking,
      mouthMoving: mouth ?? false,
      micVoice,
      jawOpen: vf?.face ? round(vf.jawOpen, 3) : null,
    }
    this.legacyVision.push({ t: tt, face: v.face, eyeContact: v.gazeOnTarget, handsVisible: v.handsVisible, movement: round(movement, 3) })
    this.legacyAudio.push({ t: tt, rms: s.rms, pitchHz: s.pitchHz })
    return s
  }
}
