// RoomState for the floor manager (agents decide when to speak). Pure function, call every ~250 ms.
import type { AgentTurn, Phrase, RoomState, SampleX } from './contracts'
import { T } from './thresholds'
import { clean, fillerIndices } from './transcript/fillers'

export interface RoomInput {
  now: number
  samples: SampleX[]
  phrases: Phrase[]
  /** Current partial (uncommitted) STT text. */
  partial: string
  agentTurns: AgentTurn[]
  /** An agent is talking right now (its audio may leak into the mic, so ignore `speaking`). */
  agentSpeaking: boolean
  /** The user pressed "end pitch" or otherwise handed over. */
  pitchEnded: boolean
  /** Optional end-of-turn probability from the LiveKit turn detector or a cheap LLM. */
  turnDetectorProb?: number | null
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

const INVITE =
  /\b(any questions|happy to (take|answer) (any )?questions|questions\?|that'?s (my|our) pitch|thank you( so much)?( for (listening|your time))?\.?$|open (it )?up (to|for) questions|i'?d love to hear (your|any) (questions|thoughts)|what do you think)\b/i
const TRAILING = /\b(and|but|so|because|or|that|which|the|a|an|to|of|um|uh|like|with|for|if|when|is|are)[,]?$/i

/** Start time of the latest continuous stretch of user speech, or null when the user is silent. */
export function monologueStart(samples: SampleX[], now: number, floor: number): number | null {
  let lastSpeak: number | null = null
  let start: number | null = null
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]
    if (s.t < floor) break
    if (!s.speaking) continue
    if (lastSpeak === null) {
      if (now - s.t > T.room.monologueBreakSec) return null
    } else if (lastSpeak - s.t > T.room.monologueBreakSec) break
    lastSpeak = s.t
    start = s.t
  }
  return start
}

/** Pitch slope (semitones per second) over the last second of voiced speech before `until`. */
export function pitchSlope(samples: SampleX[], until: number): number | null {
  const pts: [number, number][] = []
  for (let i = samples.length - 1; i >= 0 && samples[i].t >= until - 1; i--) {
    const s = samples[i]
    if (s.t <= until && s.pitchHz) pts.push([s.t, 12 * Math.log2(s.pitchHz / 100)])
  }
  if (pts.length < 4) return null
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length
  let num = 0
  let den = 0
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my)
    den += (x - mx) ** 2
  }
  return den > 0 ? num / den : null
}

/** How finished the last utterance sounds from its words alone, 0–1. */
export function semanticEnd(lastText: string, partial: string): number {
  if (partial.trim()) return 0.2
  const text = lastText.trim()
  if (!text) return 0.5
  if (/[.!?]["']?$/.test(text)) return 0.85
  if (TRAILING.test(text)) return 0.1
  return 0.5
}

const tokens = (phrases: Phrase[]) => phrases.flatMap((p) => p.text.split(/\s+/).filter(Boolean))

/** 0–1: long monologue, frequent fillers, repeated words and run-on sentences. */
export function ramblingScore(monologueSec: number, phrases: Phrase[], now: number): number {
  const mono = clamp01((monologueSec - T.room.ramblingStartSec) / (T.room.ramblingFullSec - T.room.ramblingStartSec))
  const recent = phrases.filter((p) => p.end > now - 30)
  const fillers30 = recent.reduce((n, p) => n + p.fillers.filter((f) => f > now - 30).length, 0)
  const filler = clamp01((fillers30 * 2) / 8) // per minute, 8/min = full
  const words = tokens(phrases.filter((p) => p.end > now - 60)).slice(-60)
  const content = words.map(clean).filter((w) => w.length > 3)
  const repetition = content.length >= 15 ? clamp01((1 - new Set(content).size / content.length - 0.3) / 0.3) : 0
  let run = 0
  let longest = 0
  for (const w of words) {
    run = /[.!?]$/.test(w) ? 0 : run + 1
    longest = Math.max(longest, run)
  }
  const runOn = clamp01((longest - 30) / 30)
  return round(0.45 * mono + 0.25 * filler + 0.2 * repetition + 0.1 * runOn)
}

export function computeRoomState(i: RoomInput): RoomState {
  const { now, samples, phrases } = i
  const lastAgentEnd = i.agentTurns.reduce((m, a) => Math.max(m, a.end), 0)
  const latest = samples[samples.length - 1]

  let lastSpeakT = -1
  for (let k = samples.length - 1; k >= 0; k--) {
    if (samples[k].speaking) {
      lastSpeakT = samples[k].t
      break
    }
  }
  const lastPhrase = phrases[phrases.length - 1]
  // The transcript lags the mic slightly; trust whichever saw speech most recently.
  const lastUserAt = Math.max(lastSpeakT, lastPhrase?.end ?? -1)
  const userSpeaking = Boolean(latest?.speaking) && !i.agentSpeaking
  const silenceSec = userSpeaking ? 0 : lastUserAt >= 0 ? Math.max(0, now - lastUserAt) : Math.max(0, now - lastAgentEnd)

  const start = monologueStart(samples, now, lastAgentEnd)
  const monologueSec = start === null ? 0 : Math.max(0, now - start)

  let gazeAwaySec = 0
  for (let k = samples.length - 1; k >= 0; k--) {
    if (samples[k].gazeOnTarget) break
    gazeAwaySec = now - samples[k].t
  }

  const partialWords = i.partial.trim() ? i.partial.trim().split(/\s+/).map((text) => ({ text, start: now, end: now })) : []
  const fillersLast10s =
    phrases.filter((p) => p.end > now - 10).reduce((n, p) => n + p.fillers.filter((f) => f > now - 10).length, 0) + fillerIndices(partialWords).length

  const recentText = phrases.filter((p) => p.end > now - 15).map((p) => p.text).join(' ')
  const invitedQuestions = i.pitchEnded || INVITE.test(recentText.slice(-200))

  // End of thought: silence length x (what the words say + how the pitch moved).
  const semantic = i.turnDetectorProb ?? semanticEnd(lastPhrase && lastPhrase.end > now - 10 ? lastPhrase.text : '', i.partial)
  const slope = lastSpeakT >= 0 ? pitchSlope(samples, lastSpeakT) : null
  const pitchTerm = slope === null ? 0.5 : slope < -3 ? 0.8 : slope > 3 ? 0.45 : 0.5
  const silenceTerm = sigmoid((silenceSec - T.room.silenceMidSec) / 0.2)
  let endOfThoughtProb = silenceTerm * (0.65 * semantic + 0.35 * pitchTerm)
  // A long silence is a handover however the sentence ended.
  if (silenceSec > 3) endOfThoughtProb = Math.max(endOfThoughtProb, Math.min(1, 0.5 + (silenceSec - 3) * 0.15))
  if (userSpeaking) endOfThoughtProb *= 0.1

  return {
    t: round(now),
    silenceSec: round(silenceSec),
    endOfThoughtProb: round(endOfThoughtProb),
    userSpeaking,
    monologueSec: round(monologueSec, 1),
    invitedQuestions,
    gazeAwaySec: round(gazeAwaySec, 1),
    fillersLast10s,
    ramblingScore: ramblingScore(monologueSec, phrases, now),
  }
}
