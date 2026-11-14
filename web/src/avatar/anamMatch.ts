// Which Anam avatar and voice each agent uses. Agents with their own ids (Persona.anamAvatarId /
// anamVoiceId) keep them; the others are matched by the server (gender, then appearance), never
// repeating a face on the same panel.
import { postJson } from '../api'
import { personaGender } from '../lib/media'
import { PORTRAIT_STYLE } from '../personas'
import type { Persona } from '../types'

export interface AnamMatch {
  avatarId: string
  avatarName?: string
  voiceId: string
  voiceName?: string
  /** Anam's still of the avatar */
  portrait?: string
  /** true when the id came from the persona itself */
  fixed: boolean
}

/** Appearance only; the shared fal portrait style would skew the match. */
export const appearance = (p: Persona) => p.look.replace(PORTRAIT_STYLE, '').trim()

export async function matchAnamAvatars(personas: Persona[]): Promise<AnamMatch[]> {
  const { agents } = await postJson<{ agents: AnamMatch[] }>(
    '/api/avatar/anam-match',
    {
      agents: personas.map((p) => ({
        name: p.name,
        gender: personaGender(p),
        look: appearance(p),
        avatarId: p.anamAvatarId,
        voiceId: p.anamVoiceId,
      })),
    },
    20000,
  )
  return agents
}

/** Writes the matched ids into the personas, so the live session uses exactly what setup showed. */
export function withAnamIds(personas: Persona[], matches: AnamMatch[] | null): Persona[] {
  if (!matches || matches.length !== personas.length) return personas
  return personas.map((p, i) => ({ ...p, anamAvatarId: p.anamAvatarId || matches[i].avatarId, anamVoiceId: p.anamVoiceId || matches[i].voiceId }))
}
