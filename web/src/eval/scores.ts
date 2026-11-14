// Deterministic 0–100 scores: a rolling 10 s series (one value per second) and final scores.
import type { BodyBreakdown, Phrase, SampleX, ScoreCat, SegmentNote } from './contracts'
import { SCORE_CATS } from './contracts'
import { paceScore, pitchSpread } from './metrics'
import { sustainedWpm, wpmIn } from './rules'
import { T } from './thresholds'

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const std = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

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

/**
 * Eye contact (strict): share of on-target frames among frames with a face (50% scores 20, 95% scores 100), minus
 * the longest look-away beyond 2 s (5 per second, up to 25) and darting glances (more than 10 a minute).
 */
export function eyeScore(samples: SampleX[]): number | null {
  const withFace = samples.filter((s) => s.face)
  if (withFace.length < 5 || withFace.length < samples.length * 0.3) return null
  const share = withFace.filter((s) => s.gazeOnTarget).length / withFace.length
  const lookAway = longestRun(samples, (s) => !s.gazeOnTarget)
  const minutes = Math.max((withFace[withFace.length - 1].t - withFace[0].t) / 60, 1 / 6)
  // A glance = gaze leaving the target for at least ~0.3 s.
  let glances = 0
  let offFrom: number | null = null
  for (const s of withFace) {
    if (!s.gazeOnTarget) offFrom ??= s.t
    else {
      if (offFrom !== null && s.t - offFrom >= 0.3) glances++
      offFrom = null
    }
  }
  let score = 20 + ((share - 0.5) / 0.45) * 80
  score -= lookAway > 2 ? Math.min(25, (lookAway - 2) * 5) : 0
  score -= glances / minutes > 10 ? 10 : 0
  return Math.round(clamp(score))
}

const share = (xs: SampleX[], pred: (s: SampleX) => boolean) => (xs.length ? xs.filter(pred).length / xs.length : 0)
const lerp = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1)

/**
 * Body language in six parts, after the Tübingen presentation rubric (posture, gestures, facial expression) and
 * coaches' criteria (self-touch and tics, purposeful movement instead of swaying). Each part is 0–100, or null when
 * the camera could not see enough to judge it (for example, gestures in a head-and-shoulders shot).
 */
export function bodyBreakdown(samples: SampleX[]): BodyBreakdown {
  const B = T.body
  const faces = samples.filter((s) => s.face)
  const posed = samples.filter((s) => s.bodyX !== null)
  const speaking = samples.filter((s) => s.speaking)

  // Posture: upright (no slouch), level shoulders, torso facing the panel.
  let posture: number | null = null
  if (posed.length >= 5) {
    const slouch = mean(posed.map((s) => s.slouch))
    const tilts = posed.map((s) => s.shoulderTilt).filter((x): x is number => x != null)
    const tilt = tilts.length ? mean(tilts) : 0
    const turned = share(posed.filter((s) => s.facing != null), (s) => s.facing! < B.facingMin)
    posture = 100 - Math.max(0, slouch - B.slouchBad / 2) * 150 - Math.max(0, tilt - B.tiltOk) * 6 - turned * 60
  }

  // Openness: arms not crossed, hands not hidden.
  let openness: number | null = null
  if (posed.length >= 5) {
    openness = 40 + 60 * lerp(share(posed, (s) => s.armsOpen), 0.5, 0.8) - 60 * share(posed, (s) => Boolean(s.handsHidden))
  }

  // Gestures while speaking (strict): in the natural speed band 35–65% of the time, not frantic, not one repeated
  // motion, some illustrative shapes (open palms, pointing), and hands in view while talking.
  let gestures: number | null = null
  const handsSeen = speaking.filter((s) => s.handsVisible > 0 || s.armSpan != null)
  if (speaking.length >= 5 * T.sampleHz && handsSeen.length >= speaking.length * 0.2) {
    const activeSamples = handsSeen.filter((s) => s.handSpeed >= B.handSpeedStill && s.handSpeed <= B.handSpeedBusy)
    const active = activeSamples.length / handsSeen.length
    const frantic = share(handsSeen, (s) => s.handSpeed > B.handSpeedBusy)
    const [lo, hi] = B.gestureShareGood
    let g = active < 0.15 ? 25 + (active / 0.15) * 25 : active < lo ? 50 + ((active - 0.15) / (lo - 0.15)) * 40 : active > hi ? 100 - ((active - hi) / (1 - hi)) * 40 : 100
    g -= Math.min(40, frantic * 150)
    const speeds = activeSamples.map((s) => s.handSpeed)
    if (speeds.length >= 10 && std(speeds) / Math.max(mean(speeds), 1e-3) < 0.35) g -= 10 // one repeated motion
    if (share(handsSeen, (s) => s.gesture === 'open_palm' || s.gesture === 'point') < 0.03) g -= 10 // no illustrative shapes
    if (handsSeen.length < speaking.length * 0.5) g = Math.min(g, 80) // hands mostly out of view while talking
    gestures = g
  }

  // Self-touch and fidgeting: face touches per minute, hands wringing or clasped while moving.
  let selfTouch: number | null = null
  if (faces.length >= 5) {
    const minutes = Math.max((faces[faces.length - 1].t - faces[0].t) / 60, 1 / 6)
    const touches = episodes(faces, (s) => s.faceTouch) / minutes
    const fidget = share(faces, (s) => Boolean(s.handsTogether) && s.handSpeed > B.handSpeedStill)
    selfTouch = 100 - Math.min(50, Math.max(0, touches - 0.5) * 20) - Math.min(40, fidget * 200)
  }

  // Movement: side-to-side sway (shoulder midpoint wobble within 4 s windows), in shoulder widths.
  let movement: number | null = null
  const sways: number[] = []
  for (let i = 0; i < posed.length; ) {
    const start = posed[i].t
    const win: SampleX[] = []
    while (i < posed.length && posed[i].t < start + 4) win.push(posed[i++])
    const widths = win.map((s) => s.shoulderW).filter((x): x is number => x != null && x > 0.02)
    if (win.length >= 10 && widths.length) sways.push(std(win.map((s) => s.bodyX!)) / mean(widths))
  }
  if (sways.length) movement = 100 - 70 * lerp(mean(sways), B.swayOk, B.swayBad)

  // Facial expression: some smiling and eyebrow movement, not a frozen face.
  let expression: number | null = null
  if (faces.length >= 5) {
    const brows = faces.map((s) => s.brow).filter((x): x is number => x != null)
    expression = 30 + 40 * lerp(share(faces, (s) => s.smile > 0.25), 0, 0.2) + 30 * lerp(brows.length > 1 ? std(brows) : 0, 0, 0.06)
  }

  const r = (v: number | null) => (v === null ? null : Math.round(clamp(v)))
  return { posture: r(posture), openness: r(openness), gestures: r(gestures), selfTouch: r(selfTouch), movement: r(movement), expression: r(expression) }
}

/** Body language score: weighted average of the measurable parts of bodyBreakdown. */
export function bodyScore(samples: SampleX[]): number | null {
  if (samples.filter((s) => s.face).length < 5) return null
  const b = bodyBreakdown(samples)
  let total = 0
  let weight = 0
  for (const [k, w] of Object.entries(T.body.weights) as [keyof BodyBreakdown, number][]) {
    if (b[k] === null) continue
    total += b[k]! * w
    weight += w
  }
  return weight ? Math.round(total / weight) : null
}

/** Tone: pitch variety (monotone check), and pace from the transcript when available. */
export function toneScore(samples: SampleX[], phrases: Phrase[], from: number, to: number): number | null {
  const spread = pitchSpread(samples, from, to)
  // Whole-session tone uses sustained speech only; the 10 s series windows use what they have.
  const wpm = to - from > 30 ? sustainedWpm(phrases, from, to) : wpmIn(phrases, from, to)
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
  if (words < (to - from > 30 ? T.minWords : 8)) return null
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
export function buildScoreSeries(
  samples: SampleX[],
  phrases: Phrase[],
  duration: number,
  segments: SegmentNote[] = [],
  /** Claude's overall coherency, used where no segment note covers the moment. */
  claudeCoherency: number | null = null,
): Record<ScoreCat, number[]> {
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
    // Same blend as the final score: Claude's judgement (for this stretch, else overall) plus the filler check.
    // Without any Claude judgement, coherency is unmeasured (fillers alone cannot judge it).
    const proxy = coherencyProxy(phrases, i - 30, i)
    const claude = segments.find((s) => s.coherency !== null && i >= s.from && i <= s.to)?.coherency ?? claudeCoherency
    raw.coherency.push(claude == null ? null : proxy === null ? claude : Math.round(T.claudeCoherencyShare * claude + (1 - T.claudeCoherencyShare) * proxy))
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
  /** Body-language warnings (crossed arms, fidgeting, sway, turned away, …). */
  bodyEvents?: number
}

export function computeFinalScores(i: FinalScoreInput): { scores: Record<ScoreCat | 'overall', number>; unmeasured: ScoreCat[] } {
  if (i.insufficientSpeech) return { scores: { eye: 0, body: 0, tone: 0, coherency: 0, overall: 0 }, unmeasured: [...SCORE_CATS] }
  // Eye contact matters while you speak and while you are being asked something, not while standing silent.
  const addressed = (t: number) => i.agentTurns.some((a) => t >= a.t && t <= a.end + 2)
  const engaged = i.samples.filter((s) => s.speaking || addressed(s.t))
  const eyeBase = eyeScore(engaged.length >= 5 * 7 ? engaged : i.samples)
  const eye = eyeBase === null ? null : clamp(eyeBase - Math.min(25, i.lookAwayEvents * 4))
  const bodyBase = bodyScore(i.samples)
  // Short problems average away over a long session; each warning still costs a little, like look-aways do for eye.
  const body = bodyBase === null ? null : clamp(bodyBase - Math.min(20, (i.bodyEvents ?? 0) * 3))
  const toneBase = toneScore(i.samples, i.phrases, 0, i.duration)
  const tone = toneBase === null ? null : clamp(toneBase - Math.min(20, i.monotoneEvents * 5))
  const proxy = coherencyProxy(i.phrases, 0, i.duration)
  const segScores = i.segments.map((s) => s.coherency).filter((x): x is number => x !== null)
  const claude = i.claudeCoherency ?? (segScores.length ? mean(segScores) : null)
  // Coherency is about structure and answering the question; fillers alone cannot judge it (they have their own bar).
  // Without Claude it is unmeasured.
  const coherency = claude === null ? null : proxy === null ? claude : T.claudeCoherencyShare * claude + (1 - T.claudeCoherencyShare) * proxy

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
