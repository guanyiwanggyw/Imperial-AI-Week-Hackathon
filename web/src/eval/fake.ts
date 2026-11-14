// Fake-data mode. Lets the agents and UI workstreams build against realistic Sample, Phrase, RoomState
// and FeedbackEvent streams without a camera, mic or API keys. Deterministic (seeded).
// `replayLive` runs stored samples and phrases through the live rule path offline; the calibration
// CLI uses it to re-score saved sessions with the current thresholds.
import type { AgentTurn, EvaluationResult, FeedbackEvent, Phrase, RoomState, SampleX } from './contracts'
import { assembleEvaluation } from './assemble'
import { computeRoomState } from './roomState'
import { RuleEngine } from './rules'
import { T } from './thresholds'
import { fillerTimes } from './transcript/fillers'

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PITCH = [
  'Independent clinics lose about twelve percent of revenue to missed appointments.',
  'Um, we talked to forty clinic managers and every one of them tracks no-shows by hand.',
  'Our product is an SMS agent that confirms, reschedules and fills cancelled slots.',
  'So, like, it plugs into the booking systems they already use.',
  'In a pilot with nine paying clinics we cut no-shows by forty percent.',
  'Uh, you know, we basically, um, think this is a huge market, sort of.',
  'We charge two hundred pounds per clinic per month.',
  'Our competitors are generic reminder tools that cannot reschedule.',
  'We are raising one and a half million to reach three hundred clinics.',
  'Thank you, happy to take any questions.',
]
const ANSWER = [
  'Forty percent compared with the same clinics in the three months before the pilot.',
  'We measured it from their booking logs, so it is the clinics own data.',
  'And that is why the pricing pays back in the first month for a typical clinic.',
]

export interface FakeData {
  samples: SampleX[]
  phrases: Phrase[]
  agentTurns: AgentTurn[]
  duration: number
  pitchEnd: number
}

/**
 * A ~2.5 minute session with known problems: look-away at 40–46 s, arms crossed at 60–68 s, face touch at 75 s,
 * monotone at 80–100 s, filler-heavy phrase, then one question from the CFO at 100 s and an answer.
 */
export function makeFakeData(seed = 1): FakeData {
  const rand = rng(seed)
  const phrases: Phrase[] = []
  const mkPhrase = (t: number, text: string): Phrase => {
    const tokens = text.split(/\s+/)
    const dur = tokens.length / 2.5
    const words = tokens.map((w, i) => ({ text: w, start: t + (i * dur) / tokens.length, end: t + ((i + 1) * dur) / tokens.length }))
    return { t, end: Math.round((t + dur) * 100) / 100, text, fillers: fillerTimes(words).map((f) => Math.round(f * 100) / 100), wpm: 150 }
  }
  let t = 2
  for (const line of PITCH) {
    const p = mkPhrase(t, line)
    phrases.push(p)
    t = p.end + 0.6 + rand() * 0.8
    if (t > 40 && t < 47) t = 47 // silent while looking away
  }
  // Pad the pitch to ~95 s by repeating the middle lines.
  while (t < 95) {
    const p = mkPhrase(t, PITCH[2 + Math.floor(rand() * 5)])
    phrases.push(p)
    t = p.end + 0.6 + rand() * 0.8
  }
  const pitchEnd = t
  const agentTurns: AgentTurn[] = [{ t: pitchEnd + 2, end: pitchEnd + 5, agent: 'Skeptic CFO', text: 'Forty percent compared with what?', interrupted: false }]
  t = pitchEnd + 6.2
  for (const line of ANSWER) {
    const p = mkPhrase(t, line)
    phrases.push(p)
    t = p.end + 0.5
  }
  const duration = Math.ceil(t + 3)

  const samples: SampleX[] = []
  const speakingAt = (x: number) => phrases.some((p) => x >= p.t && x <= p.end)
  for (let x = 0; x < duration; x += 1 / T.sampleHz) {
    const tt = Math.round(x * 100) / 100
    const speaking = speakingAt(tt)
    const lookAway = tt >= 40 && tt < 46.5
    const monotone = tt >= 80 && tt < 100
    const semis = monotone ? 8 + (rand() - 0.5) * 1 : 8 + (rand() - 0.5) * 9
    samples.push({
      t: tt,
      gazeOnTarget: !lookAway && rand() > 0.05,
      headYaw: lookAway ? 28 : (rand() - 0.5) * 10,
      headPitch: (rand() - 0.5) * 8,
      armsOpen: !(tt >= 60 && tt < 68),
      handSpeed: speaking ? 0.2 + rand() * 0.4 : 0.02,
      faceTouch: tt >= 75 && tt < 75.6,
      slouch: 0.05,
      smile: tt < 20 ? 0.35 : 0.1,
      pitchHz: speaking && rand() > 0.3 ? Math.round(100 * 2 ** (semis / 12)) : null,
      rms: speaking ? 0.04 + rand() * 0.03 : 0.004,
      speaking,
      mouthMoving: speaking,
      // Room chatter: the mic hears voices at 20–30 s while the speaker is between sentences.
      micVoice: speaking || (tt >= 20 && tt < 30),
      face: true,
      handsVisible: speaking ? 2 : 1,
      bodyX: 0.5,
    })
  }
  return { samples, phrases, agentTurns, duration, pitchEnd }
}

export interface ReplayResult {
  ruleEvents: FeedbackEvent[]
  roomStates: RoomState[]
}

/** Runs stored data through the live rule path (RoomState every 250 ms, rules every second). */
export function replayLive(d: { samples: SampleX[]; phrases: Phrase[]; agentTurns: AgentTurn[]; duration: number; pitchEnd: number }): ReplayResult {
  const rules = new RuleEngine()
  const roomStates: RoomState[] = []
  let si = 0
  let pi = 0
  let lastTick = 0
  let room: RoomState | null = null
  for (let now = 0; now <= d.duration; now = Math.round((now + 0.25) * 100) / 100) {
    while (si < d.samples.length && d.samples[si].t <= now) rules.onSample(d.samples[si++])
    while (pi < d.phrases.length && d.phrases[pi].end <= now) pi++
    const agentSpeaking = d.agentTurns.some((a) => now >= a.t && now <= a.end)
    room = computeRoomState({
      now,
      samples: d.samples.slice(Math.max(0, si - T.sampleHz * 200), si),
      phrases: d.phrases.slice(0, pi),
      partial: '',
      agentTurns: d.agentTurns.filter((a) => a.end <= now),
      agentSpeaking,
      pitchEnded: now >= d.pitchEnd,
    })
    roomStates.push(room)
    if (now - lastTick >= 1) {
      lastTick = now
      rules.tick(now, room, d.phrases.slice(0, pi))
    }
  }
  rules.finish()
  return { ruleEvents: rules.events, roomStates }
}

/** A complete EvaluationResult from fake data, without Claude. Good as a fixture for the feedback player. */
export function fakeEvaluation(seed = 1): EvaluationResult {
  const d = makeFakeData(seed)
  const { ruleEvents } = replayLive(d)
  return assembleEvaluation({ ...d, ruleEvents, segments: [], calibration: null, slideTexts: [], content: null })
}

export interface FakeStreamHandlers {
  onSample?: (s: SampleX) => void
  onPhrase?: (p: Phrase) => void
  onRoomState?: (r: RoomState) => void
  onAgentTurn?: (a: AgentTurn) => void
}

/** Plays fake data in real time (or faster with `speed`). Returns a stop function. Browser or Node. */
export function playFake(h: FakeStreamHandlers, speed = 1, seed = 1): () => void {
  const d = makeFakeData(seed)
  const { roomStates } = replayLive(d)
  const start = Date.now()
  let si = 0
  let pi = 0
  let ri = 0
  let ai = 0
  const timer = setInterval(() => {
    const now = ((Date.now() - start) / 1000) * speed
    while (si < d.samples.length && d.samples[si].t <= now) h.onSample?.(d.samples[si++])
    while (pi < d.phrases.length && d.phrases[pi].end <= now) h.onPhrase?.(d.phrases[pi++])
    while (ri < roomStates.length && roomStates[ri].t <= now) h.onRoomState?.(roomStates[ri++])
    while (ai < d.agentTurns.length && d.agentTurns[ai].end <= now) h.onAgentTurn?.(d.agentTurns[ai++])
    if (now > d.duration) clearInterval(timer)
  }, 50)
  return () => clearInterval(timer)
}
