import { Avatar } from '../avatar/Avatar'
import { useAvatarState, type MainAvatar } from '../avatar/mainAvatar'
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
  /** The live main avatar, rendered in the seat of mainId (the decision-maker). */
  avatar: MainAvatar
  mainId: string | undefined
  /** Extra speaking highlight for voices outside the avatar (the ElevenLabs agent mode). */
  speakingId?: string | null
}

/**
 * The panel. The decision-maker's seat is the main avatar: a live Anam video that idles while
 * listening, or the portrait in the voice fallback. Other seats show a portrait that reacts with
 * a generated clip (or a subtle CSS motion if no clip exists). During Q&A the asking panelist is
 * shown large, and the seat whose voice is audible is highlighted.
 */
export function Audience({ personas, assets, backdrop, reactions, onReactionEnd, activeId, avatar, mainId, speakingId }: Props) {
  const state = useAvatarState(avatar)
  const avatarLive = state.status === 'live'
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
        const isMain = p.id === mainId
        // The live avatar has its own idle motion; reaction clips would cover it.
        const showReaction = r && !(isMain && avatarLive)
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
              {isMain ? (
                <Avatar avatar={avatar} persona={p} portrait={portrait}>
                  {face}
                </Avatar>
              ) : (
                face
              )}
            </div>
            <div className="name">
              {p.name} <span style={{ opacity: 0.75 }}>· {p.role}</span>
            </div>
            <div className="reaction">{showReaction && !focus ? REACTION_LABEL[r.reaction] : ''}</div>
          </div>
        )
      })}
    </div>
  )
}
