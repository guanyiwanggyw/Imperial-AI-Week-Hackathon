// Delivery analysis. Pure functions over words, audio samples and vision samples,
// used live on the session screen and again (on the accurate transcript) for the report.
import type { AudioSample, DeliveryScore, SessionData, VisionSample, Word } from '../types'

/** How much content weighs against delivery in the overall score. Delivery gets 1 - CONTENT_WEIGHT. */
export const CONTENT_WEIGHT = 0.65

const SINGLE_FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'uhm', 'hmm', 'mm', 'umm', 'uhh'])
const PHRASE_FILLERS = [
  ['you', 'know'],
  ['i', 'mean'],
  ['sort', 'of'],
  ['kind', 'of'],
]
const SOFT_FILLERS = new Set(['basically', 'literally'])

export const clean = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '')
export const clamp = (n: number, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, n))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const std = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

/** Indices of words that are fillers. Phrase fillers mark the first word only. */
export function fillerIndices(words: Word[]): number[] {
  const out: number[] = []
  for (let i = 0; i < words.length; i++) {
    const w = clean(words[i].text)
    if (SINGLE_FILLERS.has(w) || SOFT_FILLERS.has(w)) {
      out.push(i)
      continue
    }
    const next = clean(words[i + 1]?.text ?? '')
    if (PHRASE_FILLERS.some(([a, b]) => a === w && b === next)) out.push(i)
  }
  return out
}

export interface Pause {
  start: number
  end: number
  kind: 'deliberate' | 'hesitation'
}

/** Gaps between words of at least `min` seconds. Deliberate if it follows a sentence end or a slide change. */
export function findPauses(words: Word[], slideTimes: number[], min = 0.8): Pause[] {
  const fillers = new Set(fillerIndices(words))
  const pauses: Pause[] = []
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end
    if (gap < min) continue
    const afterSentence = /[.!?:]$/.test(words[i - 1].text.trim())
    const nearSlide = slideTimes.some((t) => t >= words[i - 1].end - 0.5 && t <= words[i].start + 0.5)
    const nearFiller = fillers.has(i - 1) || fillers.has(i)
    const deliberate = (afterSentence || nearSlide) && !nearFiller && gap < 4
    pauses.push({ start: words[i - 1].end, end: words[i].start, kind: deliberate ? 'deliberate' : 'hesitation' })
  }
  return pauses
}

/** Words per minute in a trailing window, counting only time spent talking or in short gaps. */
export function wpmBetween(words: Word[], from: number, to: number): number | null {
  const inWindow = words.filter((w) => w.start >= from && w.end <= to)
  if (inWindow.length < 4) return null
  const span = Math.max(inWindow[inWindow.length - 1].end - inWindow[0].start, 1)
  return (inWindow.length / span) * 60
}

export interface WindowPoint {
  t: number // window start
  value: number | null
}

/** Splits [0, end] into windows and computes a value per window. */
export function windows(end: number, size: number, fn: (from: number, to: number) => number | null): WindowPoint[] {
  const out: WindowPoint[] = []
  for (let t = 0; t < end; t += size) out.push({ t, value: fn(t, Math.min(t + size, end)) })
  return out
}

const semitones = (hz: number) => 12 * Math.log2(hz / 100)

/** Pitch spread in semitones among voiced samples. Null if too little voice to judge. */
export function pitchSpread(audio: AudioSample[], from: number, to: number): number | null {
  const voiced = audio.filter((a) => a.t >= from && a.t < to && a.pitchHz !== null).map((a) => semitones(a.pitchHz!))
  if (voiced.length < 15) return null
  // Trim the outer 10 % to ignore octave errors from the pitch tracker.
  voiced.sort((a, b) => a - b)
  const cut = Math.floor(voiced.length * 0.1)
  return std(voiced.slice(cut, voiced.length - cut))
}

/** 0 (monotone) to 1 (expressive), from pitch spread and loudness variation. */
export function expressiveness(audio: AudioSample[], from: number, to: number): number | null {
  const spread = pitchSpread(audio, from, to)
  if (spread === null) return null
  const loud = audio.filter((a) => a.t >= from && a.t < to && a.rms > 0.01).map((a) => 20 * Math.log10(a.rms))
  const energyVar = std(loud) // dB
  return clamp(0.7 * (spread / 4) + 0.3 * (energyVar / 8), 0, 1)
}

/** Share of frames with eye contact, among frames where a face was found. Null if face rarely seen. */
export function eyeContactShare(vision: VisionSample[], from: number, to: number): number | null {
  const frames = vision.filter((v) => v.t >= from && v.t < to)
  const withFace = frames.filter((v) => v.face)
  if (frames.length < 5 || withFace.length < frames.length * 0.5) return null
  return withFace.filter((v) => v.eyeContact).length / withFace.length
}

export interface GestureSummary {
  handsVisibleShare: number
  movement: number
  level: 'still' | 'natural' | 'busy'
}

export function gestureSummary(vision: VisionSample[], from: number, to: number): GestureSummary | null {
  const frames = vision.filter((v) => v.t >= from && v.t < to && v.face)
  if (frames.length < 10) return null
  const visible = frames.filter((v) => v.handsVisible > 0)
  const handsVisibleShare = visible.length / frames.length
  const movement = visible.length ? mean(visible.map((v) => v.movement)) : 0
  const level = handsVisibleShare < 0.15 || movement < 0.05 ? 'still' : movement > 0.6 ? 'busy' : 'natural'
  return { handsVisibleShare, movement, level }
}

// ---------- delivery scores ----------

function paceScore(wpm: number) {
  // Ideal conversational pitch pace is roughly 130 to 165 wpm.
  if (wpm >= 130 && wpm <= 165) return 10
  if (wpm < 130) return clamp(10 - (130 - wpm) / 6)
  return clamp(10 - (wpm - 165) / 5)
}

export interface DeliveryStats {
  wpm: number | null
  wpmSpread: number | null
  fillers: number
  fillersPerMin: number
  hesitations: number
  deliberatePauses: number
  eyeContact: number | null
  gestures: GestureSummary | null
  expressiveness: number | null
  talkSeconds: number
}

export function deliveryStats(session: Pick<SessionData, 'words' | 'audio' | 'vision' | 'slideChanges' | 'pitchEnd'>): DeliveryStats {
  const end = session.pitchEnd
  const words = session.words.filter((w) => w.start < end)
  const minutes = Math.max(end / 60, 0.25)
  const paceWindows = windows(end, 20, (a, b) => wpmBetween(words, a, b))
    .map((p) => p.value)
    .filter((v): v is number => v !== null)
  const pauses = findPauses(words, session.slideChanges.map((s) => s.t))
  return {
    wpm: wpmBetween(words, 0, end),
    wpmSpread: paceWindows.length > 2 ? std(paceWindows) : null,
    fillers: fillerIndices(words).length,
    fillersPerMin: fillerIndices(words).length / minutes,
    hesitations: pauses.filter((p) => p.kind === 'hesitation').length,
    deliberatePauses: pauses.filter((p) => p.kind === 'deliberate').length,
    eyeContact: eyeContactShare(session.vision, 0, end),
    gestures: gestureSummary(session.vision, 0, end),
    expressiveness: expressiveness(session.audio, 0, end),
    talkSeconds: words.reduce((s, w) => s + (w.end - w.start), 0),
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export function deliveryScores(s: DeliveryStats): DeliveryScore[] {
  const minutes = Math.max(s.talkSeconds / 60, 0.25)
  return [
    {
      key: 'pace',
      label: 'Pace',
      score: s.wpm === null ? null : paceScore(s.wpm),
      value: s.wpm === null ? 'Not enough speech' : `${Math.round(s.wpm)} wpm`,
      note:
        s.wpm === null
          ? 'Too little speech was captured to measure pace.'
          : s.wpm > 165
            ? 'Faster than most audiences can follow. Slow down on key points.'
            : s.wpm < 130
              ? 'On the slow side. Tighten sentences to keep energy up.'
              : 'A comfortable pace for a pitch.',
    },
    {
      key: 'fillers',
      label: 'Fillers',
      score: s.wpm === null ? null : clamp(10 - s.fillersPerMin * 1.5),
      value: `${s.fillers} (${s.fillersPerMin.toFixed(1)} per min)`,
      note: s.fillersPerMin > 4 ? 'Fillers are frequent. Replace them with a short silent pause.' : 'Fillers are under control.',
    },
    {
      key: 'pauses',
      label: 'Pauses',
      score: s.wpm === null ? null : clamp(10 - (s.hesitations / minutes) * 2 + Math.min(s.deliberatePauses, 4) * 0.25),
      value: `${s.deliberatePauses} deliberate, ${s.hesitations} hesitant`,
      note:
        s.hesitations > s.deliberatePauses
          ? 'Most pauses happen mid-sentence. Pause after a point, not inside it.'
          : 'Pauses mostly land at the end of points, which reads as confident.',
    },
    {
      key: 'eye_contact',
      label: 'Eye contact',
      score: s.eyeContact === null ? null : clamp(s.eyeContact * 12 - 1),
      value: s.eyeContact === null ? 'Not measured' : pct(s.eyeContact),
      note:
        s.eyeContact === null
          ? 'The camera did not see your face clearly enough to measure this.'
          : s.eyeContact < 0.5
            ? 'You looked away from the camera for much of the pitch, likely at the slides.'
            : 'Good connection with the camera.',
    },
    {
      key: 'gestures',
      label: 'Gestures',
      score: s.gestures === null ? null : s.gestures.level === 'natural' ? 9 : s.gestures.level === 'still' ? 6 : 5,
      value: s.gestures === null ? 'Not measured' : `${s.gestures.level}, hands visible ${pct(s.gestures.handsVisibleShare)}`,
      note:
        s.gestures === null
          ? 'Gestures need your upper body in frame.'
          : s.gestures.level === 'still'
            ? 'Hands were mostly out of view or still. Use open gestures on key points.'
            : s.gestures.level === 'busy'
              ? 'A lot of hand movement. Keep gestures for emphasis.'
              : 'Natural, purposeful gestures.',
    },
    {
      key: 'tonality',
      label: 'Tonality',
      score: s.expressiveness === null ? null : clamp(s.expressiveness * 12),
      value: s.expressiveness === null ? 'Not measured' : s.expressiveness < 0.35 ? 'Monotone' : s.expressiveness < 0.65 ? 'Varied' : 'Expressive',
      note:
        s.expressiveness === null
          ? 'Not enough voiced audio to judge tonality.'
          : s.expressiveness < 0.35
            ? 'Your voice stayed flat. Lift your pitch on the problem and the ask.'
            : 'Your voice carried variation and energy.',
    },
  ]
}

export function averageScore(scores: (number | null)[]): number | null {
  const valid = scores.filter((s): s is number => s !== null)
  return valid.length ? mean(valid) : null
}

/** The strongest 20 seconds of the pitch: steady pace, no fillers or hesitations, eye contact and vocal variety. */
export function bestMoment(session: Pick<SessionData, 'words' | 'audio' | 'vision' | 'slideChanges' | 'pitchEnd' | 'events'>) {
  const words = session.words.filter((w) => w.start < session.pitchEnd)
  if (words.length < 10) return null
  const fillers = new Set(fillerIndices(words))
  const pauses = findPauses(words, session.slideChanges.map((s) => s.t))
  let best: { start: number; score: number } | null = null
  for (let start = 0; start + 20 <= Math.max(session.pitchEnd, 20); start += 2) {
    const end = start + 20
    const inWin = words.filter((w) => w.start >= start && w.end <= end)
    if (inWin.length < 25) continue
    const wpm = wpmBetween(words, start, end)
    const fillerCount = words.reduce((n, w, i) => n + (fillers.has(i) && w.start >= start && w.end <= end ? 1 : 0), 0)
    const hes = pauses.filter((p) => p.kind === 'hesitation' && p.start >= start && p.end <= end).length
    const eye = eyeContactShare(session.vision, start, end)
    const expr = expressiveness(session.audio, start, end)
    const strong = session.events.filter((e) => e.type === 'strong_moment' && e.t >= start && e.t <= end).length
    const score =
      (wpm ? paceScore(wpm) : 5) - fillerCount * 2 - hes * 1.5 + (eye ?? 0.5) * 4 + (expr ?? 0.4) * 4 + strong * 2
    if (!best || score > best.score) best = { start, score }
  }
  if (!best) return null
  const start = best.start
  const text = words
    .filter((w) => w.start >= start && w.end <= start + 20)
    .map((w) => w.text)
    .join(' ')
  return { start, end: start + 20, text }
}

/** Plain-text transcript with a timestamp at the start of each sentence-ish chunk. */
export function timestampedTranscript(words: Word[], maxChars = 12000): string {
  const lines: string[] = []
  let line: string[] = []
  let lineStart = 0
  for (const w of words) {
    if (!line.length) lineStart = w.start
    line.push(w.text)
    if (/[.!?]$/.test(w.text) || line.length > 30) {
      lines.push(`[${Math.round(lineStart)}s] ${line.join(' ')}`)
      line = []
    }
  }
  if (line.length) lines.push(`[${Math.round(lineStart)}s] ${line.join(' ')}`)
  return lines.join('\n').slice(-maxChars)
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
