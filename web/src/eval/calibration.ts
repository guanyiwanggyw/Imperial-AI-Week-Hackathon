// Pre-pitch calibration. During the countdown the speaker looks at the panel and stands naturally;
// we record where "on target" is for their head and eyes, and their natural posture, so we measure
// change rather than face shape or body shape.
import type { Calibration } from './contracts'
import { EYE_LOOK_KEYS, type VisionFrame } from './signals/vision'

const MIN_FRAMES = 8

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const DEFAULT_CALIBRATION: Calibration = {
  yaw0: 0,
  pitch0: 0,
  eyeLook0: Object.fromEntries(EYE_LOOK_KEYS.map((k) => [k, 0.1])),
  headRise0: null,
  shoulderWidth0: null,
  frames: 0,
  usedDefaults: true,
}

export function headRise(frame: VisionFrame): { rise: number; width: number } | null {
  const p = frame.pose
  if (!p) return null
  const width = Math.abs(p.leftShoulder.x - p.rightShoulder.x)
  if (width < 0.02) return null
  const shoulderY = (p.leftShoulder.y + p.rightShoulder.y) / 2
  return { rise: (shoulderY - p.nose.y) / width, width }
}

export class Calibrator {
  private frames: VisionFrame[] = []
  private lastAt = 0

  /** Feed every new vision frame while calibrating. Duplicate frames are ignored. */
  add(frame: VisionFrame | null) {
    if (!frame || frame.at === this.lastAt) return
    this.lastAt = frame.at
    this.frames.push(frame)
  }

  get count() {
    return this.frames.filter((f) => f.face).length
  }

  finish(): Calibration {
    const faces = this.frames.filter((f) => f.face)
    const bodies = this.frames.map(headRise).filter((b): b is { rise: number; width: number } => b !== null)
    if (faces.length < MIN_FRAMES) return { ...DEFAULT_CALIBRATION, frames: faces.length }
    return {
      yaw0: median(faces.map((f) => f.yaw)),
      pitch0: median(faces.map((f) => f.pitch)),
      eyeLook0: Object.fromEntries(EYE_LOOK_KEYS.map((k) => [k, median(faces.map((f) => f.eyeLook[k] ?? 0))])),
      headRise0: bodies.length >= MIN_FRAMES / 2 ? median(bodies.map((b) => b.rise)) : null,
      shoulderWidth0: bodies.length >= MIN_FRAMES / 2 ? median(bodies.map((b) => b.width)) : null,
      frames: faces.length,
      usedDefaults: false,
    }
  }
}
