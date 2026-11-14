// Live rule engine: deterministic FeedbackEvents during the session. Shown only in playback.
// Feed onSample() with every Sample and tick() about once a second.
import type { FeedbackCat, FeedbackEvent, Phrase, RoomState, SampleX, Severity } from './contracts'
import { pitchSpread } from './metrics'
import { T } from './thresholds'

const RANK: Record<Severity, number> = { good: 0, warn: 1, bad: 2 }
const r1 = (n: number) => Math.round(n * 10) / 10
const fmt = (sec: number) => `${r1(sec)}s`

type Draft = Omit<FeedbackEvent, 'source'>

/** What kind of problem an event is: same category and same opening words ("Arms crossed…", "Swaying…"). */
const kindOf = (e: FeedbackEvent) => `${e.cat}:${e.msg.split(/\s+/).slice(0, 2).join(' ').replace(/[^a-z ]/gi, '').toLowerCase()}`

/**
 * Adds an event, merging it into the previous event of the same kind if they overlap or are close
 * (so one long look-away stays one marker, but arms crossed and turned away stay separate).
 */
export function mergeInto(events: FeedbackEvent[], ev: FeedbackEvent, gap = T.rules.minGapSec): { event: FeedbackEvent; merged: boolean } {
  const kind = kindOf(ev)
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if ((e.end ?? e.t) < ev.t - gap - 30) break
    const samePolarity = (e.severity === 'good') === (ev.severity === 'good')
    if (e.source !== ev.source || !samePolarity || kindOf(e) !== kind) continue
    if ((e.end ?? e.t) >= ev.t - gap) {
      e.end = Math.max(e.end ?? e.t, ev.end ?? ev.t)
      if (RANK[ev.severity] > RANK[e.severity]) {
        e.severity = ev.severity
        e.msg = ev.msg
      }
      return { event: e, merged: true }
    }
  }
  events.push(ev)
  return { event: ev, merged: false }
}

/**
 * Speaking rate (words per minute) over phrases inside [from, to]. Counts the short pauses between phrases (under 2 s)
 * as speaking time, like the usual 130–160 wpm targets do, but not long gaps or turns. Null with fewer than `minWords`.
 */
export function wpmIn(phrases: Phrase[], from: number, to: number, minWords = 12): number | null {
  const inWin = phrases.filter((p) => p.t >= from && p.end <= to)
  const words = inWin.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0)
  let talk = inWin.reduce((s, p) => s + (p.end - p.t), 0)
  for (let i = 1; i < inWin.length; i++) {
    const gap = inWin[i].t - inWin[i - 1].end
    if (gap > 0 && gap < 2) talk += gap
  }
  if (words < minWords || talk < 5) return null
  return (words / talk) * 60
}

/**
 * Pace over sustained speech only: runs of phrases joined by gaps under 2 s that last at least `minRunSec`.
 * Short bursts and exclamations are always fast and say nothing about pitch pace. Null below `minTotalSec` of runs.
 */
export function sustainedWpm(phrases: Phrase[], from: number, to: number, minRunSec = 8, minTotalSec = 15): number | null {
  const inWin = phrases.filter((p) => p.t >= from && p.end <= to)
  let words = 0
  let talk = 0
  let run: Phrase[] = []
  const flush = () => {
    if (run.length && run[run.length - 1].end - run[0].t >= minRunSec) {
      words += run.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0)
      talk += run[run.length - 1].end - run[0].t
    }
    run = []
  }
  for (const p of inWin) {
    if (run.length && p.t - run[run.length - 1].end >= 2) flush()
    run.push(p)
  }
  flush()
  return talk >= minTotalSec ? (words / talk) * 60 : null
}

export class RuleEngine {
  events: FeedbackEvent[] = []
  private streakStart: Record<string, number | null> = {}
  private open: Record<string, FeedbackEvent | null> = {}
  private lastAt: Record<string, number> = {}
  private lastFaceT = -Infinity
  private prevTouch = false
  private touchHeld = 0
  private flaggedMonologueStart: number | null = null
  private recent: SampleX[] = []
  private onEvent?: (e: FeedbackEvent) => void

  constructor(onEvent?: (e: FeedbackEvent) => void) {
    this.onEvent = onEvent
  }

  add(d: Draft, source: FeedbackEvent['source'] = 'rule'): FeedbackEvent {
    const { event, merged } = mergeInto(this.events, { ...d, t: r1(d.t), end: d.end === undefined ? undefined : r1(d.end), source })
    if (!merged) this.onEvent?.(event)
    return event
  }

  private cooled(key: string, t: number, sec: number) {
    if (t - (this.lastAt[key] ?? -Infinity) < sec) return false
    this.lastAt[key] = t
    return true
  }

  /** A condition that must hold continuously for `minSec` before it becomes an event; the event grows until it ends. */
  private streak(key: string, active: boolean, t: number, minSec: number, build: (dur: number) => { cat: FeedbackCat; severity: Severity; msg: string }) {
    if (!active) {
      this.streakStart[key] = null
      this.open[key] = null
      return
    }
    const start = (this.streakStart[key] ??= t)
    const dur = t - start
    if (dur < minSec) return
    const b = build(dur)
    const ev = this.open[key]
    if (!ev) {
      this.open[key] = this.add({ t: start, end: t, ...b })
    } else {
      ev.end = r1(t)
      if (RANK[b.severity] >= RANK[ev.severity]) {
        ev.severity = b.severity
        ev.msg = b.msg
      }
    }
  }

  onSample(s: SampleX) {
    const t = s.t
    this.recent.push(s)
    if (this.recent.length > T.sampleHz * 40) this.recent.splice(0, this.recent.length - T.sampleHz * 40)
    if (s.face) this.lastFaceT = t
    // A missing face counts as looking away only if we saw a face recently (otherwise the camera is off).
    const away = s.face ? !s.gazeOnTarget : t - this.lastFaceT < 10
    this.streak('lookaway', away, t, T.rules.lookAwaySec, (dur) => ({
      cat: 'eye',
      severity: dur >= T.rules.lookAwayBadSec ? 'bad' : 'warn',
      msg: `You looked away for ${fmt(dur)}`,
    }))
    this.streak('arms', s.face && !s.armsOpen, t, T.rules.armsCrossedSec, (dur) => ({ cat: 'body', severity: 'warn', msg: `Arms crossed for ${fmt(dur)}` }))
    this.streak('slouch', s.slouch > T.body.slouchBad, t, T.rules.slouchSec, (dur) => ({ cat: 'body', severity: 'warn', msg: `Slouching for ${fmt(dur)}` }))
    this.streak('tilt', (s.shoulderTilt ?? 0) > T.body.tiltBad, t, T.rules.tiltSec, (dur) => ({ cat: 'body', severity: 'warn', msg: `Shoulders tilted for ${fmt(dur)}. Stand evenly on both feet.` }))
    this.streak('turned', s.facing != null && s.facing < T.body.facingMin, t, T.rules.turnedAwaySec, (dur) => ({ cat: 'body', severity: 'warn', msg: `Body turned away from the panel for ${fmt(dur)}` }))
    this.streak('hidden', Boolean(s.handsHidden), t, T.rules.handsHiddenSec, (dur) => ({ cat: 'body', severity: 'warn', msg: `Hands out of sight for ${fmt(dur)}` }))
    this.streak('fidget', Boolean(s.handsTogether) && s.handSpeed > T.body.handSpeedStill, t, T.rules.fidgetSec, (dur) => ({ cat: 'body', severity: 'warn', msg: `Fidgeting with your hands for ${fmt(dur)}` }))

    this.touchHeld = s.faceTouch ? this.touchHeld + 1 : 0
    if (this.touchHeld === 2 && !this.prevTouch && this.cooled('touch', t, T.rules.minGapSec)) {
      this.add({ t: t - 0.3, cat: 'body', severity: 'warn', msg: 'Touched your face' })
    }
    this.prevTouch = this.touchHeld >= 2
  }

  /** About once a second. */
  tick(t: number, room: RoomState, phrases: Phrase[]) {
    if (room.fillersLast10s >= T.rules.fillersIn10s && this.cooled('fillers', t, 10)) {
      const times = phrases.flatMap((p) => p.fillers).filter((f) => f > t - 10)
      this.add({ t: times[0] ?? t - 10, end: times[times.length - 1] ?? t, cat: 'coherency', severity: 'warn', msg: `${room.fillersLast10s} filler words in 10s` })
    }

    const w = T.rules.monotoneWindowSec
    if (t > w && this.cooled('tone-check', t, 5)) {
      const spread = pitchSpread(this.recent, t - w, t)
      if (spread !== null && spread < T.voice.monotoneSemitones && this.cooled('monotone', t, w)) {
        // Narrow the event to the flat 5 s blocks inside the window.
        const flat: number[] = []
        for (let b = t - w; b < t; b += 5) {
          const s = pitchSpread(this.recent, b, b + 5)
          if (s !== null && s < T.voice.monotoneSemitones * 1.3) flat.push(b)
        }
        const from = flat.length ? flat[0] : t - w
        const to = flat.length ? Math.min(t, flat[flat.length - 1] + 5) : t
        this.add({ t: from, end: to, cat: 'tone', severity: 'warn', msg: `Flat pitch for ${Math.round(to - from)}s (${spread.toFixed(1)} semitones of variation)` })
      } else if (spread !== null && spread > T.voice.expressiveSemitones && this.cooled('expressive', t, 45)) {
        this.add({ t: t - w, end: t, cat: 'tone', severity: 'good', msg: 'Lively, varied voice' })
      }
    }

    const wpm = wpmIn(phrases, t - 20, t)
    if (wpm !== null && (wpm > T.voice.paceFast || wpm < T.voice.paceSlow) && this.cooled('pace', t, 20)) {
      this.add({ t: t - 20, end: t, cat: 'tone', severity: 'warn', msg: `${wpm > T.voice.paceFast ? 'Fast' : 'Slow'} pace: ${Math.round(wpm)} words per minute` })
    }

    if (room.monologueSec > T.rules.monologueSec) {
      const start = t - room.monologueSec
      if (this.flaggedMonologueStart === null || Math.abs(start - this.flaggedMonologueStart) > 5) {
        this.flaggedMonologueStart = start
        this.add({ t, cat: 'timing', severity: 'warn', msg: `Talking for ${Math.round(room.monologueSec)}s without a break. Pause and check in.` })
      }
    }

    // Sway: shoulder midpoint wobbling side to side over the last 6 s.
    const posed = this.recent.filter((s) => s.t > t - 6 && s.bodyX != null && s.shoulderW)
    if (posed.length >= T.sampleHz * 4) {
      const xs = posed.map((s) => s.bodyX!)
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      const sway = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length) / (posed.reduce((a, s) => a + s.shoulderW!, 0) / posed.length)
      if (sway > T.body.swayBad && this.cooled('sway', t, 20)) this.add({ t: t - 6, end: t, cat: 'body', severity: 'warn', msg: 'Swaying side to side. Plant your feet.' })
    }

    // Gestures while speaking (last 30 s, hands in view): still the whole time, or natural.
    const talk = this.recent.filter((s) => s.t > t - T.rules.stillHandsSec && s.speaking && (s.handsVisible > 0 || s.armSpan != null))
    if (talk.length >= T.sampleHz * 15) {
      const active = talk.filter((s) => s.handSpeed >= T.body.handSpeedStill && s.handSpeed <= T.body.handSpeedBusy).length / talk.length
      const [lo, hi] = T.body.gestureShareGood
      if (active < 0.05 && this.cooled('still-hands', t, 45)) this.add({ t: talk[0].t, end: t, cat: 'body', severity: 'warn', msg: 'Hands still while talking. Use them to illustrate your points.' })
      else if (active >= lo && active <= hi && this.cooled('good-gestures', t, 45)) this.add({ t: talk[0].t, end: t, cat: 'body', severity: 'good', msg: 'Natural, purposeful gestures' })
    }

    const speakingEye = this.recent.filter((s) => s.t > t - 20 && s.speaking && s.face)
    if (speakingEye.length > T.sampleHz * 8) {
      const share = speakingEye.filter((s) => s.gazeOnTarget).length / speakingEye.length
      // Start after the last look-away in the window, so a good stretch never overlaps a bad one.
      const lastAway = this.recent.filter((s) => s.t > t - 20 && !s.gazeOnTarget).reduce((m, s) => Math.max(m, s.t), -Infinity)
      const start = Math.max(speakingEye[0].t, lastAway > t - 20 ? lastAway : -Infinity, 0)
      if (share >= 0.9 && t - start >= 8 && this.cooled('good-eye', t, 40)) this.add({ t: start, end: t, cat: 'eye', severity: 'good', msg: 'Steady eye contact while speaking' })
    }
  }

  /** Closes open streak events. Call once at the end. */
  finish() {
    for (const k of Object.keys(this.open)) this.open[k] = null
    this.events.sort((a, b) => a.t - b.t)
  }
}
