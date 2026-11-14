// useSignals(): the brief's Sample stream as a React hook, for screens that want signals without the
// full EvalSession (for example a dev page or a calibration preview). With `fake: true` it plays fake data.
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { SampleX } from '../contracts'
import { playFake } from '../fake'
import { AudioMeter } from './audio'
import { SignalSampler } from './sampler'
import { VisionTracker } from './vision'

export interface SignalsState {
  latest: SampleX | null
  /** All samples so far (same array, grows in place). */
  samples: SampleX[]
  ready: boolean
  error: string | null
}

export function useSignals(video: RefObject<HTMLVideoElement | null>, stream: MediaStream | null, now: () => number, opts: { fake?: boolean } = {}): SignalsState {
  const samples = useRef<SampleX[]>([]).current
  const [state, setState] = useState<SignalsState>({ latest: null, samples, ready: false, error: null })
  const nowRef = useRef(now)
  useEffect(() => {
    nowRef.current = now
  }, [now])

  useEffect(() => {
    if (opts.fake) {
      return playFake({
        onSample: (s) => {
          samples.push(s)
          setState({ latest: s, samples, ready: true, error: null })
        },
      })
    }
    if (!stream || !video.current) return
    const vision = new VisionTracker()
    const audio = new AudioMeter()
    const sampler = new SignalSampler(vision, audio)
    audio.start(stream)
    void vision.start(video.current).then(() => setState((s) => ({ ...s, ready: vision.ready, error: vision.error })))
    sampler.start(
      () => nowRef.current(),
      () => true,
      (s) => {
        samples.push(s)
        setState((prev) => ({ ...prev, latest: s }))
      },
    )
    return () => {
      sampler.stop()
      vision.stop()
      audio.stop()
    }
  }, [stream, video, opts.fake, samples])

  return state
}
