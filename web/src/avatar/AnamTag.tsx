import type { AnamMatch } from './anamMatch'

/**
 * One agent's Anam avatar: thumbnail and name. Ids are deliberately not shown in the UI; they live
 * in web/src/personas.ts (built-in agents) and are matched on the server (custom agents).
 */
export function AnamTag({ match }: { match: AnamMatch | undefined }) {
  if (!match) return <span className="anam-tag faint">Live avatar: matching…</span>
  return (
    <span className="anam-tag" title={`Live avatar ${match.avatarName ?? ''} · voice ${match.voiceName ?? ''}`}>
      {match.portrait && <img src={match.portrait} alt="" />}
      <span>
        Live avatar: {match.avatarName ?? 'matched'}
        {match.voiceName && <span className="faint"> · voice {match.voiceName.split(/\s[-–]\s/)[0]}</span>}
      </span>
    </span>
  )
}
