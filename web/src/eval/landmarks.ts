// Compact landmark track: what the camera saw, saved with the session so the recording can be replayed with
// the face and body tracking drawn on top. Pure (no DOM, no MediaPipe): encode in the browser, decode anywhere.
import type { LandmarkTrack, LandmarkTrackFrame } from './contracts'

type Lm = { x: number; y: number; visibility?: number }
export type Point = { x: number; y: number }
export type Accessor = (i: number) => Point | null

const q = (v: number) => Math.max(0, Math.min(999, Math.round(v * 999)))

export function emptyTrack(faceIdx: number[], poseIdx: number[]): LandmarkTrack {
  return { version: 1, faceIdx, poseIdx, frames: [] }
}

/** Quantises one frame's landmarks to integers 0–999 (x, y interleaved). Invisible pose points are -1. */
export function encodeFrame(track: LandmarkTrack, t: number, raw: { face: Lm[] | null; hands: Lm[][]; pose: Lm[] | null }): LandmarkTrackFrame {
  return {
    t: Math.round(t * 100) / 100,
    f: raw.face ? track.faceIdx.flatMap((i) => (raw.face![i] ? [q(raw.face![i].x), q(raw.face![i].y)] : [-1, -1])) : null,
    h: raw.hands.map((hand) => hand.flatMap((p) => [q(p.x), q(p.y)])),
    p: raw.pose ? track.poseIdx.flatMap((i) => (raw.pose![i] && (raw.pose![i].visibility ?? 1) > 0.5 ? [q(raw.pose![i].x), q(raw.pose![i].y)] : [-1, -1])) : null,
  }
}

/** Frame nearest to t (binary search), or null if none within `maxGap` seconds. */
export function frameAt(track: LandmarkTrack, t: number, maxGap = 0.5): LandmarkTrackFrame | null {
  const fs = track.frames
  if (!fs.length) return null
  let lo = 0
  let hi = fs.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (fs[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const best = lo > 0 && Math.abs(fs[lo - 1].t - t) < Math.abs(fs[lo].t - t) ? fs[lo - 1] : fs[lo]
  return Math.abs(best.t - t) <= maxGap ? best : null
}

function accessor(values: number[], position: Map<number, number> | null): Accessor {
  return (i) => {
    const k = position ? position.get(i) : i
    if (k === undefined) return null
    const x = values[k * 2]
    const y = values[k * 2 + 1]
    return x === undefined || x < 0 ? null : { x: x / 999, y: y / 999 }
  }
}

const positions = new WeakMap<number[], Map<number, number>>()
const positionMap = (idx: number[]) => {
  let m = positions.get(idx)
  if (!m) positions.set(idx, (m = new Map(idx.map((v, k) => [v, k]))))
  return m
}

/** Point accessors (by original MediaPipe landmark index) for drawing one recorded frame. */
export function decodeFrame(track: LandmarkTrack, f: LandmarkTrackFrame): { face: Accessor | null; hands: Accessor[]; pose: Accessor | null } {
  return {
    face: f.f ? accessor(f.f, positionMap(track.faceIdx)) : null,
    hands: f.h.map((h) => accessor(h, null)),
    pose: f.p ? accessor(f.p, positionMap(track.poseIdx)) : null,
  }
}
