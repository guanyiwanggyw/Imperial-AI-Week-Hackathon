// The panel's live avatars: one Anam session per agent for the whole practice session.
// Every agent idles in its own tile while listening and speaks the lines we supply. An agent whose
// session cannot start (no Anam key, limit reached, network) falls back to its portrait and the
// browser voice on its own; the others stay live.
//
//   const avatars = new PanelAvatars()
//   avatars.warm(panel.personas, { anam })      // during the countdown
//   <Avatar avatars={avatars} persona={p} />    // one per agent; renders its live video or portrait
//   await speakAs(avatars, persona, seat, text, signal)
//
// Every line logs floorOpen → first audio (brief: target under 1 s), and becomes a live caption
// (state.lines) that reveals the words as they are spoken.
import { useSyncExternalStore } from 'react'
import type { Persona } from '../types'
import { AnamDriver, BrowserSpeechDriver, type AvatarDriver, type AvatarProvider } from './drivers'

export type AvatarStatus = 'idle' | 'connecting' | 'live' | 'fallback'

export interface SeatState {
  status: AvatarStatus
  provider: AvatarProvider | null
  error: string | null
}

export interface AvatarState {
  /** Per agent id. Missing means idle. */
  seats: Record<string, SeatState>
  /** Which agent's voice is currently audible. */
  speakingId: string | null
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

/** Element an agent's live driver adds its own <video> to. Rendered by <Avatar>. */
export const avatarSlotId = (personaId: string) => `avatar-slot-${personaId}`

const IDLE: SeatState = { status: 'idle', provider: null, error: null }

export class PanelAvatars {
  private state: AvatarState = { seats: {}, speakingId: null, lines: [] }
  private now: () => number = () => performance.now() / 1000
  private lineId = 0
  private listeners = new Set<() => void>()
  private drivers = new Map<string, AvatarDriver>()
  private warming = new Map<string, Promise<void>>()
  /** Bumped by stop(), so a connect that finishes afterwards knows it is stale. */
  private generation = 0
  readonly log: SpeechLog[] = []

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getState = () => this.state
  seat = (personaId: string): SeatState => this.state.seats[personaId] ?? IDLE

  /** Use the session clock for caption times, so they line up with the transcript. */
  setClock(now: () => number) {
    this.now = now
  }

  private set(patch: Partial<AvatarState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private setSeat(personaId: string, patch: Partial<SeatState>) {
    this.set({ seats: { ...this.state.seats, [personaId]: { ...this.seat(personaId), ...patch } } })
  }

  /**
   * Opens a live avatar for every agent, in parallel. Safe to call more than once. Never throws:
   * an agent whose session fails runs on the browser voice and its seat says so.
   * Each agent's <Avatar> must be mounted, because Anam streams into its slot.
   */
  warm(personas: Persona[], opts: { anam: boolean }): Promise<void> {
    const generation = this.generation
    return Promise.all(personas.map((p, seat) => this.warmOne(p, seat, opts, generation))).then(() => undefined)
  }

  private warmOne(persona: Persona, seat: number, opts: { anam: boolean }, generation: number): Promise<void> {
    const existing = this.warming.get(persona.id)
    if (existing) return existing
    this.setSeat(persona.id, { status: 'connecting', provider: null, error: null })
    const onSpeaking = (s: boolean) => this.setSpeaking(persona.id, s)
    const job = (async () => {
      if (opts.anam) {
        const anam = new AnamDriver(onSpeaking)
        try {
          await anam.connect(persona, avatarSlotId(persona.id))
          // stop() ran while connecting (e.g. React StrictMode remount): close, never leak a paid session.
          if (generation !== this.generation) return void anam.stop()
          this.drivers.set(persona.id, anam)
          this.setSeat(persona.id, { status: 'live', provider: 'anam' })
          return
        } catch (err) {
          console.warn(`[avatar] ${persona.id}: Anam unavailable, using the browser voice:`, err)
          void anam.stop()
          if (generation !== this.generation) return
          this.setSeat(persona.id, { error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (generation !== this.generation) return
      this.drivers.set(persona.id, new BrowserSpeechDriver(onSpeaking, seat, rateFor(persona)))
      this.setSeat(persona.id, { status: 'fallback', provider: 'browser' })
    })()
    this.warming.set(persona.id, job)
    return job
  }

  private setSpeaking(personaId: string, speaking: boolean) {
    if (speaking) this.set({ speakingId: personaId })
    else if (this.state.speakingId === personaId) this.set({ speakingId: null })
  }

  /**
   * The agent says the line through its own avatar (or voice). Waits if its session is still
   * connecting; an agent that was never warmed speaks with the browser voice.
   */
  async say(persona: Persona, seat: number, text: string, signal?: AbortSignal) {
    await this.warming.get(persona.id)
    let driver = this.drivers.get(persona.id)
    if (!driver) {
      driver = new BrowserSpeechDriver((s) => this.setSpeaking(persona.id, s), seat, rateFor(persona))
      this.drivers.set(persona.id, driver)
    }
    return this.record(persona.id, driver, text, signal)
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
      // A dropped live session should not end the turn: this agent continues on the browser voice.
      console.warn(`[avatar] ${personaId}: speech failed, retrying with the browser voice:`, err)
      const fallback = new BrowserSpeechDriver((s) => this.setSpeaking(personaId, s))
      if (this.drivers.get(personaId) === driver) {
        this.drivers.set(personaId, fallback)
        this.setSeat(personaId, { status: 'fallback', provider: 'browser', error: err instanceof Error ? err.message : String(err) })
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

  /** Stops whoever is speaking. */
  interrupt() {
    this.drivers.forEach((d) => d.interrupt())
  }

  /**
   * Ends every session. Everything is reset synchronously, before any await, so a warm() that runs
   * right after (React StrictMode remount) starts fresh sessions instead of reusing stale ones.
   */
  async stop() {
    this.generation++
    const drivers = [...this.drivers.values()]
    this.drivers.clear()
    this.warming.clear()
    this.set({ seats: {}, speakingId: null })
    drivers.forEach((d) => d.interrupt())
    await Promise.all(drivers.map((d) => d.stop()))
  }
}

/** Says a line as this agent, through its own live avatar (or its voice fallback). */
export function speakAs(avatars: PanelAvatars, persona: Persona, seat: number, text: string, signal?: AbortSignal) {
  return avatars.say(persona, seat, text, signal)
}

/** The agent who leads the panel (Persona.decisionMaker, else the first). For orchestration. */
export function decisionMaker(personas: Persona[]): Persona | undefined {
  return personas.find((p) => p.decisionMaker) ?? personas[0]
}

const rateFor = (p: Persona) => 1 - (p.strictness - 3) * 0.03

export function useAvatarState(avatars: PanelAvatars) {
  return useSyncExternalStore(avatars.subscribe, avatars.getState)
}
