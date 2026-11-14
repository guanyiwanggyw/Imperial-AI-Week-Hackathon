// Loudness, pitch and a speaking flag from the microphone, computed locally with Web Audio (~10 Hz).
import { T } from '../thresholds'

const MIN_HZ = 75
const MAX_HZ = 400

/** Autocorrelation pitch estimate. Returns null for unvoiced or quiet frames. */
export function detectPitch(buf: Float32Array, sampleRate: number, rms: number): number | null {
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

export interface AudioFrame {
  /** performance.now() */
  at: number
  rms: number
  pitchHz: number | null
  speaking: boolean
}

export class AudioMeter {
  private ctx: AudioContext | null = null
  private timer: number | undefined
  latest: AudioFrame | null = null
  /** Latest loudness, 0 to 1, for a live level indicator. */
  level = 0
  /** performance.now() of the last frame above the speech threshold. */
  lastVoiceAt = 0
  private noiseFloor = 0.005
  private speaking = false

  start(stream: MediaStream) {
    if (this.ctx) return
    this.ctx = new AudioContext()
    const source = this.ctx.createMediaStreamSource(stream)
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const rate = this.ctx.sampleRate
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      const at = performance.now()
      // Slowly track the quietest level as the noise floor; rise very slowly, fall fast.
      this.noiseFloor = rms < this.noiseFloor ? rms * 0.5 + this.noiseFloor * 0.5 : this.noiseFloor * 0.9998 + rms * 0.0002
      const threshold = Math.max(T.voice.minSpeechRms, this.noiseFloor * T.voice.noiseMultiplier)
      if (rms > threshold) {
        this.lastVoiceAt = at
        this.speaking = true
      } else if (at - this.lastVoiceAt > T.voice.speakingHangSec * 1000) {
        this.speaking = false
      }
      this.level = Math.min(1, rms * 8)
      this.latest = { at, rms, pitchHz: detectPitch(buf, rate, rms), speaking: this.speaking }
    }, 100)
  }

  stop() {
    window.clearInterval(this.timer)
    void this.ctx?.close()
    this.ctx = null
  }
}
