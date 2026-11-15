// Executive summary for the top of the report: the overall score with a plain verdict, the one-line summary,
// and one KPI tile per evaluation category. Detailed breakdowns live further down the page.
import type { Report } from '../../types'
import type { EvaluationResult, ScoreCat } from '../contracts'

export function verdict(score: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (score >= 85) return { label: 'Excellent', tone: 'good' }
  if (score >= 70) return { label: 'Strong', tone: 'good' }
  if (score >= 50) return { label: 'Developing', tone: 'warn' }
  return { label: 'Needs work', tone: 'bad' }
}

const band = (v: number) => (v >= 70 ? 'good' : v >= 50 ? 'warn' : 'bad')
const STATUS = { good: 'On track', warn: 'Improve', bad: 'Focus here' } as const

interface Props {
  report: Report
  ev: EvaluationResult | null
  /** Older 0–10 reports are scaled by 10. */
  k: number
}

/** Overall score, verdict and summary sentence. */
export function ScoreHero({ report, ev, k }: Props) {
  const scored = !report.insufficientSpeech
  const overall = Math.round(report.overall * k)
  const v = verdict(overall)
  const summary = report.content?.summary ?? ev?.coaching.summary ?? (report.contentError ? `Content evaluation unavailable: ${report.contentError}.` : null)
  return (
    <div className="rp-hero">
      <div className="rp-hero-score">
        <span className="rp-eyebrow">Overall score</span>
        <div className="num">
          <span className={`big ${scored ? '' : 'muted'}`}>{scored ? overall : '–'}</span>
          <span className="out">/100</span>
        </div>
        <span className={`rp-verdict ${scored ? v.tone : 'muted'}`}>{scored ? v.label : 'Not scored'}</span>
      </div>
      <div className="rp-hero-text">
        <span className="rp-eyebrow">Summary</span>
        <p>{summary ?? 'Your measured delivery is below. Add an Anthropic key for content feedback.'}</p>
      </div>
    </div>
  )
}

const TILES: { key: ScoreCat | 'timing'; label: string }[] = [
  { key: 'eye', label: 'Eye contact' },
  { key: 'body', label: 'Body language' },
  { key: 'tone', label: 'Voice' },
  { key: 'coherency', label: 'Clarity' },
  { key: 'timing', label: 'Timing' },
]

/** One tile per category: score, a bar in the feedback colour, and a status word. */
export function KpiTiles({ ev }: { ev: EvaluationResult }) {
  return (
    <div className="rp-kpis" role="list">
      {TILES.map(({ key, label }) => {
        const value = key === 'timing' ? ev.timingScore : ev.unmeasured.includes(key) ? null : ev.finalScores[key]
        const tone = value === null ? null : band(value)
        return (
          <div key={key} className={`rp-kpi ${tone ?? 'muted'}`} role="listitem">
            <span className="label">{label}</span>
            <span className="value">{value === null ? '—' : value}</span>
            <div className="track">{value !== null && <div className="fill" style={{ width: `${value}%` }} />}</div>
            <span className="status">{tone ? STATUS[tone] : 'Not measured'}</span>
          </div>
        )
      })}
    </div>
  )
}
