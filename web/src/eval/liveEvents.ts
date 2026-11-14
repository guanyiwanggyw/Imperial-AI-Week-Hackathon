// Turns live signals into the legacy timestamped event stream (SessionEvent) that drives the audience's
// micro-expressions. The evaluation's own feedback events come from rules.ts.
import type { AudioSample, EventType, SessionEvent, VisionSample, Word } from '../types'
import { expressiveness, eyeContactShare, fillerIndices, wpmBetween } from './metrics'

const CLAIM = /\b(\d+(\.\d+)?\s?(%|percent|million|billion|bn|x)|huge|massive|everyone|everybody|always|never|the best|the first|the only|revolutionary|guaranteed?|no one else|nobody else)\b/i
const EVIDENCE = /\b(because|data|study|studies|survey|research|according|measured|tested|interviewed|pilot|trial|customers told|users told|evidence|source|signed|paying|revenue|waitlist|letters? of intent)\b/i

const COOLDOWN: Partial<Record<EventType, number>> = {
  filler_burst: 12,
  long_pause: 8,
  fast_pace: 25,
  slow_pace: 25,
  monotone_stretch: 30,
  eye_contact_lost: 15,
  eye_contact_regained: 15,
  strong_moment: 20,
  claim_without_evidence: 10,
  evidence_given: 10,
}

export class LiveEventEngine {
  events: SessionEvent[] = []
  private lastAt: Partial<Record<EventType, number>> = {}
  private seenWords = 0
  private sentence: Word[] = []
  private eyeLost = false

  private onEvent: (e: SessionEvent) => void
  constructor(onEvent: (e: SessionEvent) => void) {
    this.onEvent = onEvent
  }

  emit(type: EventType, t: number, detail?: string, force = false) {
    const cooldown = COOLDOWN[type] ?? 0
    const last = this.lastAt[type]
    if (!force && last !== undefined && t - last < cooldown) return
    this.lastAt[type] = t
    const e = { t: Math.round(t * 10) / 10, type, detail }
    this.events.push(e)
    this.onEvent(e)
  }

  /** Called about once a second during the pitch. */
  tick(t: number, words: Word[], audio: AudioSample[], vision: VisionSample[], lastVoiceAt: number) {
    // New words: fillers and claims.
    const fresh = words.slice(this.seenWords)
    this.seenWords = words.length
    if (fresh.length) {
      const recent = words.filter((w) => w.start > t - 8)
      if (fillerIndices(recent).length >= 2) this.emit('filler_burst', t, `${fillerIndices(recent).length} fillers in 8 s`)
      for (const w of fresh) {
        this.sentence.push(w)
        if (/[.!?]$/.test(w.text) || this.sentence.length > 35) {
          const text = this.sentence.map((x) => x.text).join(' ')
          if (EVIDENCE.test(text)) this.emit('evidence_given', w.end, text.slice(0, 120))
          else if (CLAIM.test(text)) this.emit('claim_without_evidence', w.end, text.slice(0, 120))
          this.sentence = []
        }
      }
    }

    // Long silence mid-pitch.
    if (t > 5 && lastVoiceAt > 0 && t - lastVoiceAt > 3) this.emit('long_pause', t, `${Math.round(t - lastVoiceAt)} s of silence`)

    // Pace over the last 20 s.
    const wpm = wpmBetween(words, t - 20, t)
    if (wpm !== null && t > 20) {
      if (wpm > 180) this.emit('fast_pace', t, `${Math.round(wpm)} wpm`)
      else if (wpm < 95) this.emit('slow_pace', t, `${Math.round(wpm)} wpm`)
    }

    // Monotone over the last 15 s.
    const expr = t > 15 ? expressiveness(audio, t - 15, t) : null
    if (expr !== null && expr < 0.25) this.emit('monotone_stretch', t, 'flat pitch for 15 s')

    // Eye contact over the last 5 s.
    const eye = eyeContactShare(vision, t - 5, t)
    if (eye !== null) {
      if (!this.eyeLost && eye < 0.3) {
        this.eyeLost = true
        this.emit('eye_contact_lost', t)
      } else if (this.eyeLost && eye > 0.7) {
        this.eyeLost = false
        this.emit('eye_contact_regained', t)
      }
    }

    // A strong stretch: good pace, no fillers, engaged, varied.
    if (t > 20 && wpm !== null && wpm >= 120 && wpm <= 170) {
      const fillers = fillerIndices(words.filter((w) => w.start > t - 15)).length
      const eye15 = eyeContactShare(vision, t - 15, t)
      if (fillers === 0 && (eye15 === null || eye15 > 0.6) && (expr === null || expr > 0.45)) this.emit('strong_moment', t)
    }
  }
}
