// Past sessions (/#/sessions): progress across attempts and every saved session, each opening its report.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getJson } from '../api'
import { verdict } from '../eval/playback/ScoreOverview'
import { formatTime } from '../eval/metrics'
import { TopNav } from './Chrome'

interface Item {
  id: string
  startedAt: string
  title: string
  overall: number | null
  scale: number
  notScored: boolean
  panel: string | null
  format: string
  duration: number | null
  questions: number
  scores: { eye: number; body: number; tone: number; coherency: number; overall: number; timing: number | null; unmeasured: string[] } | null
}

type Metric = 'overall' | 'eye' | 'body' | 'tone' | 'coherency' | 'timing'
const METRICS: { key: Metric; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'eye', label: 'Eye contact' },
  { key: 'body', label: 'Body language' },
  { key: 'tone', label: 'Voice' },
  { key: 'coherency', label: 'Clarity' },
  { key: 'timing', label: 'Timing' },
]

/** Overall on the 0–100 scale (older reports are 0–10), or null when the session was not scored. */
const overall100 = (i: Item) => (i.overall === null || i.notScored ? null : Math.round(i.scale === 100 ? i.overall : i.overall * 10))

function value(i: Item, m: Metric): number | null {
  if (m === 'overall') return overall100(i)
  if (!i.scores || i.notScored) return null
  if (m === 'timing') return i.scores.timing
  return i.scores.unmeasured.includes(m) ? null : Math.round(i.scores[m])
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const dayTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

interface Props {
  onOpen: (id: string) => void
  onNew: () => void
}

export function History({ onOpen, onNew }: Props) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState(false)
  const [metric, setMetric] = useState<Metric>('overall')
  const [panel, setPanel] = useState<string>('all')
  // The trend animates only the first time each metric + panel view is opened on this visit.
  const seenCharts = useRef(new Set<string>())
  const chartKey = `${metric}|${panel}`
  const animateChart = !seenCharts.current.has(chartKey)

  useEffect(() => {
    getJson<Item[]>('/api/sessions', 10000).then(setItems, () => {
      setItems([])
      setError(true)
    })
  }, [])

  const panels = useMemo(() => [...new Set((items ?? []).map((i) => i.panel).filter((p): p is string => Boolean(p)))], [items])
  const shown = useMemo(() => (items ?? []).filter((i) => panel === 'all' || i.panel === panel), [items, panel])
  // Oldest first for the chart and the "vs previous" comparison.
  const points = useMemo(
    () =>
      [...shown]
        .reverse()
        .map((i) => ({ item: i, v: value(i, metric) }))
        .filter((p): p is { item: Item; v: number } => p.v !== null),
    [shown, metric],
  )
  const latest = points[points.length - 1]
  const previous = points[points.length - 2]
  const best = points.reduce<{ item: Item; v: number } | null>((b, p) => (!b || p.v > b.v ? p : b), null)
  const average = points.length ? Math.round(points.reduce((s, p) => s + p.v, 0) / points.length) : null
  const metricLabel = METRICS.find((m) => m.key === metric)!.label

  return (
    <div className="rp">
      <TopNav active="past" onPractice={onNew} />
      <div className="rp-wrap">
        <div className="rp-heading">
          <div>
            <h1>Past sessions</h1>
            <p className="rp-meta">
              {items === null ? 'Loading…' : `${items.length} ${items.length === 1 ? 'session' : 'sessions'} saved on this machine`}
            </p>
          </div>
          <button className="rp-btn-primary" onClick={onNew}>
            New session
          </button>
        </div>

        {items !== null && items.length === 0 ? (
          <section className="rp-card hs-empty">
            <h2>No sessions yet</h2>
            <p className="rp-muted">{error ? 'The session list could not be loaded. Is the server running?' : 'Finish a practice session and it will appear here, with your progress over time.'}</p>
            <button className="rp-btn-primary" onClick={onNew}>
              Start practising
            </button>
          </section>
        ) : (
          items && (
            <>
              <div className="hs-filters" role="group" aria-label="Filters">
                <div className="hs-chips" role="radiogroup" aria-label="Score">
                  {METRICS.map((m) => (
                    <button key={m.key} className={metric === m.key ? 'on' : ''} role="radio" aria-checked={metric === m.key} onClick={() => setMetric(m.key)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {panels.length > 1 && (
                  <select value={panel} onChange={(e) => setPanel(e.target.value)} aria-label="Panel">
                    <option value="all">All panels</option>
                    {panels.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="hs-stats">
                <div className="rp-kpi">
                  <span className="label">Latest</span>
                  <span className="value">{latest ? latest.v : '—'}</span>
                  <span className="status">
                    {latest && previous ? `${latest.v - previous.v >= 0 ? '▲ +' : '▼ '}${latest.v - previous.v} vs previous` : latest ? 'First scored session' : 'Not scored yet'}
                  </span>
                </div>
                <div className="rp-kpi">
                  <span className="label">Best</span>
                  <span className="value">{best ? best.v : '—'}</span>
                  <span className="status">{best ? day(best.item.startedAt) : '—'}</span>
                </div>
                <div className="rp-kpi">
                  <span className="label">Average</span>
                  <span className="value">{average ?? '—'}</span>
                  <span className="status">
                    over {points.length} scored {points.length === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
                <div className="rp-kpi">
                  <span className="label">Sessions</span>
                  <span className="value">{shown.length}</span>
                  <span className="status">{shown.length - points.length} not scored</span>
                </div>
              </div>

              <section className="rp-card">
                <h2>{metricLabel} over time</h2>
                <p className="rp-muted small" style={{ margin: '4px 0 12px' }}>
                  Each dot is one session, oldest on the left. Hover for details, click to open the report.
                </p>
                {points.length >= 2 ? (
                  <ProgressChart key={chartKey} points={points} onOpen={onOpen} animate={animateChart} onShown={() => seenCharts.current.add(chartKey)} />
                ) : (
                  <p className="rp-muted hs-chart-empty">Score at least two sessions to see your progress.</p>
                )}
              </section>

              <section className="rp-card">
                <h2>All sessions</h2>
                <div className="hs-table" role="table" aria-label="Sessions">
                  <div className="hs-row head" role="row">
                    <span role="columnheader">Date</span>
                    <span role="columnheader">Session</span>
                    <span role="columnheader">Overall</span>
                    <span role="columnheader" className="cats">
                      <span>Eye</span>
                      <span>Body</span>
                      <span>Voice</span>
                      <span>Clarity</span>
                      <span>Timing</span>
                    </span>
                    <span role="columnheader" />
                  </div>
                  {shown.map((i) => {
                    const o = overall100(i)
                    const v = o === null ? null : verdict(o)
                    const cat = (m: Metric) => value(i, m) ?? '–'
                    return (
                      <div key={i.id} className="hs-row" role="row">
                        <span role="cell" className="date">
                          {dayTime(i.startedAt)}
                        </span>
                        <span role="cell" className="what">
                          <strong>{i.title}</strong>
                          <span>
                            {[i.panel, i.format === 'interactive' ? 'Interactive' : 'Pitch, then questions', i.duration ? formatTime(i.duration) : null, i.questions ? `${i.questions} ${i.questions === 1 ? 'question' : 'questions'}` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span role="cell" className="overall">
                          <b>{o ?? '–'}</b>
                          <span className={`rp-verdict ${v ? v.tone : 'muted'}`}>{v ? v.label : 'Not scored'}</span>
                        </span>
                        <span role="cell" className="cats num">
                          {(['eye', 'body', 'tone', 'coherency', 'timing'] as Metric[]).map((m) => (
                            <span key={m}>{i.scores && !i.notScored ? cat(m) : '–'}</span>
                          ))}
                        </span>
                        <span role="cell">
                          <button className="rp-btn" onClick={() => onOpen(i.id)}>
                            Open report
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            </>
          )
        )}
      </div>
    </div>
  )
}

/** One series over attempts: 2px line, 8px dots ringed in the surface colour, recessive 0–100 grid, hover tooltip. */
function ProgressChart({
  points,
  onOpen,
  animate,
  onShown,
}: {
  points: { item: Item; v: number }[]
  onOpen: (id: string) => void
  animate: boolean
  /** Called once the chart has actually appeared, so this view is marked as seen only then. */
  onShown: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  // Decided once when the chart appears, so later re-renders (hover) never cut the animation short.
  const [animated] = useState(animate)
  useEffect(() => {
    onShown()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const H = 240
  const pad = { l: 36, r: 16, t: 12, b: 28 }
  const w = Math.max(200, width)
  const x = (i: number) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (w - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  // About 0.15 s per session, between 0.8 s and 2.4 s in total.
  const drawSec = Math.min(2.4, Math.max(0.8, points.length * 0.15))
  // Date labels: first, last and a few in between, never crowded.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((w - pad.l - pad.r) / 90))))
  const nearest = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    const px = clientX - r.left
    let best = 0
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    })
    return best
  }
  const h = hover === null ? null : points[hover]
  // All on one day: label by time of day instead of repeating the date.
  const oneDay = new Set(points.map((p) => new Date(p.item.startedAt).toDateString())).size === 1
  const tick = (iso: string) => (oneDay ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : day(iso))
  return (
    <div
      ref={box}
      className={`hs-chart${animated ? '' : ' static'}`}
      onMouseMove={(e) => setHover(nearest(e.clientX))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => onOpen(points[nearest(e.clientX)].item.id)}
    >
      <svg width={w} height={H} role="img" aria-label="Score over sessions">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={w - pad.r} y1={y(g)} y2={y(g)} className="grid" />
            <text x={pad.l - 8} y={y(g) + 4} className="axis" textAnchor="end">
              {g}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={p.item.id} x={x(i)} y={H - 8} className="axis" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
              {tick(p.item.startedAt)}
            </text>
          ) : null,
        )}
        {h && <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={H - pad.b} className="cross" />}
        {/* The line draws from the left; each dot pops in as the line reaches it. */}
        <path d={path} className="line" pathLength={1} style={{ animationDuration: `${drawSec}s` }} />
        {points.map((p, i) => (
          <circle
            key={p.item.id}
            cx={x(i)}
            cy={y(p.v)}
            r={hover === i ? 6 : 4}
            className="dot"
            style={{ animationDelay: `${(points.length > 1 ? i / (points.length - 1) : 0) * drawSec}s` }}
          />
        ))}
      </svg>
      {h && (
        <div className="hs-tip" style={{ left: Math.min(Math.max(x(hover!), 90), w - 90), top: y(h.v) - 12 }}>
          <div>
            <strong>{h.v}</strong> · {verdict(h.v).label}
          </div>
          <span>
            {h.item.title} · {dayTime(h.item.startedAt)}
          </span>
        </div>
      )}
    </div>
  )
}
