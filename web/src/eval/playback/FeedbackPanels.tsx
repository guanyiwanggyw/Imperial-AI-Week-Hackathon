// Playback views of the evaluation for the report: the unified events list, live notes over the video, and
// score bars that follow the playhead (brief §3: "the overlay appears only in the playback").
import type { SessionData } from '../../types'
import type { EvaluationResult, FeedbackCat, FeedbackEvent, ScoreCat } from '../contracts'
import { SCORE_CATS } from '../contracts'

export const CAT_LABEL: Record<FeedbackCat, string> = {
  eye: 'Eye contact',
  body: 'Body language',
  tone: 'Voice',
  coherency: 'Clarity',
  timing: 'Timing',
  panel: 'Panel',
}

const SCORE_LABEL: Record<ScoreCat, string> = { eye: 'Eye contact', body: 'Body language', tone: 'Voice', coherency: 'Clarity' }

export interface EventItem {
  t: number
  end?: number
  /** question | good | warn | bad | neutral: drives the colour. */
  tone: 'question' | 'good' | 'warn' | 'bad' | 'neutral'
  title: string
  body?: string
  /** What the feedback is about (eye contact, body language, …). */
  tag?: string
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
/** Strips stray brackets or quotes a model sometimes leaves at either end (older saved sessions). */
const tidy = (s: string) => s.replace(/^[\s"'`[\]{}]+|[\s"'`[\]{}]+$/g, '')

/**
 * One time-ordered list for the report: the evaluation's feedback (rules live, Claude after) plus the session
 * milestones (questions, slide changes, pitch end). Older sessions without an evaluation keep the legacy events.
 */
export function eventItems(session: SessionData): EventItem[] {
  const ev = session.evaluation
  const milestones = session.events.filter((e) => ['question_asked', 'slide_changed', 'pitch_ended'].includes(e.type))
  const legacy = ev ? milestones : session.events.filter((e) => !['tool_called', 'answer_given', 'eye_contact_regained'].includes(e.type))
  const items: EventItem[] = legacy.map((e) => {
    if (e.type === 'question_asked') {
      // Question events carry "Persona: question text".
      const cut = e.detail ? e.detail.indexOf(': ') : -1
      return { t: e.t, tone: 'question', title: `Question asked${cut > 0 ? ` · ${e.detail!.slice(0, cut)}` : ''}`, body: cut > 0 ? e.detail!.slice(cut + 2) : e.detail }
    }
    return { t: e.t, tone: 'neutral', title: `${titleCase(e.type)}${e.detail ? ` · ${e.detail}` : ''}` }
  })
  for (const f of ev?.events ?? []) {
    items.push({ t: f.t, end: f.end, tone: f.severity, title: tidy(f.msg), tag: CAT_LABEL[f.cat] })
  }
  return items.sort((a, b) => a.t - b.t).slice(0, 150)
}

/** Feedback notes active at time t (point events stay up for 3 s). Worst first, at most two. */
export function activeNotes(events: FeedbackEvent[], t: number): FeedbackEvent[] {
  const rank = { bad: 0, warn: 1, good: 2 }
  return events
    .filter((e) => t >= e.t && t <= Math.max(e.end ?? e.t, e.t + 3))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.t - a.t)
    .slice(0, 2)
}

/** Notes drawn over the video while it plays: what was happening at this moment. */
export function LiveNotes({ events, t }: { events: FeedbackEvent[]; t: number }) {
  const notes = activeNotes(events, t)
  if (!notes.length) return null
  return (
    <div className="rp-notes" aria-live="polite">
      {notes.map((n, i) => (
        <div key={`${n.t}-${i}`} className={`rp-note ${n.severity}`}>
          <span className="cat">{CAT_LABEL[n.cat]}</span>
          <span>{tidy(n.msg)}</span>
        </div>
      ))}
    </div>
  )
}

/** Score bars at the playhead (rolling 10 s window), with the final score marked on each track. */
export function ScoresAt({ ev, t }: { ev: EvaluationResult; t: number }) {
  const len = ev.scoreSeries.eye.length
  if (!len || ev.insufficientSpeech) return null
  const i = Math.max(0, Math.min(len - 1, Math.floor(t)))
  return (
    <div className="rp-scores-at">
      <span className="rp-eyebrow">Scores at this moment</span>
      {SCORE_CATS.map((c) => {
        const unmeasured = ev.unmeasured.includes(c)
        const v = unmeasured ? null : ev.scoreSeries[c][i]
        const final = unmeasured ? null : ev.finalScores[c]
        return (
          <div key={c} className="row-bar" title={final === null ? 'Not measured' : `Final ${final}`}>
            <span>{SCORE_LABEL[c]}</span>
            <div className="track">
              {v !== null && <div className={`fill ${v >= 70 ? 'good' : v >= 45 ? 'warn' : 'bad'}`} style={{ width: `${v}%` }} />}
              {final !== null && <i style={{ left: `${final}%` }} aria-label={`Final ${final}`} />}
            </div>
            <span className="v">{v === null ? '–' : Math.round(v)}</span>
          </div>
        )
      })}
      <span className="rp-muted small">Rolling 10 s window. The thin mark is the final score.</span>
    </div>
  )
}
