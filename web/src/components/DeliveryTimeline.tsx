// "Delivery over time", three views of the same data: graph (default), strips and table.
// Strips: one status strip per signal, all on the same time axis. Each time window is a cell coloured
// by how it went (on target, a bit off, off target, not measured) with its value written inside, so it reads left to
// right without decoding a y-scale. Colour is never alone: every cell carries its value, the legend names the states,
// and pauses use two shapes. Above the strips, "moments to look at" chips jump the recording to where you drifted.
// One crosshair spans every row and one tooltip lists every signal at that moment; a playhead follows the recording;
// click anywhere to jump there. The graph view draws each signal as a line (or bars) on its own scale, with the target
// range shaded and each point coloured by the same status as the strips. A table view carries the same values.
import { useLayoutEffect, useRef, useState } from 'react'
import { formatTime } from '../eval/metrics'

export interface Point {
  t: number
  value: number | null
}

export type Verdict = { status: 'good' | 'warn' | 'bad' | 'none'; text: string }
export type CellStatus = 'good' | 'warn' | 'bad'

export interface TimelineRow {
  key: string
  label: string
  /** What good looks like, in plain words. */
  hint: string
  kind: 'line' | 'bars' | 'events'
  /** Window values (t = window start). Unused for events. */
  points: Point[]
  min: number
  max: number
  /** Target range. Used to rate a window when `status` is not given. */
  band?: [number, number]
  bandLabel?: string
  /** Value as words, for the tooltip and table. */
  format: (v: number) => string
  ticks?: number[]
  verdict: Verdict
  /** Shown in the strip when nothing could be measured. */
  emptyText?: string
  events?: { t: number; label: string; good: boolean }[]
  /** How one window went. Default: inside the band is good, outside is bad. */
  status?: (v: number) => CellStatus
  /** Short text inside a cell (default: `format`). */
  cell?: (v: number) => string
  /** What went wrong in an off-target window, as a phrase for the "moments to look at" chips (e.g. "Speaking too fast"). */
  drift?: (v: number) => string
}

interface Props {
  rows: TimelineRow[]
  duration: number
  windowSize: number
  slides: { t: number; label: string }[]
  playhead: number | null
  onSeek: (t: number) => void
}

const STRIP_H = 30
const ROW_H = 44
const GRAPH_H = 64
const PAD = 8
const GUTTER = 64 // y tick labels in the graph view ("expressive" fits)
type View = 'strips' | 'graph' | 'table'
const VIEWS: { key: View; label: string }[] = [
  { key: 'graph', label: 'Graph' },
  { key: 'strips', label: 'Strips' },
  { key: 'table', label: 'Table' },
]
const ICON = { good: '✓', warn: '!', bad: '!', none: '–' } as const
const STATUS_WORD: Record<CellStatus, string> = { good: 'on target', warn: 'a bit off', bad: 'off target' }

function tickStep(duration: number) {
  if (duration <= 40) return 10
  if (duration <= 120) return 20
  if (duration <= 300) return 60
  if (duration <= 900) return 120
  return 300
}

const rate = (row: TimelineRow, v: number): CellStatus => row.status?.(v) ?? (!row.band || (v >= row.band[0] && v <= row.band[1]) ? 'good' : 'bad')

interface Moment {
  t: number
  end: number
  text: string
  status: CellStatus
}

/** Off-target stretches (consecutive windows with the same problem merged), worst first, at most `max`. */
function moments(rows: TimelineRow[], windowSize: number, end: number, max = 4): Moment[] {
  const out: Moment[] = []
  for (const row of rows) {
    if (row.kind === 'events') {
      const bad = (row.events ?? []).filter((e) => !e.good)
      if (bad.length) out.push({ t: bad[0].t, end: bad[0].t, text: `${bad.length} hesitant ${bad.length === 1 ? 'pause' : 'pauses'}`, status: bad.length >= 3 ? 'bad' : 'warn' })
      continue
    }
    let cur: Moment | null = null
    for (const p of row.points) {
      const s = p.value === null ? 'good' : rate(row, p.value)
      const word = p.value !== null && s !== 'good' ? (row.drift?.(p.value) ?? `${row.label} ${STATUS_WORD[s]}`) : null
      if (word && cur && cur.text === word && Math.abs(cur.end - p.t) < 0.01) {
        cur.end = Math.min(p.t + windowSize, end)
        if (s === 'bad') cur.status = 'bad'
        continue
      }
      if (cur) out.push(cur)
      cur = word ? { t: p.t, end: Math.min(p.t + windowSize, end), text: word, status: s as CellStatus } : null
    }
    if (cur) out.push(cur)
  }
  const sev = { bad: 0, warn: 1, good: 2 }
  return out.sort((a, b) => sev[a.status] - sev[b.status] || b.end - b.t - (a.end - a.t) || a.t - b.t).slice(0, max).sort((a, b) => a.t - b.t)
}

export function DeliveryTimeline({ rows, duration, windowSize, slides, playhead, onSeek }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hoverT, setHoverT] = useState<number | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = localStorage.getItem('dt-view-v2')
      return v === 'strips' || v === 'table' ? v : 'graph'
    } catch {
      return 'graph'
    }
  })
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem('dt-view-v2', v)
    } catch {
      // per-viewer convenience only
    }
  }
  const table = view === 'table'
  const graph = view === 'graph'

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)))
    ro.observe(el)
    setWidth(Math.max(200, el.clientWidth))
    return () => ro.disconnect()
  }, [view])

  const end = Math.max(duration, 1)
  const G = graph ? GUTTER : 0
  const plotW = Math.max(1, width - G)
  const x = (t: number) => G + (Math.min(Math.max(t, 0), end) / end) * plotW
  const rowH = graph ? GRAPH_H : ROW_H
  /** In the graph, a window's value sits at the middle of the part of the window inside the pitch. */
  const mid = (t: number) => (t + Math.min(t + windowSize, end)) / 2
  const valueAt = (row: TimelineRow, t: number) => row.points.find((p) => t >= p.t && t < p.t + windowSize) ?? null
  const ticks: number[] = []
  for (let t = 0; t <= end + 0.01; t += tickStep(end)) ticks.push(t)
  const top = (ROW_H - STRIP_H) / 2

  const pointerT = (e: React.PointerEvent | React.MouseEvent) => {
    const plot = box.current?.getBoundingClientRect()
    if (!plot) return null
    const px = e.clientX - plot.left - G
    return px < 0 || px > plotW ? null : Math.min(end, Math.max(0, (px / plotW) * end))
  }

  const drifts = moments(rows, windowSize, end)

  return (
    <section className="section card delivery">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2>Delivery over time</h2>
        <div className="dt-views" role="radiogroup" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} role="radio" aria-checked={view === v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <p className="faint" style={{ margin: '4px 0 12px' }}>
        {graph
          ? 'Each graph is one part of your delivery over the pitch. The shaded band is the target range. Click any moment to watch it.'
          : table
            ? `Every ${windowSize}-second step of your pitch, with how each part of your delivery went.`
            : `Each strip is your pitch from start to finish, in ${windowSize}-second steps. Click any moment to watch it.`}
      </p>

      {!table && (
        <>
          <div className="dt-legend" aria-label="Legend">
            <span><i className="dt-key good" /> On target</span>
            <span><i className="dt-key warn" /> A bit off</span>
            <span><i className="dt-key bad" /> Off target</span>
            <span><i className="dt-key none" /> Not measured</span>
            {graph && (
              <span>
                <i className="dt-key band" /> Target range
              </span>
            )}
            {rows.some((r) => r.kind === 'events') && (
              <>
                <span><i className="dt-dot-key" /> Deliberate pause</span>
                <span><i className="dt-tri-key" /> Hesitant pause</span>
              </>
            )}
          </div>
          {drifts.length > 0 && (
            <div className="dt-moments">
              <span className="dt-moments-label">Moments to look at</span>
              {drifts.map((m) => (
                <button key={`${m.text}-${m.t}`} className={`dt-moment ${m.status}`} onClick={() => onSeek(m.t)}>
                  <span className="dt-icon" aria-hidden>
                    !
                  </span>
                  {m.text}
                  <span className="t">{m.end - m.t > 0.5 ? `${formatTime(m.t)}–${formatTime(m.end)}` : formatTime(m.t)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {table ? (
        <DeliveryTable rows={rows} duration={end} windowSize={windowSize} />
      ) : (
        <div
          className="dt"
          onPointerMove={(e) => {
            const t = pointerT(e)
            setHoverT(t)
            setTip(t === null ? null : { x: e.clientX, y: e.clientY })
          }}
          onPointerLeave={() => {
            setHoverT(null)
            setTip(null)
          }}
        >
          {rows.map((row) => {
            const measured = row.kind === 'events' ? true : row.points.some((p) => p.value !== null)
            const hatch = `dt-hatch-${row.key}`
            return (
              <div key={row.key} className="dt-row">
                <div className="dt-label">
                  <div>{row.label}</div>
                  <div className="faint small">{row.hint}</div>
                </div>
                <div className="dt-plot" ref={row === rows[0] ? box : undefined}>
                  <svg
                    width={width}
                    height={rowH}
                    role="img"
                    aria-label={`${row.label} over time. ${row.verdict.text}.`}
                    onClick={(e) => {
                      const t = pointerT(e)
                      if (t !== null) onSeek(t)
                    }}
                  >
                    <defs>
                      <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="6" height="6" className="dt-hatch-bg" />
                        <line x1="0" y1="0" x2="0" y2="6" className="dt-hatch-line" />
                      </pattern>
                    </defs>

                    {row.kind !== 'events' && graph && <GraphRow row={row} measured={measured} hatch={hatch} G={G} width={width} x={x} mid={mid} windowSize={windowSize} end={end} hoverT={hoverT} />}

                    {row.kind !== 'events' &&
                      !graph &&
                      (measured ? (
                        row.points.map((p) => {
                          const x0 = x(p.t) + 1
                          const w = Math.max(1, x(Math.min(p.t + windowSize, end)) - x(p.t) - 2)
                          const s = p.value === null ? null : rate(row, p.value)
                          // Full text when it fits, else just the first part ("232 · fast" → "232"), else nothing (tooltip).
                          const full = p.value === null ? '' : (row.cell ?? row.format)(p.value)
                          const fitsIn = (t: string) => t.length * 6.4 + 10 <= w
                          const text = fitsIn(full) ? full : fitsIn(full.split(' ')[0]) ? full.split(' ')[0] : ''
                          const fits = text !== ''
                          const hovered = hoverT !== null && hoverT >= p.t && hoverT < p.t + windowSize
                          return (
                            <g key={p.t}>
                              <rect
                                x={x0}
                                y={top}
                                width={w}
                                height={STRIP_H}
                                rx={4}
                                className={`dt-cell ${s ?? 'none'}${hovered ? ' hover' : ''}`}
                                fill={s ? undefined : `url(#${hatch})`}
                              />
                              {fits && (
                                <text x={x0 + w / 2} y={top + STRIP_H / 2 + 4} textAnchor="middle" className={`dt-cell-text ${s ?? 'none'}`}>
                                  {text}
                                </text>
                              )}
                            </g>
                          )
                        })
                      ) : (
                        <>
                          <rect x={1} y={top} width={width - 2} height={STRIP_H} rx={4} fill={`url(#${hatch})`} className="dt-cell none" />
                          <text x={width / 2} y={top + STRIP_H / 2 + 4} textAnchor="middle" className="dt-cell-text none">
                            {row.emptyText ?? 'Not measured'}
                          </text>
                        </>
                      ))}

                    {row.kind === 'events' && (
                      <>
                        <line x1={G} x2={width} y1={rowH / 2} y2={rowH / 2} className="dt-rail" />
                        {(row.events ?? []).map((ev) =>
                          ev.good ? (
                            <circle key={`${ev.t}-${ev.label}`} cx={x(ev.t)} cy={rowH / 2} r={6} className="dt-ev good">
                              <title>{`${formatTime(ev.t)} · ${ev.label}`}</title>
                            </circle>
                          ) : (
                            <path key={`${ev.t}-${ev.label}`} d={`M${x(ev.t)},${rowH / 2 - 7}L${x(ev.t) + 7},${rowH / 2 + 5}L${x(ev.t) - 7},${rowH / 2 + 5}Z`} className="dt-ev bad">
                              <title>{`${formatTime(ev.t)} · ${ev.label}`}</title>
                            </path>
                          ),
                        )}
                      </>
                    )}

                    {slides.map((s) => (
                      <line key={`s${s.t}`} x1={x(s.t)} x2={x(s.t)} y1={0} y2={rowH} className="dt-slide" />
                    ))}
                    {playhead !== null && playhead > 0 && <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={rowH} className="dt-playhead" />}
                    {hoverT !== null && <line x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={rowH} className="dt-crosshair" />}
                  </svg>
                </div>
                <div className={`dt-verdict ${row.verdict.status}`}>
                  <span className="dt-icon" aria-hidden>
                    {ICON[row.verdict.status]}
                  </span>
                  <span>{row.verdict.text}</span>
                </div>
              </div>
            )
          })}

          {/* shared time axis */}
          <div className="dt-row dt-axis-row">
            <div />
            <svg width={width} height={slides.length ? 30 : 18} aria-hidden>
              {ticks.map((t) => (
                <text key={t} x={x(t)} y={12} textAnchor={t === 0 ? 'start' : x(t) > width - 20 ? 'end' : 'middle'} className="dt-tick">
                  {formatTime(t)}
                </text>
              ))}
              {slides.map((s) => (
                <text key={s.t} x={x(s.t)} y={26} textAnchor="middle" className="dt-slide-label">
                  {s.label}
                </text>
              ))}
            </svg>
            <div className="faint small">time in the pitch</div>
          </div>
        </div>
      )}

      {tip && hoverT !== null && !table && (
        <div className="dt-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <div className="dt-tip-time">{formatTime(hoverT)}</div>
          {rows.map((row) => {
            let text: string
            let s: CellStatus | 'none' = 'none'
            if (row.kind === 'events') {
              const near = (row.events ?? []).filter((ev) => Math.abs(ev.t - hoverT) < Math.max(1.5, end / 80))
              text = near.length ? near.map((ev) => ev.label).join(', ') : '–'
              if (near.length) s = near.some((e) => !e.good) ? 'warn' : 'good'
            } else {
              const p = valueAt(row, hoverT)
              text = p?.value == null ? 'not measured' : row.format(p.value)
              if (p?.value != null) s = rate(row, p.value)
            }
            return (
              <div key={row.key} className="dt-tip-row">
                <span>
                  <i className={`dt-key ${s}`} /> {row.label}
                </span>
                <strong>{text}</strong>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** One signal as a graph: target band, y-scale, line with status-coloured points (or bars), crosshair point. */
function GraphRow({
  row,
  measured,
  hatch,
  G,
  width,
  x,
  mid,
  windowSize,
  end,
  hoverT,
}: {
  row: TimelineRow
  measured: boolean
  hatch: string
  G: number
  width: number
  x: (t: number) => number
  mid: (t: number) => number
  windowSize: number
  end: number
  hoverT: number | null
}) {
  const H = GRAPH_H
  if (!measured) {
    return (
      <>
        <rect x={G + 1} y={PAD} width={width - G - 2} height={H - 2 * PAD} rx={4} fill={`url(#${hatch})`} className="dt-cell none" />
        <text x={G + (width - G) / 2} y={H / 2 + 4} textAnchor="middle" className="dt-cell-text none">
          {row.emptyText ?? 'Not measured'}
        </text>
      </>
    )
  }
  const y = (v: number) => PAD + (1 - (Math.min(row.max, Math.max(row.min, v)) - row.min) / (row.max - row.min || 1)) * (H - 2 * PAD)
  // Lines break where the signal was not measured.
  const segments: { t: number; v: number }[][] = []
  let cur: { t: number; v: number }[] = []
  for (const p of row.points) {
    if (p.value === null) {
      if (cur.length) segments.push(cur)
      cur = []
    } else cur.push({ t: mid(p.t), v: p.value })
  }
  if (cur.length) segments.push(cur)
  const hovered = hoverT === null ? null : (row.points.find((p) => hoverT >= p.t && hoverT < p.t + windowSize) ?? null)
  return (
    <>
      {row.band && <rect x={G} width={width - G} y={y(row.band[1])} height={Math.max(2, y(row.band[0]) - y(row.band[1]))} className="dt-band" />}
      {(row.ticks ?? [row.min, row.max]).map((v) => (
        <g key={v}>
          <line x1={G} x2={width} y1={y(v)} y2={y(v)} className="dt-grid" />
          <text x={G - 8} y={y(v) + 4} textAnchor="end" className="dt-tick">
            {row.format(v)}
          </text>
        </g>
      ))}
      {row.kind === 'line' &&
        segments.map((seg, i) => (
          <g key={i}>
            <path d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')} className="dt-line" />
            {seg.map((p) => (
              <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={4.5} className={`dt-dot ${rate(row, p.v)}`} />
            ))}
          </g>
        ))}
      {row.kind === 'bars' &&
        row.points.map((p) => {
          if (!p.value) return null
          const span = x(Math.min(p.t + windowSize, end)) - x(p.t) - 2
          const w = Math.min(24, Math.max(2, span))
          const left = x(p.t) + 1 + (span - w) / 2
          const top = y(p.value)
          const h = H - PAD - top
          return (
            <path
              key={p.t}
              d={`M${left},${top + h}V${top + 4}Q${left},${top} ${left + 4},${top}H${left + w - 4}Q${left + w},${top} ${left + w},${top + 4}V${top + h}Z`}
              className={`dt-bar ${rate(row, p.value)}`}
            />
          )
        })}
      {hovered?.value != null && row.kind === 'line' && <circle cx={x(mid(hovered.t))} cy={y(hovered.value)} r={6} className="dt-dot hover" />}
    </>
  )
}

/** The same values as a table: one row per time window. */
function DeliveryTable({ rows, duration, windowSize }: { rows: TimelineRow[]; duration: number; windowSize: number }) {
  const windows: number[] = []
  for (let t = 0; t < duration; t += windowSize) windows.push(t)
  return (
    <div className="dt-table-wrap">
      <table className="dt-table">
        <thead>
          <tr>
            <th>Time</th>
            {rows.map((r) => (
              <th key={r.key}>{r.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {windows.map((w) => (
            <tr key={w}>
              <td>
                {formatTime(w)}–{formatTime(Math.min(w + windowSize, duration))}
              </td>
              {rows.map((r) => {
                if (r.kind === 'events') {
                  const evs = (r.events ?? []).filter((ev) => ev.t >= w && ev.t < w + windowSize)
                  return <td key={r.key}>{evs.length ? evs.map((ev) => ev.label).join(', ') : '–'}</td>
                }
                const p = r.points.find((pt) => pt.t === w)
                return <td key={r.key}>{p?.value == null ? '–' : `${r.format(p.value)} · ${STATUS_WORD[rate(r, p.value)]}`}</td>
              })}
            </tr>
          ))}
          <tr className="dt-table-total">
            <td>Overall</td>
            {rows.map((r) => (
              <td key={r.key}>{r.verdict.text}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
