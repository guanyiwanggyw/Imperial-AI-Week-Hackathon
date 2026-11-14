// How each agent behaves in the interactive session, from its persona (explicit fields win,
// otherwise derived from strictness). Brief starter cast: patience 45–300 s, follow-ups 0–3.
import type { Persona } from '../types'

export interface Traits {
  /** May cut in while the speaker is still talking. */
  canInterrupt: boolean
  /** Seconds of monologue tolerated before cutting in. */
  patienceSec: number
  /** Follow-ups on its own question before letting go. */
  followUps: number
  /** Keeps talking when the speaker talks over it ("let me finish"). */
  stubborn: boolean
  /** Pushes on evidence, so an unsupported claim is a reason to cut in. */
  evidenceMinded: boolean
}

const PATIENCE = [240, 180, 150, 110, 75]

export function traits(p: Persona): Traits {
  const s = Math.min(5, Math.max(1, Math.round(p.strictness)))
  return {
    canInterrupt: p.canInterrupt ?? s >= 4,
    patienceSec: p.patienceSec ?? PATIENCE[s - 1],
    followUps: p.followUps ?? (s >= 4 ? 2 : 1),
    stubborn: s >= 5,
    evidenceMinded: p.focus.some((f) => /evidence|traction|numbers?|market|feasib|risk|data/i.test(f)),
  }
}
