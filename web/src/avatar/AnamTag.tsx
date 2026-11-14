import { useState } from 'react'
import type { AnamMatch } from './anamMatch'

/** One agent's Anam avatar: thumbnail, name and id. Click to copy the id. */
export function AnamTag({ match }: { match: AnamMatch | undefined }) {
  const [copied, setCopied] = useState(false)
  if (!match) return <span className="anam-tag faint">Anam avatar: matching…</span>
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(match.avatarId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked; the id is still selectable in the tooltip
    }
  }
  return (
    <button
      type="button"
      className="anam-tag"
      onClick={() => void copy()}
      title={`Anam avatar ${match.avatarName ?? ''} ${match.avatarId}\nVoice ${match.voiceName ?? ''} ${match.voiceId}\n${match.fixed ? 'Set on this agent' : 'Matched automatically'} · click to copy the avatar id`}
    >
      {match.portrait && <img src={match.portrait} alt="" />}
      <span>
        Anam: {match.avatarName ?? 'avatar'} · <code>{copied ? 'copied' : match.avatarId}</code>
      </span>
    </button>
  )
}
