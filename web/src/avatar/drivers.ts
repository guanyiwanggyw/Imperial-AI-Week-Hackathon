// Avatar drivers. Each one can say text and report when audio starts and ends.
//  - anam:    live Anam avatar, one session, text supplied by us (talk), Anam's own TTS voice
//  - browser: free dev fallback, browser speech synthesis (the <Avatar> shows the portrait)
// A Synthesia live driver (LiveKit, Python agent) would implement the same interface.
import { AnamEvent, createClient, MessageRole, type AnamClient } from '@anam-ai/js-sdk'
import { postJson } from '../api'
import { personaGender } from '../lib/media'
import { PORTRAIT_STYLE } from '../personas'
import type { Persona } from '../types'

export type AvatarProvider = 'anam' | 'browser'

export interface SayResult {
  /** say() called → first audio, in ms. null if speech never started. */
  latencyMs: number | null
  interrupted: boolean
}

export interface AvatarDriver {
  readonly provider: AvatarProvider
  /** Resolves when speech has finished, was interrupted, or was aborted through the signal. */
  say(text: string, signal?: AbortSignal): Promise<SayResult>
  interrupt(): void
  stop(): Promise<void>
}

/** Rough upper bound on how long a line takes to say, so a lost end event never hangs a turn. */
const maxSpeechMs = (text: string) => 6000 + text.split(/\s+/).length * 600

let videoCount = 0

export class AnamDriver implements AvatarDriver {
  readonly provider = 'anam'
  private client: AnamClient | null = null
  private video: HTMLVideoElement | null = null
  private current: { onFirst: () => void; onEnd: (interrupted: boolean) => void } | null = null

  private onSpeaking: (speaking: boolean) => void
  constructor(onSpeaking: (speaking: boolean) => void) {
    this.onSpeaking = onSpeaking
  }

  /**
   * Creates the session and streams into a video element of its own inside the slot element.
   * Owning the element means a stale session that is stopped later can never blank a newer one.
   * Throws if Anam is unavailable.
   */
  async connect(persona: Persona, slotElementId: string, timeoutMs = 20000): Promise<void> {
    const { sessionToken } = await postJson<{ sessionToken: string }>(
      '/api/avatar/anam-token',
      {
        name: persona.name,
        gender: personaGender(persona),
        // Only the appearance; the shared fal portrait style would skew the avatar match.
        look: persona.look.replace(PORTRAIT_STYLE, '').trim(),
        idleStyle: persona.idleStyle,
        expressivity: 0.3 + persona.expression.smile * 0.4,
      },
      15000,
    )
    // Our own STT listens to the user, so Anam must not open the microphone.
    const client = createClient(sessionToken, { disableInputAudio: true })
    this.client = client
    client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (e) => {
      if (e.role !== MessageRole.PERSONA || !this.current) return
      this.current.onFirst()
      if (e.endOfSpeech || e.interrupted) this.current.onEnd(e.interrupted)
    })
    client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, () => this.current?.onEnd(true))
    client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
      this.current?.onEnd(true)
      this.client = null
    })
    const slot = document.getElementById(slotElementId)
    if (!slot) throw new Error(`Avatar slot #${slotElementId} is not mounted`)
    const video = document.createElement('video')
    video.id = `anam-video-${++videoCount}`
    video.autoplay = true
    video.playsInline = true
    slot.appendChild(video)
    this.video = video
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Anam did not start in time')), timeoutMs)
      client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
        window.clearTimeout(timer)
        resolve()
      })
      client.streamToVideoElement(video.id).catch((err) => {
        window.clearTimeout(timer)
        reject(err)
      })
    })
  }

  get connected() {
    return Boolean(this.client?.isStreaming())
  }

  say(text: string, signal?: AbortSignal): Promise<SayResult> {
    const client = this.client
    if (!client) return Promise.reject(new Error('Anam is not connected'))
    this.current?.onEnd(true)
    const startedAt = performance.now()
    return new Promise<SayResult>((resolve, reject) => {
      let latencyMs: number | null = null
      let done = false
      const end = (interrupted: boolean) => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        if (this.current === handlers) this.current = null
        this.onSpeaking(false)
        resolve({ latencyMs, interrupted })
      }
      const handlers = {
        onFirst: () => {
          if (latencyMs !== null) return
          latencyMs = Math.round(performance.now() - startedAt)
          this.onSpeaking(true)
        },
        onEnd: end,
      }
      this.current = handlers
      const timer = window.setTimeout(() => end(false), maxSpeechMs(text))
      signal?.addEventListener('abort', () => {
        this.interrupt()
        end(true)
      })
      client.talk(text).catch((err) => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        this.current = null
        reject(err)
      })
    })
  }

  interrupt() {
    try {
      this.client?.interruptPersona()
    } catch {
      // not streaming
    }
  }

  async stop() {
    const client = this.client
    const video = this.video
    this.client = null
    this.video = null
    this.current?.onEnd(true)
    try {
      await client?.stopStreaming()
    } catch {
      // already closed
    }
    video?.remove()
  }
}

export class BrowserSpeechDriver implements AvatarDriver {
  readonly provider = 'browser'
  private onSpeaking: (speaking: boolean) => void
  private voiceIndex: number
  private rate: number
  constructor(onSpeaking: (speaking: boolean) => void, voiceIndex = 0, rate = 1) {
    this.onSpeaking = onSpeaking
    this.voiceIndex = voiceIndex
    this.rate = rate
  }

  say(text: string, signal?: AbortSignal): Promise<SayResult> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || signal?.aborted) return resolve({ latencyMs: null, interrupted: Boolean(signal?.aborted) })
      speechSynthesis.cancel()
      const startedAt = performance.now()
      let latencyMs: number | null = null
      let done = false
      const end = (interrupted: boolean) => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        this.onSpeaking(false)
        resolve({ latencyMs, interrupted })
      }
      const u = new SpeechSynthesisUtterance(text)
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
      if (voices.length) u.voice = voices[this.voiceIndex % voices.length]
      u.rate = this.rate
      u.onstart = () => {
        latencyMs = Math.round(performance.now() - startedAt)
        this.onSpeaking(true)
      }
      u.onend = () => end(false)
      u.onerror = () => end(true)
      const timer = window.setTimeout(() => end(false), maxSpeechMs(text))
      signal?.addEventListener('abort', () => {
        speechSynthesis.cancel()
        end(true)
      })
      speechSynthesis.speak(u)
    })
  }

  interrupt() {
    if ('speechSynthesis' in window) speechSynthesis.cancel()
  }

  async stop() {
    this.interrupt()
  }
}
