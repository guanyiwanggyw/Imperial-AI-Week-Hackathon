import { initials } from '../lib/media'
import type { Persona } from '../types'
import { avatarSlotId, useAvatarState, type PanelAvatars } from './panelAvatars'

interface Props {
  avatars: PanelAvatars
  persona: Persona
  /** Still face shown while connecting and in the voice fallback (Synthesia or fal portrait). */
  portrait?: string
  /** Replaces the default still face, e.g. a portrait with reaction clips during the pitch. */
  children?: React.ReactNode
}

const LABEL: Record<string, string> = {
  connecting: 'Connecting avatar',
  live: 'Live',
  fallback: 'Voice only',
}

/**
 * One agent's avatar tile. Fills its parent. The slot is always mounted because the agent's Anam
 * session streams into it by id; it is shown once that session is playing. Until then, or in the
 * voice fallback, the agent's portrait is shown and pulses while the voice is speaking.
 * Render exactly one <Avatar> per agent.
 */
export function Avatar({ avatars, persona, portrait, children }: Props) {
  const state = useAvatarState(avatars)
  const seat = state.seats[persona.id]
  const live = seat?.status === 'live'
  const speaking = state.speakingId === persona.id
  return (
    <div className={`main-avatar ${speaking ? 'speaking' : ''}`}>
      {!live && (
        <div className="still">
          {children ?? (portrait ? <img src={portrait} alt="" /> : <div className="initials">{initials(persona.name)}</div>)}
        </div>
      )}
      {/* The live driver appends its own <video> here; hidden until the session is playing. */}
      <div id={avatarSlotId(persona.id)} className="avatar-slot" style={{ display: live ? 'block' : 'none' }} />
      {seat && seat.status !== 'idle' && (
        <span className={`avatar-badge ${seat.status}`} title={seat.error ?? undefined}>
          {LABEL[seat.status]}
        </span>
      )}
    </div>
  )
}
