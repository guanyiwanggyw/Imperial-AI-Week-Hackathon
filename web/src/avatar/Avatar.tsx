import { initials } from '../lib/media'
import type { Persona } from '../types'
import { avatarSlotId, useAvatarState, type MainAvatar } from './mainAvatar'

interface Props {
  avatar: MainAvatar
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
 * The main avatar tile. Fills its parent. The video element is always mounted because Anam
 * streams into it by id; it is shown once the live session is playing. Until then, or in the
 * voice fallback, the persona's portrait is shown and pulses while the voice is speaking.
 * Render exactly one <Avatar> per MainAvatar.
 */
export function Avatar({ avatar, persona, portrait, children }: Props) {
  const state = useAvatarState(avatar)
  const live = state.status === 'live' && state.personaId === persona.id
  const speaking = state.speakingId === persona.id
  return (
    <div className={`main-avatar ${speaking ? 'speaking' : ''}`}>
      {!live && (
        <div className="still">
          {children ?? (portrait ? <img src={portrait} alt="" /> : <div className="initials">{initials(persona.name)}</div>)}
        </div>
      )}
      {/* The live driver appends its own <video> here; hidden until the session is playing. */}
      <div id={avatarSlotId} className="avatar-slot" style={{ display: live ? 'block' : 'none' }} />
      {state.status !== 'idle' && <span className={`avatar-badge ${state.status}`}>{LABEL[state.status]}</span>}
    </div>
  )
}
