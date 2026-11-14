// The main avatar: one live session for the whole practice session.
// The decision-maker persona speaks through it; everyone else speaks through the voice fallback
// (Person 2's ElevenLabs speak() can replace that branch in speakAs()).
//
//   const avatar = new MainAvatar()
//   avatar.warm(persona)               // during the countdown; falls back to browser speech
//   <Avatar avatar={avatar} ... />     // renders the live video, or the portrait while speaking
//   await speakAs(avatar, persona, text, signal)
//
// Every line logs floorOpen → first audio (brief: target under 1 s), and becomes a live caption
// (state.lines) that reveals the words as they are spoken.
import { useSyncExternalStore } from 'react'
import type { Persona } from '../types'
import { AnamDriver, BrowserSpeechDriver, type AvatarDriver, type AvatarProvider } from './drivers'

export type AvatarStatus = 'idle' | 'connecting' | 'live' | 'fallback'

export interface AvatarState {
  status: AvatarStatus
  provider: AvatarProvider | null
  personaId: string | null
  /** Which persona's voice is currently audible (main avatar or a fallback voice). */
  speakingId: string | null
  error: string | null
  /** Panel lines for live captions, oldest first (last 30). */
  lines: CaptionLine[]
}

export interface CaptionLine {
  id: number
  personaId: string
  /** Full line */
  text: string
  /** The part already spoken; equals text once finished (unless interrupted) */
  spoken: string
  /** Session clock (see setClock) when the line was requested, and when it ended */
  t: number
  end: number | null
  done: boolean
  interrupted: boolean
}

/** Reading pace used to reveal captions when the voice does not report its progress. */
const CAPTION_WORDS_PER_SEC = 2.6

export interface SpeechLog {
  /** performance.now() when the floor opened (say was called) */
  at: number
  personaId: string
  provider: AvatarProvider
  text: string
  latencyMs: number | null
  interrupted: boolean
}

/** Element the live driver adds its own <video> to. Rendered by <Avatar>. */
export const avatarSlotId = 'main-avatar-slot'

export class MainAvatar {
  private state: AvatarState = { status: 'idle', provider: null, personaId: null, speakingId: null, error: null, lines: [] }
  private now: () => number = () => performance.now() / 1000
  private lineId = 0
  private listeners = new Set<() => void>()
  private driver: AvatarDriver | null = null
  private warming: Promise<void> | null = null
  /** Bumped by stop(), so a connect that finishes afterwards knows it is stale. */
  private generation = 0
  private fallbackVoices = new Map<string, BrowserSpeechDriver>()
  readonly log: SpeechLog[] = []

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getState = () => this.state

  /** Use the session clock for caption times, so they line up with the transcript. */
  setClock(now: () => number) {
    this.now = now
  }

  private set(patch: Partial<AvatarState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  /**
   * Opens the live avatar for this persona. Safe to call more than once. Never throws: if Anam is
   * not configured or fails, the avatar runs on the browser voice and the status says so.
   * The <Avatar> component must be mounted, because Anam streams into its video element.
   */
  warm(persona: Persona, opts: { anam: boolean }): Promise<void> {
    if (this.warming && this.state.personaId === persona.id) return this.warming
    this.set({ status: 'connecting', personaId: persona.id, error: null })
    const onSpeaking = (s: boolean) => this.setSpeaking(persona.id, s)
    const generation = ++this.generation
    this.warming = (async () => {
      if (opts.anam) {
        const anam = new AnamDriver(onSpeaking)
        try {
          await anam.connect(persona, avatarSlotId)
          // stop() ran while connecting (e.g. React StrictMode remount): close, never leak a paid session.
          if (generation !== this.generation) return void anam.stop()
          this.driver = anam
          this.set({ status: 'live', provider: 'anam' })
          return
        } catch (err) {
          console.warn('[avatar] Anam unavailable, using the browser voice:', err)
          void anam.stop()
          if (generation !== this.generation) return
          this.set({ error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (generation !== this.generation) return
      this.driver = new BrowserSpeechDriver(onSpeaking, 0, rateFor(persona))
      this.set({ status: 'fallback', provider: 'browser' })
    })()
    return this.warming
  }

  private setSpeaking(personaId: string, speaking: boolean) {
    if (speaking) this.set({ speakingId: personaId })
    else if (this.state.speakingId === personaId) this.set({ speakingId: null })
  }

  /** The main avatar says the line. Waits for warm() if it is still connecting. */
  async say(text: string, signal?: AbortSignal) {
    if (this.warming) await this.warming
    const persona = this.state.personaId
    if (!this.driver || !persona) throw new Error('The avatar has not been started')
    return this.record(persona, this.driver, text, signal)
  }

  /** A panelist without the avatar speaks with a fallback voice. */
  sayAsVoice(persona: Persona, seat: number, text: string, signal?: AbortSignal) {
    let voice = this.fallbackVoices.get(persona.id)
    if (!voice) {
      voice = new BrowserSpeechDriver((s) => this.setSpeaking(persona.id, s), seat + 1, rateFor(persona))
      this.fallbackVoices.set(persona.id, voice)
    }
    return this.record(persona.id, voice, text, signal)
  }

  private updateLine(id: number, patch: Partial<CaptionLine>) {
    this.set({ lines: this.state.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  }

  private async record(personaId: string, driver: AvatarDriver, text: string, signal?: AbortSignal) {
    const at = performance.now()
    const id = ++this.lineId
    this.set({ lines: [...this.state.lines.slice(-29), { id, personaId, text, spoken: '', t: this.now(), end: null, done: false, interrupted: false }] })
    // Reveal the caption with the audio: the provider's own progress where it reports it,
    // otherwise an estimate at speaking pace from the first audio. Never ahead of the full line.
    const words = text.split(/\s+/).filter(Boolean)
    let reported = ''
    let audioAt: number | null = null
    const reveal = window.setInterval(() => {
      if (audioAt === null && this.state.speakingId === personaId) audioAt = performance.now()
      if (audioAt === null) return
      const estimated = Math.floor(((performance.now() - audioAt) / 1000) * CAPTION_WORDS_PER_SEC)
      const shown = Math.min(words.length - 1, Math.max(estimated, reported.split(/\s+/).filter(Boolean).length))
      const spoken = words.slice(0, shown).join(' ')
      if (spoken !== this.state.lines.find((l) => l.id === id)?.spoken) this.updateLine(id, { spoken })
    }, 120)
    const onProgress = (s: string) => (reported = s)
    let result
    try {
      result = await driver.say(text, signal, onProgress)
    } catch (err) {
      // A dropped live session should not end the turn: say it with the browser voice instead.
      console.warn('[avatar] speech failed, retrying with the browser voice:', err)
      const fallback = new BrowserSpeechDriver((s) => this.setSpeaking(personaId, s))
      if (driver === this.driver) {
        this.driver = fallback
        this.set({ status: 'fallback', provider: 'browser', error: err instanceof Error ? err.message : String(err) })
      }
      driver = fallback
      result = await fallback.say(text, signal, onProgress)
    } finally {
      window.clearInterval(reveal)
    }
    const line = this.state.lines.find((l) => l.id === id)
    this.updateLine(id, {
      done: true,
      end: this.now(),
      interrupted: result.interrupted,
      spoken: result.interrupted ? (line?.spoken ?? '') : text,
    })
    const entry: SpeechLog = { at, personaId, provider: driver.provider, text, ...result }
    this.log.push(entry)
    console.info(`[avatar] ${personaId} via ${entry.provider}: floorOpen→firstAudio ${entry.latencyMs ?? '–'} ms${entry.interrupted ? ' (interrupted)' : ''}`)
    return entry
  }

  interrupt() {
    this.driver?.interrupt()
    this.fallbackVoices.forEach((v) => v.interrupt())
  }

  /**
   * Ends the session. Everything is reset synchronously, before any await, so a warm() that runs
   * right after (React StrictMode remount) starts a fresh session instead of reusing a stale one.
   */
  async stop() {
    this.generation++
    const driver = this.driver
    this.driver = null
    this.warming = null
    this.fallbackVoices.forEach((v) => v.interrupt())
    this.set({ status: 'idle', provider: null, speakingId: null })
    driver?.interrupt()
    await driver?.stop()
  }
}

/** Routes a line to the main avatar if this persona is the decision-maker, otherwise to a voice. */
export function speakAs(avatar: MainAvatar, persona: Persona, seat: number, text: string, signal?: AbortSignal) {
  return avatar.getState().personaId === persona.id ? avatar.say(text, signal) : avatar.sayAsVoice(persona, seat, text, signal)
}

/** The persona who speaks through the live avatar: the one marked decisionMaker, else the first. */
export function decisionMaker(personas: Persona[]): Persona | undefined {
  return personas.find((p) => p.decisionMaker) ?? personas[0]
}

const rateFor = (p: Persona) => 1 - (p.strictness - 3) * 0.03

export function useAvatarState(avatar: MainAvatar) {
  return useSyncExternalStore(avatar.subscribe, avatar.getState)
}
