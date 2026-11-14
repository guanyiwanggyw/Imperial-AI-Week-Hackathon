// Playback overlay: draws the recorded face, hand and body landmarks over the session recording, in sync with
// the video (including while paused or scrubbing). Shown only after the session, never live.
// Put it in a positioned wrapper together with the <video>; it follows the video's letterboxing.
import { useEffect, useRef, type RefObject } from 'react'
import type { LandmarkTrack, SampleX } from '../contracts'
import { drawTracking, fitBox, palette, type Layers } from '../debug/draw'
import { decodeFrame, frameAt } from '../landmarks'

interface Props {
  video: RefObject<HTMLVideoElement | null>
  track: LandmarkTrack
  /** Evaluated samples, for colour-coding (gaze, arms, face touch, slouch). */
  samples: SampleX[]
  layers: Layers
}

function sampleAt(samples: SampleX[], t: number): SampleX | null {
  if (!samples.length) return null
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const s = samples[lo]
  return Math.abs(s.t - t) < 0.5 ? s : null
}

export function LandmarkPlayback({ video, track, samples, layers }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const layersRef = useRef(layers)
  useEffect(() => {
    layersRef.current = layers
  }, [layers])

  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const colors = palette()
    let raf = 0
    let last = ''
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const v = video.current
      if (!v) return
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(v.clientWidth * dpr)
      const ch = Math.round(v.clientHeight * dpr)
      const frame = frameAt(track, v.currentTime)
      const L = layersRef.current
      const key = `${cw}x${ch}|${frame?.t ?? 'none'}|${L.face}${L.hands}${L.pose}`
      if (key === last) return
      last = key
      if (c.width !== cw || c.height !== ch) {
        c.width = cw
        c.height = ch
      }
      ctx.clearRect(0, 0, cw, ch)
      if (!frame) return
      // The recording is the raw camera image (not mirrored), the same space the landmarks were measured in.
      drawTracking(ctx, decodeFrame(track, frame), fitBox(v.videoWidth, v.videoHeight, cw, ch, 'contain'), sampleAt(samples, frame.t), L, colors)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [video, track, samples])

  return <canvas ref={canvas} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
