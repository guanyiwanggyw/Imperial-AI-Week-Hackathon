// Loudness and pitch from the microphone, computed locally with Web Audio. ~10 samples a second.
import type { AudioSample } from '../types'

const MIN_HZ = 75
const MAX_HZ = 400

/** Autocorrelation pitch estimate. Returns null for unvoiced or quiet frames. */
function detectPitch(buf: Float32Array, sampleRate: number, rms: number): number | null {
  if (rms < 0.012) return null
  const minLag = Math.floor(sampleRate / MAX_HZ)
  const maxLag = Math.floor(sampleRate / MIN_HZ)
  let bestLag = -1
  let best = 0
  let energy = 0
  for (let i = 0; i < buf.length - maxLag; i++) energy += buf[i] * buf[i]
  if (energy === 0) return null
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < buf.length - maxLag; i++) sum += buf[i] * buf[i + lag]
    const corr = sum / energy
    if (corr > best) {
      best = corr
      bestLag = lag
    }
  }
  // Weak periodicity means noise or unvoiced speech.
  if (best < 0.5 || bestLag < 0) return null
  return sampleRate / bestLag
}

export class AudioMeter {
  private ctx: AudioContext | null = null
  private timer: number | undefined
  samples: AudioSample[] = []
  /** Latest loudness, 0 to 1, for the live level indicator. */
  level = 0
  /** Time since the last voiced frame, used to detect long pauses live. */
  lastVoiceAt = 0

  start(stream: MediaStream, now: () => number, active: () => boolean = () => true) {
    this.ctx = new AudioContext()
    const source = this.ctx.createMediaStreamSource(stream)
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const rate = this.ctx.sampleRate
    this.timer = window.setInterval(() => {
      if (!active()) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      const t = now()
      const pitchHz = detectPitch(buf, rate, rms)
      this.level = Math.min(1, rms * 8)
      if (rms > 0.015) this.lastVoiceAt = t
      this.samples.push({ t: Math.round(t * 100) / 100, rms: Math.round(rms * 10000) / 10000, pitchHz: pitchHz && Math.round(pitchHz) })
    }, 100)
  }

  stop() {
    window.clearInterval(this.timer)
    void this.ctx?.close()
    this.ctx = null
  }
}
