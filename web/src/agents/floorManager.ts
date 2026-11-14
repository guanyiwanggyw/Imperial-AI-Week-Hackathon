// Floor manager (brief §2): decides whether any agent speaks now, who, and what kind of line.
// Pure and deterministic given `rand`, so it can be tested on fake RoomState.
//
// Panel awareness: one voice at a time, a short gap after any agent line so others don't pile on,
// and at most one interruption per INTERRUPT_GAP_S across the whole panel.
import type { RoomState } from '../eval'
import type { Persona } from '../types'
import type { Traits } from './traits'

export type LineKind = 'question' | 'follow_up' | 'comment' | 'interjection' | 'nudge' | 'reply'

export interface AgentSlot {
  persona: Persona
  traits: Traits
  turns: number
}

export interface LastLine {
  personaId: string
  kind: LineKind
  t: number
  end: number
}

export interface FloorInput {
  now: number
  room: RoomState
  agents: AgentSlot[]
  agentSpeaking: boolean
  last: LastLine | null
  /** The speaker said something after the last agent line ended. */
  answeredSinceLast: boolean
  /** Follow-ups left on the current question (belongs to last.personaId). */
  followUpsLeft: number
  lastInterruptAt: number
  lastCommentAt: number
  /** Latest "claim without evidence" moment from the live event engine, if any. */
  claimAt: number | null
  /** A nudge was already given for the current wait. */
  nudged: boolean
  /** In the speaker's latest turn: an agent they named (e.g. "Priya, what do you think?"). */
  addressedId: string | null
  /** In the speaker's latest turn: they asked the panel a question. */
  askedPanel: boolean
}

export interface Decision {
  personaId: string
  kind: LineKind
  reason: string
}

export const FLOOR = {
  /** Silence after any agent line before another agent may take the floor. */
  afterAgentGapS: 2,
  /** Panel-wide minimum time between interruptions. */
  interruptGapS: 45,
  /** No interruption until the speaker has had this long since the last agent line. */
  interruptGraceS: 20,
  /** Polite agents: brief rule, silence > 1.2 s and endOfThoughtProb > 0.7. */
  politeSilenceS: 1.2,
  politeEndProb: 0.7,
  /** Mid-pitch (not invited), a question waits for a clearly longer pause than a breath. */
  midPitchSilenceS: 2.4,
  /** Chance per tick of a short comment at a sentence end mid-pitch, and the gap between comments. */
  commentChancePerTick: 0.05,
  commentGapS: 40,
  /** An unanswered question: nudge after this much silence. */
  nudgeAfterS: 9,
  /** After an agent replies or comments, the speaker gets this long to respond before anyone asks. */
  afterReactionS: 5,
}

/** Agents that spoke least go first; never the same agent twice in a row unless following up. */
function pickAgent(agents: AgentSlot[], exclude: string | null, rand: () => number, filter: (a: AgentSlot) => boolean = () => true) {
  const pool = agents.filter((a) => a.persona.id !== exclude && filter(a))
  if (!pool.length) return null
  const fewest = Math.min(...pool.map((a) => a.turns))
  const least = pool.filter((a) => a.turns === fewest)
  return least[Math.floor(rand() * least.length)]
}

export function decide(i: FloorInput, rand: () => number = Math.random): Decision | null {
  const { room, now, last } = i
  if (i.agentSpeaking) return null
  const sinceAgent = last ? now - last.end : Infinity
  if (sinceAgent < FLOOR.afterAgentGapS) return null

  // ---- The speaker is talking: only interrupters, and only for a reason. ----
  if (room.userSpeaking) {
    if (now - i.lastInterruptAt < FLOOR.interruptGapS || sinceAgent < FLOOR.interruptGraceS) return null
    const freshClaim = i.claimAt !== null && now - i.claimAt < 4
    const candidates = i.agents.filter(
      (a) =>
        a.traits.canInterrupt &&
        (room.monologueSec > a.traits.patienceSec || room.ramblingScore > 0.7 || (freshClaim && a.traits.evidenceMinded)),
    )
    if (!candidates.length) return null
    // The least patient interrupter cuts in.
    const who = [...candidates].sort((a, b) => a.traits.patienceSec - b.traits.patienceSec)[0]
    const reason = freshClaim && who.traits.evidenceMinded ? 'unsupported claim' : room.ramblingScore > 0.7 ? 'rambling' : 'long monologue'
    return { personaId: who.persona.id, kind: 'interjection', reason }
  }

  // ---- The speaker is quiet. ----
  const asked = last && (last.kind === 'question' || last.kind === 'follow_up' || last.kind === 'interjection')
  if (asked && !i.answeredSinceLast) {
    // Waiting for an answer: nobody piles on; the asker nudges once after a long silence.
    if (!i.nudged && sinceAgent > FLOOR.nudgeAfterS) return { personaId: last.personaId, kind: 'nudge', reason: 'long silence after a question' }
    return null
  }
  // After a nudge, give the speaker time before anyone else takes the floor.
  if (last?.kind === 'nudge' && !i.answeredSinceLast && sinceAgent < FLOOR.nudgeAfterS) return null
  // After a reaction (a reply or comment), let the speaker respond before another agent asks.
  if ((last?.kind === 'reply' || last?.kind === 'comment') && !i.answeredSinceLast && sinceAgent < FLOOR.afterReactionS) return null

  const invited = room.invitedQuestions || i.askedPanel || i.addressedId !== null
  const floorOpen = invited ? room.silenceSec > 0.8 : room.silenceSec > FLOOR.politeSilenceS && room.endOfThoughtProb > FLOOR.politeEndProb
  if (!floorOpen) return null

  // Spoken to directly: the named agent answers (or anyone, for a question to the whole panel).
  if (i.addressedId || i.askedPanel) {
    const named = i.addressedId ? i.agents.find((a) => a.persona.id === i.addressedId) : undefined
    const who = named ?? pickAgent(i.agents, null, rand)
    if (who) return { personaId: who.persona.id, kind: i.askedPanel ? 'reply' : 'follow_up', reason: named ? `addressed by name` : 'asked the panel' }
  }

  // After an answer: the asker may follow up, or someone else reacts or asks.
  if (asked && i.answeredSinceLast) {
    const asker = i.agents.find((a) => a.persona.id === last.personaId)
    const followChance = asker ? 0.45 + 0.1 * (asker.persona.strictness - 3) : 0
    if (asker && i.followUpsLeft > 0 && rand() < followChance) return { personaId: asker.persona.id, kind: 'follow_up', reason: 'presses on the answer' }
    if (rand() < 0.3 && now - i.lastCommentAt > 8) {
      const who = pickAgent(i.agents, last.personaId, rand)
      if (who) return { personaId: who.persona.id, kind: 'comment', reason: 'reacts to the answer' }
    }
    const who = pickAgent(i.agents, last.personaId, rand)
    return who ? { personaId: who.persona.id, kind: 'question', reason: 'next question' } : null
  }

  // Mid-pitch (not invited): a breath at a sentence end gets, rarely, a short comment;
  // a clearly longer pause gets a question.
  if (!invited && room.silenceSec < FLOOR.midPitchSilenceS) {
    if (now - i.lastCommentAt > FLOOR.commentGapS && rand() < FLOOR.commentChancePerTick) {
      const who = pickAgent(i.agents, last?.personaId ?? null, rand)
      if (who) return { personaId: who.persona.id, kind: 'comment', reason: 'reacts mid-pitch' }
    }
    return null
  }
  const who = pickAgent(i.agents, last?.personaId ?? null, rand)
  return who ? { personaId: who.persona.id, kind: 'question', reason: invited ? 'invited to ask' : 'pause in the pitch' } : null
}
