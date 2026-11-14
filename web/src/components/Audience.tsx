import { Avatar } from '../avatar/Avatar'
import { useAvatarState, type PanelAvatars } from '../avatar/panelAvatars'
import { REACTION_LABEL } from '../lib/reactions'
import { initials, portraitKey, reactionKey, type Assets } from '../lib/media'
import type { Persona, Reaction } from '../types'

export interface ActiveReaction {
  reaction: Reaction
  id: number
}

interface Props {
  personas: Persona[]
  assets: Assets
  backdrop: string | null
  reactions: Record<string, ActiveReaction | undefined>
  onReactionEnd: (personaId: string) => void
  /** Q&A: the persona currently asking, shown large */
  activeId: string | null
  /** Every agent's live avatar; each seat renders its own <Avatar>. */
  avatars: PanelAvatars
  /** Extra speaking highlight for voices outside the avatar (the ElevenLabs agent mode). */
  speakingId?: string | null
}

/**
 * The panel. Every seat is a live Anam avatar that idles while listening. A seat whose avatar is not
 * live (connecting, or the voice fallback) shows the agent's portrait, which reacts with a generated
 * clip (or a subtle CSS motion if no clip exists). During Q&A the asking agent is shown large, and
 * the seat whose voice is audible is highlighted.
 */
export function Audience({ personas, assets, backdrop, reactions, onReactionEnd, activeId, avatars, speakingId }: Props) {
  const state = useAvatarState(avatars)
  const focus = activeId !== null
  return (
    <div
      className={`audience n${personas.length} ${focus ? 'focus' : ''}`}
      style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}
      aria-label="Audience"
    >
      {personas.map((p) => {
        const r = reactions[p.id]
        const clip = r ? assets[reactionKey(p, r.reaction)] : undefined
        const portrait = assets[portraitKey(p)]
        // A live avatar has its own idle motion; reaction clips would cover it.
        const showReaction = r && state.seats[p.id]?.status !== 'live'
        const face = (
          <>
            <div className={`face ${showReaction && !clip ? r.reaction : ''}`} key={showReaction && !clip ? r.id : 'still'} onAnimationEnd={() => onReactionEnd(p.id)}>
              {portrait ? <img src={portrait} alt="" /> : <div className="initials">{initials(p.name)}</div>}
            </div>
            {showReaction && clip && <video key={r.id} src={clip} autoPlay muted playsInline onEnded={() => onReactionEnd(p.id)} onError={() => onReactionEnd(p.id)} />}
          </>
        )
        return (
          <div key={p.id} className={`seat ${p.id === activeId ? 'active' : ''} ${state.speakingId === p.id || speakingId === p.id ? 'speaking' : ''}`}>
            <div className="tile">
              <Avatar avatars={avatars} persona={p} portrait={portrait}>
                {face}
              </Avatar>
              <div className="nameplate">
                <div className="reaction">{showReaction && !focus ? REACTION_LABEL[r.reaction] : ''}</div>
                <div className="name">
                  {p.name} <span className="role">· {p.role}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
