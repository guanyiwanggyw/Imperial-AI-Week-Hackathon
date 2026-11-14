import type { QnaMode } from '../lib/qna'
import { REACTION_LABEL } from '../lib/liveEvents'
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
  speaking: boolean
  mode: QnaMode | null
}

export const anamVideoId = (personaId: string) => `anam-video-${personaId}`

/**
 * The panel. During the pitch each seat shows a portrait that reacts with a generated clip
 * (or a subtle CSS motion if no clip exists). During Q&A the asking panelist is shown large,
 * as a live Anam avatar when available.
 */
export function Audience({ personas, assets, backdrop, reactions, onReactionEnd, activeId, speaking, mode }: Props) {
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
        const isActive = p.id === activeId
        const showAnam = isActive && mode === 'anam'
        return (
          <div key={p.id} className={`seat ${isActive ? 'active' : ''} ${isActive && speaking ? 'speaking' : ''}`}>
            <div className="tile">
              <div className={`face ${r && !clip ? r.reaction : ''}`} key={r && !clip ? r.id : 'still'} onAnimationEnd={() => onReactionEnd(p.id)}>
                {portrait ? <img src={portrait} alt="" /> : <div className="initials">{initials(p.name)}</div>}
              </div>
              {clip && !showAnam && (
                <video key={r!.id} src={clip} autoPlay muted playsInline onEnded={() => onReactionEnd(p.id)} onError={() => onReactionEnd(p.id)} />
              )}
              {/* Anam streams into this element; it stays mounted so the SDK can find it by id. */}
              <video id={anamVideoId(p.id)} autoPlay playsInline style={{ display: showAnam ? 'block' : 'none' }} />
            </div>
            <div className="name">
              {p.name} <span style={{ opacity: 0.75 }}>· {p.role}</span>
            </div>
            <div className="reaction">{r && !focus ? REACTION_LABEL[r.reaction] : ''}</div>
          </div>
        )
      })}
    </div>
  )
}
