// Capture for one retry: the same camera and mic analysis and live transcript as a full session, on a clock that
// starts when the speaker is told to answer. Calibrates during the countdown. The video stays in this tab.
import { errorText, getJson } from '../../api'
import { Calibrator } from '../calibration'
import type { Phrase, SampleX } from '../contracts'
import { AudioMeter } from '../signals/audio'
import { SignalSampler } from '../signals/sampler'
import { VisionTracker } from '../signals/vision'
import { LiveTranscript } from '../transcript/liveTranscript'

export class RetryCapture {
  readonly vision = new VisionTracker()
  readonly audio = new AudioMeter()
  readonly sampler = new SignalSampler(this.vision, this.audio)
  readonly transcript: LiveTranscript
  private calibrator = new Calibrator()
  private calTimer: number | undefined
  private t0 = 0
  private stream: MediaStream
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  constructor(stream: MediaStream, onUpdate: () => void) {
    this.stream = stream
    this.transcript = new LiveTranscript(onUpdate)
  }

  /** Seconds since start(). */
  now = () => (this.t0 ? (performance.now() - this.t0) / 1000 : 0)

  /** Start the camera and mic analysis and record where "looking at the panel" is. */
  calibrate(video: HTMLVideoElement) {
    this.audio.start(this.stream)
    void this.vision.start(video)
    this.calTimer = window.setInterval(() => this.calibrator.add(this.vision.latest), 100)
  }

  get calibrationFrames() {
    return this.calibrator.count
  }

  /** Starts the clock, the sampler, the transcriber and the recording. Check `transcript.ready` before "go". */
  start() {
    window.clearInterval(this.calTimer)
    this.t0 = performance.now()
    this.sampler.calibration = this.calibrator.finish()
    this.sampler.start(this.now)
    this.transcript.start(this.now).catch((err) => (this.transcript.error = errorText(err)))
    try {
      const type = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
      this.recorder = new MediaRecorder(this.stream, { mimeType: type, bitsPerSecond: 1_200_000 })
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
      this.recorder.start(1000)
    } catch {
      this.recorder = null // playback of the retry is optional
    }
  }

  /** The last time (seconds) the speaker was heard: mouth-gated voice, or the end of a transcribed phrase. */
  lastSpeechAt(): number {
    const s = this.sampler.samples
    let t = 0
    for (let i = s.length - 1; i >= 0; i--)
      if (s[i].speaking) {
        t = s[i].t
        break
      }
    const p = this.transcript.phrases[this.transcript.phrases.length - 1]
    return Math.max(t, p?.end ?? 0)
  }

  /** Stops everything and waits briefly for the transcriber's last phrase. */
  async stop(): Promise<{ samples: SampleX[]; phrases: Phrase[]; end: number; video: Blob | null }> {
    const end = this.now()
    this.sampler.stop()
    this.transcript.stop()
    const video = await new Promise<Blob | null>((resolve) => {
      const r = this.recorder
      if (!r || r.state === 'inactive') return resolve(null)
      r.onstop = () => resolve(new Blob(this.chunks, { type: r.mimeType }))
      r.stop()
    })
    // The final commit arrives shortly after stop(); give it a moment.
    await new Promise((r) => window.setTimeout(r, 1200))
    this.dispose()
    return { samples: this.sampler.samples, phrases: this.transcript.phrases, end, video }
  }

  dispose() {
    window.clearInterval(this.calTimer)
    this.sampler.stop()
    this.vision.stop()
    this.audio.stop()
    if (this.recorder?.state === 'recording') this.recorder.stop()
  }
}

/**
 * The panelist asks the question out loud in their own voice (ElevenLabs through our server), falling back to the
 * browser's voice. Resolves when they finish.
 */
export async function askAloud(text: string, voiceId: string | undefined, signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch('/api/eval/retry/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId }),
      signal,
    })
    if (!res.ok) throw new Error(String(res.status))
    const url = URL.createObjectURL(await res.blob())
    const audio = new Audio(url)
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('playback'))
      signal.addEventListener('abort', () => {
        audio.pause()
        resolve()
      })
      audio.play().catch(reject)
    })
    URL.revokeObjectURL(url)
    return
  } catch {
    if (signal.aborted) return
  }
  await new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window)) return resolve()
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.onend = () => resolve()
    u.onerror = () => resolve()
    signal.addEventListener('abort', () => {
      speechSynthesis.cancel()
      resolve()
    })
    window.setTimeout(resolve, 4000 + text.length * 90)
    speechSynthesis.speak(u)
  })
}

/** Saved retries for a session. */
export const loadRetries = <T>(sessionId: string) => getJson<T[]>(`/api/eval/retry/${sessionId}`, 8000)
