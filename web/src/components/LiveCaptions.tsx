// Live captions for the practice screen: what you said (committed Scribe phrases plus the live
// partial) and what the panel said (revealed word by word as it is spoken), in time order.
// Read-only: the transcript comes from the evaluation engine (web/src/eval), the panel lines from
// the panel's avatars (web/src/avatar). Nothing here is scored.
import { useLayoutEffect, useRef } from 'react'
import type { CaptionLine } from '../avatar/panelAvatars'
import type { Phrase } from '../eval'
import type { Persona } from '../types'

interface Props {
  personas: Persona[]
  /** Committed phrases from the live transcript */
  phrases: Phrase[]
  /** Words heard but not yet committed */
  partial: string
  /** Panel lines (main avatar and voices, plus voice-agent lines) */
  lines: CaptionLine[]
  /** Shown when there is nothing to caption yet */
  placeholder?: string
  /** Shown instead of the placeholder when the transcriber failed */
  error?: string | null
  /** How many caption rows to keep on screen */
  rows?: number
}

type Row =
  | { key: string; who: 'you'; t: number; text: string; live: boolean }
  | { key: string; who: 'panel'; t: number; name: string; spoken: string; rest: string; live: boolean; interrupted: boolean }

/** Consecutive phrases of yours closer than this are joined into one caption row. */
const JOIN_GAP_S = 2.5

export function LiveCaptions({ personas, phrases, partial, lines, placeholder, error, rows = 4 }: Props) {
  const nameOf = (id: string) => personas.find((p) => p.id === id)?.name ?? 'Panel'

  // Your rows are placed by when the phrase ended (when its caption appears), so words you were
  // still saying while a panel line started show after that line instead of jumping above it.
  const yours: Extract<Row, { who: 'you' }>[] = []
  phrases.forEach((p, i) => {
    const last = yours[yours.length - 1]
    const gap = i > 0 ? p.t - phrases[i - 1].end : Infinity
    // Join with the previous row when you kept talking and no panel line came in between.
    if (last && gap < JOIN_GAP_S && !lines.some((l) => l.t > last.t && l.t < p.end)) {
      last.text += ` ${p.text}`
      last.t = p.end
    } else {
      yours.push({ key: `y${p.t}`, who: 'you', t: p.end, text: p.text, live: false })
    }
  })
  const panel: Row[] = lines.map((l) => ({
    key: `p${l.id}`,
    who: 'panel',
    t: l.t,
    name: nameOf(l.personaId),
    spoken: l.spoken,
    rest: l.done ? '' : l.text.slice(l.spoken.length),
    live: !l.done,
    interrupted: l.interrupted,
  }))
  const all = [...yours, ...panel].sort((a, b) => a.t - b.t)
  // Words still being recognised continue your last row, or start a new one after a panel line.
  if (partial.trim()) {
    const last = all[all.length - 1]
    if (last?.who === 'you') all[all.length - 1] = { ...last, live: true }
    else all.push({ key: 'partial', who: 'you', t: Infinity, text: '', live: true })
  }
  const shown = all.slice(-rows)

  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  })

  return (
    <div className="captions" ref={box} aria-live="polite" aria-label="Live captions">
      {shown.length === 0 && <div className="captions-empty">{error ? `Live transcript unavailable: ${error}` : (placeholder ?? '')}</div>}
      {shown.map((r) =>
        r.who === 'you' ? (
          <div key={r.key} className="caption you">
            <span className="who">You</span>
            <span>
              {r.text}
              {r.live && partial && <span className="partial"> {partial}</span>}
            </span>
          </div>
        ) : (
          <div key={r.key} className={`caption panel ${r.live ? 'live' : ''}`}>
            <span className="who">{r.name}</span>
            <span>
              {r.spoken}
              {r.interrupted && r.spoken && '…'}
              {r.live && <span className="caret" aria-hidden />}
              {/* The unspoken rest stays invisible but keeps the row height stable as words appear. */}
              {r.rest && <span className="unspoken" aria-hidden> {r.rest}</span>}
            </span>
          </div>
        ),
      )}
    </div>
  )
}
