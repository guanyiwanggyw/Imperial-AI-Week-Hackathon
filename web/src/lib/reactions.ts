// How each panelist reacts to live session events (micro-expressions during the pitch).
import type { EventType, Persona, Reaction, SessionEvent } from '../types'

const TRIGGERS: Partial<Record<EventType, Partial<Record<Reaction, number>>>> = {
  strong_moment: { nod: 1, smile: 0.7 },
  evidence_given: { nod: 0.9 },
  eye_contact_regained: { nod: 0.4, smile: 0.3 },
  slide_changed: { nod: 0.25 },
  filler_burst: { frown: 0.6, glance: 0.5 },
  long_pause: { glance: 0.6, frown: 0.3 },
  fast_pace: { frown: 0.7 },
  slow_pace: { glance: 0.7 },
  monotone_stretch: { glance: 0.8 },
  eye_contact_lost: { glance: 0.5, sceptical: 0.4 },
  claim_without_evidence: { sceptical: 1, frown: 0.6 },
}

/** Decides how one persona reacts to an event, or not at all. Strictness damps positive reactions. */
export function chooseReaction(persona: Persona, event: SessionEvent, rand = Math.random): Reaction | null {
  const triggers = TRIGGERS[event.type]
  if (!triggers) return null
  let best: Reaction | null = null
  let bestP = 0
  for (const [reaction, weight] of Object.entries(triggers) as [Reaction, number][]) {
    let p = persona.expression[reaction] * weight
    if (reaction === 'nod' || reaction === 'smile') p *= 1.2 - persona.strictness * 0.12
    if (p > bestP) {
      bestP = p
      best = reaction
    }
  }
  return best && rand() < bestP ? best : null
}

export const REACTION_LABEL: Record<Reaction, string> = {
  nod: 'nods',
  smile: 'smiles',
  frown: 'frowns slightly',
  glance: 'glances away',
  sceptical: 'looks sceptical',
}
