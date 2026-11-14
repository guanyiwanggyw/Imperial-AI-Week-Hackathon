// Deterministic 0–100 scores: a rolling 10 s series (one value per second) and final scores.
import type { Phrase, SampleX, ScoreCat, SegmentNote } from './contracts'
import { SCORE_CATS } from './contracts'
import { paceScore, pitchSpread } from './metrics'
import { wpmIn } from './rules'
import { T } from './thresholds'

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Longest continuous run (seconds) where `pred` holds. */
function longestRun(samples: SampleX[], pred: (s: SampleX) => boolean): number {
  let best = 0
  let start: number | null = null
  for (const s of samples) {
    if (pred(s)) {
      start ??= s.t
      best = Math.max(best, s.t - start)
    } else start = null
  }
  return best
}

/** Distinct episodes where `pred` holds: flicker within `gapSec` of the previous episode counts as the same one. */
function episodes(samples: SampleX[], pred: (s: SampleX) => boolean, gapSec = 3): number {
  let n = 0
  let lastT = -Infinity
  for (const s of samples) {
    if (!pred(s)) continue
    if (s.t - lastT > gapSec) n++
    lastT = s.t
  }
  return n
}

// ---------- per-category scores over a set of samples / phrases ----------

/** Eye contact: share of on-target frames among frames with a face, minus long look-aways. */
export function eyeScore(samples: SampleX[]): number | null {
  const withFace = samples.filter((s) => s.face)
  if (withFace.length < 5 || withFace.length < samples.length * 0.3) return null
  const share = withFace.filter((s) => s.gazeOnTarget).length / withFace.length
  const lookAway = longestRun(samples, (s) => !s.gazeOnTarget)
  return Math.round(clamp(20 + ((share - 0.3) / 0.6) * 80 - (lookAway > T.rules.lookAwaySec ? Math.min(20, (lookAway - T.rules.lookAwaySec) * 4) : 0)))
}

/** Body: open posture, few face touches, no slouch, natural gestures, a little smiling. */
export function bodyScore(samples: SampleX[]): number | null {
  const present = samples.filter((s) => s.face)
  if (present.length < 5) return null
  const openShare = present.filter((s) => s.armsOpen).length / present.length
  const minutes = Math.max((present[present.length - 1].t - present[0].t) / 60, 1 / 6)
  const touchesPerMin = episodes(present, (s) => s.faceTouch) / minutes
  const slouch = mean(present.map((s) => s.slouch))
  const speaking = present.filter((s) => s.speaking)
  const hand = speaking.length ? mean(speaking.map((s) => s.handSpeed)) : null
  const smile = mean(present.map((s) => s.smile))
  let score = 40 + 60 * clamp((openShare - 0.5) / 0.3, 0, 1)
  score -= Math.min(30, Math.max(0, touchesPerMin - 1) * 10)
  score -= slouch > T.body.slouchBad ? (slouch - T.body.slouchBad) * 100 : 0
  if (hand !== null) score -= hand < T.body.handSpeedStill ? 10 : hand > T.body.handSpeedBusy ? 15 : 0
  if (smile > 0.3) score += 5
  return Math.round(clamp(score))
}

/** Tone: pitch variety (monotone check), and pace from the transcript when available. */
export function toneScore(samples: SampleX[], phrases: Phrase[], from: number, to: number): number | null {
  const spread = pitchSpread(samples, from, to)
  const wpm = wpmIn(phrases, from, to)
  if (spread === null && wpm === null) return null
  const spreadScore = spread === null ? null : clamp(((spread - 1) / (T.voice.expressiveSemitones - 1)) * 100)
  const pace = wpm === null ? null : paceScore(wpm)
  if (spreadScore === null) return Math.round(pace!)
  if (pace === null) return Math.round(spreadScore)
  return Math.round(0.6 * spreadScore + 0.4 * pace)
}

/** Live coherency proxy: fillers per minute and mid-sentence hesitations. Claude refines it later. */
export function coherencyProxy(phrases: Phrase[], from: number, to: number): number | null {
  const inWin = phrases.filter((p) => p.end > from && p.t < to)
  const words = inWin.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0)
  if (words < 8) return null
  const minutes = Math.max((to - from) / 60, 0.25)
  const fillers = inWin.reduce((n, p) => n + p.fillers.filter((f) => f >= from && f < to).length, 0)
  const perMin = fillers / minutes
  let hesitations = 0
  for (let i = 1; i < inWin.length; i++) {
    const gap = inWin[i].t - inWin[i - 1].end
    if (gap > 1.5 && gap < 6 && !/[.!?]$/.test(inWin[i - 1].text.trim())) hesitations++
  }
  return Math.round(clamp(100 - Math.max(0, perMin - T.fillers.perMinuteGood) * 8 - (hesitations / minutes) * 6))
}

// ---------- series ----------

/** Replaces nulls with the previous value (leading nulls with the first value; all-null with 50). */
function fill(xs: (number | null)[]): number[] {
  const first = xs.find((x) => x !== null) ?? 50
  let prev = first
  return xs.map((x) => (x === null ? prev : (prev = x)))
}

/** Rolling score per second. Index i covers the 10 s ending at i (coherency uses 30 s to stay stable). */
export function buildScoreSeries(samples: SampleX[], phrases: Phrase[], duration: number, segments: SegmentNote[] = []): Record<ScoreCat, number[]> {
  const n = Math.max(1, Math.ceil(duration))
  const raw: Record<ScoreCat, (number | null)[]> = { eye: [], body: [], tone: [], coherency: [] }
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    const from = i - 10
    while (lo < samples.length && samples[lo].t < from) lo++
    while (hi < samples.length && samples[hi].t <= i) hi++
    const win = samples.slice(lo, hi)
    raw.eye.push(eyeScore(win))
    raw.body.push(bodyScore(win))
    raw.tone.push(toneScore(win, phrases, from, i))
    const proxy = coherencyProxy(phrases, i - 30, i)
    const seg = segments.find((s) => s.coherency !== null && i >= s.from && i <= s.to)
    raw.coherency.push(proxy === null ? (seg?.coherency ?? null) : seg?.coherency != null ? Math.round(0.5 * proxy + 0.5 * seg.coherency) : proxy)
  }
  return { eye: fill(raw.eye), body: fill(raw.body), tone: fill(raw.tone), coherency: fill(raw.coherency) }
}

// ---------- final ----------

export interface FinalScoreInput {
  samples: SampleX[]
  phrases: Phrase[]
  duration: number
  segments: SegmentNote[]
  /** Claude's final coherency score (0–100), if the final judge ran. */
  claudeCoherency: number | null
  timingScore: number | null
  /** Panel turns: eye contact counts while the speaker talks or is being addressed. */
  agentTurns: { t: number; end: number }[]
  /** Too little of the speaker's own speech: everything is unmeasured. */
  insufficientSpeech: boolean
  /** Number of look-away events longer than the rule threshold. */
  lookAwayEvents: number
  monotoneEvents: number
}

export function computeFinalScores(i: FinalScoreInput): { scores: Record<ScoreCat | 'overall', number>; unmeasured: ScoreCat[] } {
  if (i.insufficientSpeech) return { scores: { eye: 0, body: 0, tone: 0, coherency: 0, overall: 0 }, unmeasured: [...SCORE_CATS] }
  // Eye contact matters while you speak and while you are being asked something, not while standing silent.
  const addressed = (t: number) => i.agentTurns.some((a) => t >= a.t && t <= a.end + 2)
  const engaged = i.samples.filter((s) => s.speaking || addressed(s.t))
  const eyeBase = eyeScore(engaged.length >= 5 * 7 ? engaged : i.samples)
  const eye = eyeBase === null ? null : clamp(eyeBase - Math.min(20, i.lookAwayEvents * 2))
  const body = bodyScore(i.samples)
  const toneBase = toneScore(i.samples, i.phrases, 0, i.duration)
  const tone = toneBase === null ? null : clamp(toneBase - Math.min(20, i.monotoneEvents * 5))
  const proxy = coherencyProxy(i.phrases, 0, i.duration)
  const segScores = i.segments.map((s) => s.coherency).filter((x): x is number => x !== null)
  const claude = i.claudeCoherency ?? (segScores.length ? mean(segScores) : null)
  const coherency = claude === null ? proxy : proxy === null ? claude : T.claudeCoherencyShare * claude + (1 - T.claudeCoherencyShare) * proxy

  const parts: Record<ScoreCat, number | null> = { eye, body, tone, coherency }
  const unmeasured = SCORE_CATS.filter((c) => parts[c] === null)
  const w = T.overallWeights
  let total = i.timingScore === null ? 0 : w.timing * i.timingScore
  let weight = i.timingScore === null ? 0 : w.timing
  for (const c of SCORE_CATS) {
    if (parts[c] === null) continue
    total += w[c] * parts[c]!
    weight += w[c]
  }
  const scores = {
    eye: Math.round(eye ?? 0),
    body: Math.round(body ?? 0),
    tone: Math.round(tone ?? 0),
    coherency: Math.round(coherency ?? 0),
    overall: weight > 0 ? Math.round(total / weight) : 0,
  }
  return { scores, unmeasured }
}
