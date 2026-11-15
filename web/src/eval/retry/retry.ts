// "Try that answer again": which moments can be retried, how an attempt is measured, and how two attempts compare.
// The original and the retry are measured with the same functions over their own time windows, so the change is
// like for like. Clarity comes from Claude, which judges both attempts blind in one call (server/src/eval/retry.ts).
import type { Report, SessionData } from '../../types'
import type { Phrase, SampleX } from '../contracts'
import { formatTime } from '../metrics'
import { pickPassage } from '../playback/DoItBetter'
import { wpmIn } from '../rules'
import { bodyScore, coherencyProxy, eyeScore, toneScore } from '../scores'
import { T } from '../thresholds'

export interface RetryTarget {
  /** Stable per session: `q<index>` or `pitch`. */
  id: string
  kind: 'question' | 'passage'
  /** Short label for the picker. */
  title: string
  /** The question, or what to say again. */
  prompt: string
  personaId?: string
  personaName?: string
  voiceId?: string
  /** The original answer's window on the session clock. */
  from: number
  to: number
  original: string
  /** What to fix (Claude's feedback on the answer, or the top priority). */
  issue: string
  /** Claude's original score for this answer (0–100), when there is one. */
  priorScore: number | null
}

export interface AttemptMetrics {
  eye: number | null
  body: number | null
  voice: number | null
  /** Filler-and-hesitation proxy, used for clarity only when Claude is unavailable. */
  fluency: number | null
  wpm: number | null
  fillers: number
  words: number
  seconds: number
}

export interface RetryJudgement {
  before: { score: number; note: string }
  after: { score: number; note: string }
  /** What the retry did better than the original. */
  better: string[]
  /** One thing to do on the next try. */
  next: string
}

/** One retry, as saved next to the session (retries.json). */
export interface RetryAttempt {
  at: string
  targetId: string
  title: string
  prompt: string
  before: { text: string; metrics: AttemptMetrics }
  after: { text: string; metrics: AttemptMetrics }
  judgement: RetryJudgement | null
  judgeError: string | null
  /** Recording of the retry, this tab only (not uploaded). */
  localVideo?: string
}

/** Moments worth retrying, weakest first: low-scored or missing answers, then the weakest pitch passage. */
export function retryTargets(session: SessionData, report: Report, k = 1): RetryTarget[] {
  const ev = session.evaluation
  const out: RetryTarget[] = []
  session.qna.forEach((q, i) => {
    const fb = report.content?.qna_feedback.find((f) => f.question_index === i)
    const persona = session.config.panel.personas.find((p) => p.id === q.personaId)
    // The answer starts when the panelist finished asking.
    const asked = ev?.agentTurns.find((a) => a.t >= q.start - 2 && a.t < q.end)
    out.push({
      id: `q${i}`,
      kind: 'question',
      title: `${q.personaName.split(' ')[0]}'s question`,
      prompt: q.question,
      personaId: q.personaId,
      personaName: q.personaName,
      voiceId: persona?.voiceId,
      from: asked ? Math.min(asked.end, q.end) : q.start,
      to: q.end,
      original: q.answer.trim(),
      issue: fb?.feedback ?? (q.answer.trim() ? 'Answer the question in your first sentence, then back it up with one specific fact.' : 'No answer was captured last time.'),
      priorScore: fb ? Math.round(fb.score * k) : null,
    })
  })
  // Weakest first: no answer, then lowest score; unscored answers after scored ones.
  out.sort((a, b) => rank(a) - rank(b))
  const questions = out.slice(0, 3)

  const passage = pickPassage(session, report)
  if (passage) {
    questions.push({
      id: 'pitch',
      kind: 'passage',
      title: `Your pitch at ${formatTime(passage.start)}`,
      prompt: 'Say this part of your pitch again: lead with the point, keep it short, and skip the fillers.',
      from: passage.start,
      to: passage.end,
      original: passage.text,
      issue: passage.issue,
      priorScore: null,
    })
  }
  return questions
}

const rank = (t: RetryTarget) => (!t.original ? -1 : t.priorScore ?? 101)

/** Measures one attempt over [from, to] with the same scoring functions as the report. */
export function measure(samples: SampleX[], phrases: Phrase[], from: number, to: number): AttemptMetrics {
  const s = samples.filter((x) => x.t >= from && x.t <= to)
  const inWin = phrases.filter((p) => p.end > from && p.t < to)
  return {
    eye: eyeScore(s),
    body: bodyScore(s),
    voice: toneScore(s, phrases, from, to),
    fluency: coherencyProxy(phrases, from, to),
    wpm: (() => {
      const w = wpmIn(phrases, from, to, 8)
      return w === null ? null : Math.round(w)
    })(),
    fillers: inWin.reduce((n, p) => n + p.fillers.filter((f) => f >= from && f <= to).length, 0),
    words: inWin.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0),
    seconds: Math.max(0, Math.round((to - from) * 10) / 10),
  }
}

/** Overall for one attempt: the report's weights without timing, over whatever was measured. */
export function attemptOverall(m: AttemptMetrics, clarity: number | null): number | null {
  const W = T.overallWeights
  const parts: [number | null, number][] = [
    [clarity ?? m.fluency, W.coherency],
    [m.eye, W.eye],
    [m.body, W.body],
    [m.voice, W.tone],
  ]
  let total = 0
  let weight = 0
  for (const [v, w] of parts) {
    if (v === null) continue
    total += v * w
    weight += w
  }
  return weight && m.words > 0 ? Math.round(total / weight) : null
}

export type Better = 'higher' | 'lower' | 'band' | 'none'

export interface CompareRow {
  key: string
  label: string
  before: number | null
  after: number | null
  better: Better
  format: (v: number, m: AttemptMetrics) => string
}

const perMin = (m: AttemptMetrics) => (m.seconds > 0 ? m.fillers / (m.seconds / 60) : 0)

/** The rows of the before and after table. */
export function compareRows(a: RetryAttempt): CompareRow[] {
  const b = a.before.metrics
  const r = a.after.metrics
  const n = (v: number) => String(Math.round(v))
  return [
    { key: 'clarity', label: a.judgement ? 'Clarity' : 'Fluency', before: a.judgement?.before.score ?? b.fluency, after: a.judgement?.after.score ?? r.fluency, better: 'higher', format: n },
    { key: 'eye', label: 'Eye contact', before: b.eye, after: r.eye, better: 'higher', format: n },
    { key: 'body', label: 'Body language', before: b.body, after: r.body, better: 'higher', format: n },
    { key: 'voice', label: 'Voice', before: b.voice, after: r.voice, better: 'higher', format: n },
    { key: 'pace', label: 'Pace', before: b.wpm, after: r.wpm, better: 'band', format: (v) => `${Math.round(v)} wpm` },
    {
      key: 'fillers',
      label: 'Filler words',
      before: b.words ? perMin(b) : null,
      after: r.words ? perMin(r) : null,
      better: 'lower',
      format: (_v, m) => `${m.fillers} · ${perMin(m).toFixed(1)}/min`,
    },
    { key: 'length', label: 'Length', before: b.seconds || null, after: r.seconds || null, better: 'none', format: (v) => `${Math.round(v)}s` },
  ]
}

/** Signed improvement (positive = better) for a row, or null when either side is missing or the row is neutral. */
export function improvement(row: CompareRow): number | null {
  if (row.before === null || row.after === null || row.better === 'none') return null
  if (row.better === 'higher') return row.after - row.before
  if (row.better === 'lower') return row.before - row.after
  const [lo, hi] = T.voice.paceGood
  const off = (v: number) => (v < lo ? lo - v : v > hi ? v - hi : 0)
  return off(row.before) - off(row.after)
}

/** Below this the change is noise. */
export const SAME = { higher: 3, lower: 0.5, band: 5, none: Infinity } as const
