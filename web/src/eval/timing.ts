// Conversation timing: monologue length, talk ratio, answer latency and length, yielding, bridge-back.
import type { AgentTurn, AnswerTiming, FeedbackEvent, Phrase, TimingStats } from './contracts'
import { T } from './thresholds'
import { clean } from './transcript/fillers'

type Draft = Omit<FeedbackEvent, 'source'>

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n))
const r1 = (n: number) => Math.round(n * 10) / 10
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const STOP = new Set(
  'about above after again against because before being below between could doing during further having other ought their theirs there these they those through under until which while would should where whose people really thing things going think actually basically literally'.split(' '),
)

/** Distinctive words from the pitch (repeated in the pitch, or on a slide). Used to detect bridging back. */
export function pitchKeywords(pitchPhrases: Phrase[], slideTexts: string[] = [], max = 40): string[] {
  const counts = new Map<string, number>()
  for (const p of pitchPhrases) {
    for (const raw of p.text.split(/\s+/)) {
      const w = clean(raw)
      if (w.length >= 5 && !STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1)
    }
  }
  const slideWords = new Set(slideTexts.flatMap((s) => s.split(/\s+/).map(clean)).filter((w) => w.length >= 5 && !STOP.has(w)))
  const repeated = [...counts.entries()].filter(([w, n]) => n >= 2 || slideWords.has(w)).sort((a, b) => b[1] - a[1])
  return repeated.slice(0, max).map(([w]) => w)
}

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

export interface TimingInput {
  phrases: Phrase[]
  agentTurns: AgentTurn[]
  duration: number
  keywords: string[]
}

export function computeTiming({ phrases, agentTurns, duration, keywords }: TimingInput): { stats: TimingStats; events: Draft[]; score: number } {
  const turns = [...agentTurns].sort((a, b) => a.t - b.t)
  const kw = new Set(keywords)
  const events: Draft[] = []

  // Longest monologue: user phrases chained by short gaps, broken by agent turns.
  let longest = 0
  let runStart: number | null = null
  let runEnd = 0
  for (const p of phrases) {
    const agentBetween = turns.some((a) => a.t >= runEnd && a.t < p.t)
    if (runStart === null || p.t - runEnd > T.room.monologueBreakSec || agentBetween) runStart = p.t
    runEnd = p.end
    longest = Math.max(longest, runEnd - runStart)
  }

  const userTalk = phrases.reduce((s, p) => s + (p.end - p.t), 0)
  const agentTalk = turns.reduce((s, a) => s + Math.max(0, a.end - a.t), 0)
  const talkRatio = agentTalk > 0 ? userTalk / (userTalk + agentTalk) : null

  const answers: AnswerTiming[] = turns.map((turn, i) => {
    const until = turns[i + 1]?.t ?? duration
    const reply = phrases.filter((p) => p.t >= turn.end - 0.5 && p.t < until)
    const overlapSec = phrases.reduce((s, p) => s + overlap(p.t, p.end, turn.t, turn.end), 0)
    if (!reply.length) return { agent: turn.agent, question: turn.text, askedAt: turn.end, latencySec: null, answerSec: null, bridgeBackSec: null, overlapSec: r1(overlapSec) }
    const first = reply[0]
    const last = reply[reply.length - 1]
    // Echoing the question's own words is not bridging back to the pitch.
    const asked = new Set(turn.text.split(/\s+/).map(clean))
    let bridgeBackSec: number | null = null
    for (const p of reply) {
      const tokens = p.text.split(/\s+/)
      const step = (p.end - p.t) / Math.max(tokens.length, 1)
      const hit = tokens.findIndex((w) => kw.has(clean(w)) && !asked.has(clean(w)))
      if (hit >= 0) {
        bridgeBackSec = r1(p.t + hit * step - first.t)
        break
      }
    }
    return {
      agent: turn.agent,
      question: turn.text,
      askedAt: r1(turn.end),
      latencySec: r1(Math.max(0, first.t - turn.end)),
      answerSec: r1(last.end - first.t),
      bridgeBackSec,
      overlapSec: r1(overlapSec),
    }
  })

  const [ansLo, ansHi] = T.timing.answerSec
  const [latLo, latHi] = T.timing.latencySec
  const perAnswer: number[] = []
  for (const a of answers) {
    if (a.overlapSec > T.timing.yieldSec) {
      events.push({ t: a.askedAt - a.overlapSec, cat: 'panel', severity: 'warn', msg: `Kept talking over ${a.agent} for ${a.overlapSec}s` })
    }
    if (a.latencySec === null || a.answerSec === null) {
      events.push({ t: a.askedAt, cat: 'timing', severity: 'bad', msg: `No answer to ${a.agent}'s question` })
      perAnswer.push(20)
      continue
    }
    const start = a.askedAt + a.latencySec
    let s = 100
    if (a.latencySec > latHi + 1) {
      events.push({ t: a.askedAt, end: start, cat: 'timing', severity: 'warn', msg: `Took ${a.latencySec}s to start answering` })
      s -= Math.min(30, (a.latencySec - latHi) * 8)
    }
    if (a.answerSec > ansHi + 15) {
      events.push({ t: start, end: start + a.answerSec, cat: 'timing', severity: 'warn', msg: `Answer ran ${Math.round(a.answerSec)}s. Aim for under ${ansHi}s.` })
      s -= Math.min(40, (a.answerSec - ansHi) * 1.5)
    } else if (a.answerSec < 5) {
      events.push({ t: start, end: start + a.answerSec, cat: 'timing', severity: 'warn', msg: `Very short answer (${Math.round(a.answerSec)}s)` })
      s -= 25
    } else if (a.answerSec >= ansLo && a.answerSec <= ansHi && a.latencySec >= latLo - 0.5 && a.latencySec <= latHi + 1) {
      events.push({ t: start, end: start + a.answerSec, cat: 'timing', severity: 'good', msg: `Well-paced answer to ${a.agent} (${Math.round(a.answerSec)}s)` })
    }
    if (a.bridgeBackSec !== null && a.bridgeBackSec <= 10 && a.answerSec >= 8) {
      events.push({ t: start + a.bridgeBackSec, cat: 'coherency', severity: 'good', msg: `Tied the answer back to your pitch within ${a.bridgeBackSec}s` })
    }
    s -= Math.min(20, Math.max(0, a.overlapSec - T.timing.yieldSec) * 5)
    perAnswer.push(clamp(s))
  }

  const monologuePenalty = Math.min(35, Math.max(0, longest - T.timing.monologueMaxSec) / 3)
  const answerAvg = perAnswer.length ? perAnswer.reduce((a, b) => a + b, 0) / perAnswer.length : null
  const score = Math.round(answerAvg === null ? clamp(100 - monologuePenalty) : clamp(0.35 * (100 - monologuePenalty) + 0.65 * answerAvg))

  return {
    stats: {
      longestMonologueSec: r1(longest),
      talkRatio: talkRatio === null ? null : Math.round(talkRatio * 100) / 100,
      answers,
      medianLatencySec: median(answers.map((a) => a.latencySec).filter((x): x is number => x !== null)),
      medianAnswerSec: median(answers.map((a) => a.answerSec).filter((x): x is number => x !== null)),
    },
    events,
    score,
  }
}
