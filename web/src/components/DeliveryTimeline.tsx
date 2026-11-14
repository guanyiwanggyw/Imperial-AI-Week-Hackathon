// "Delivery over time": one row per signal, all on the same time axis (small multiples, one
// series each, so no legend). Each row says what good looks like, draws a labelled target band
// and a real y-scale, and ends in a verdict with an icon + word (never colour alone).
// One crosshair spans every row and one tooltip lists every signal at that moment; a playhead
// follows the recording; click anywhere to jump there. A table view carries the same values.
import { useLayoutEffect, useRef, useState } from 'react'
import { formatTime } from '../eval/metrics'

export interface Point {
  t: number
  value: number | null
}

export type Verdict = { status: 'good' | 'warn' | 'bad' | 'none'; text: string }

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
  /** Target range, drawn as a labelled band. */
  band?: [number, number]
  /** Text on the band (default "target"). */
  bandLabel?: string
  /** Value as words, for ticks, tooltip and table. */
  format: (v: number) => string
  /** Tick values to label on the y-scale (default: min and max). */
  ticks?: number[]
  verdict: Verdict
  /** Shown in the plot when nothing could be measured. */
  emptyText?: string
  events?: { t: number; label: string; good: boolean }[]
}

interface Props {
  rows: TimelineRow[]
  duration: number
  windowSize: number
  slides: { t: number; label: string }[]
  playhead: number | null
  onSeek: (t: number) => void
}

const ROW_H = 64
const PAD_T = 8
const PAD_B = 8
const GUTTER = 60 // y tick labels ("expressive" fits)
const ICON = { good: '✓', warn: '!', bad: '!', none: '–' } as const

function tickStep(duration: number) {
  if (duration <= 40) return 10
  if (duration <= 120) return 20
  if (duration <= 300) return 60
  if (duration <= 900) return 120
  return 300
}

export function DeliveryTimeline({ rows, duration, windowSize, slides, playhead, onSeek }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hoverT, setHoverT] = useState<number | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const [table, setTable] = useState(false)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)))
    ro.observe(el)
    setWidth(Math.max(240, el.clientWidth))
    return () => ro.disconnect()
  }, [table])

  const end = Math.max(duration, 1)
  const plotW = width - GUTTER
  const x = (t: number) => GUTTER + (Math.min(Math.max(t, 0), end) / end) * plotW
  /** A window's value sits at the middle of the part of the window inside the pitch. */
  const mid = (t: number) => (t + Math.min(t + windowSize, end)) / 2
  const valueAt = (row: TimelineRow, t: number) => row.points.find((p) => t >= p.t && t < p.t + windowSize) ?? null
  const ticks: number[] = []
  for (let t = 0; t <= end + 0.01; t += tickStep(end)) ticks.push(t)

  /** Time under the pointer, measured from the plot (every row's plot shares the same x). */
  const pointerT = (e: React.PointerEvent | React.MouseEvent) => {
    const plot = box.current?.getBoundingClientRect()
    if (!plot) return null
    const px = e.clientX - plot.left - GUTTER
    return px < 0 || px > plotW ? null : Math.min(end, Math.max(0, (px / plotW) * end))
  }

  return (
    <section className="section card delivery">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2>Delivery over time</h2>
        <button className="btn quiet small" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      <p className="faint" style={{ margin: '4px 0 14px' }}>
        How each part of your delivery changed while you spoke. The shaded band is the target. Hover to compare everything at one moment, click to
        jump the recording there.
      </p>

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
            const y = (v: number) => PAD_T + (1 - (Math.min(row.max, Math.max(row.min, v)) - row.min) / (row.max - row.min || 1)) * (ROW_H - PAD_T - PAD_B)
            const measured = row.kind === 'events' ? true : row.points.some((p) => p.value !== null)
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
            const inBand = (v: number) => !row.band || (v >= row.band[0] && v <= row.band[1])
            const hovered = hoverT !== null ? valueAt(row, hoverT) : null
            const yTicks = row.ticks ?? [row.min, row.max]
            return (
              <div key={row.key} className="dt-row">
                <div className="dt-label">
                  <div>{row.label}</div>
                  <div className="faint small">{row.hint}</div>
                </div>
                <div className="dt-plot" ref={row === rows[0] ? box : undefined}>
                  <svg
                    width={width}
                    height={ROW_H}
                    role="img"
                    aria-label={`${row.label} over time. ${row.verdict.text}.`}
                    onClick={(e) => {
                      const t = pointerT(e)
                      if (t !== null) onSeek(t)
                    }}
                  >
                    {/* target band, labelled */}
                    {row.band && (
                      <>
                        <rect x={GUTTER} width={plotW} y={y(row.band[1])} height={Math.max(1, y(row.band[0]) - y(row.band[1]))} className="dt-band" />
                        <text x={GUTTER + 4} y={y(row.band[1]) + 11} className="dt-band-label">
                          {row.bandLabel ?? 'target'}
                        </text>
                      </>
                    )}
                    {/* y-scale */}
                    {yTicks.map((v) => (
                      <g key={v}>
                        <line x1={GUTTER} x2={width} y1={y(v)} y2={y(v)} className="dt-grid" />
                        <text x={GUTTER - 6} y={y(v) + 4} textAnchor="end" className="dt-tick">
                          {row.format(v)}
                        </text>
                      </g>
                    ))}
                    {/* slide changes and time gridlines: solid hairlines */}
                    {ticks.map((t) => (
                      <line key={`t${t}`} x1={x(t)} x2={x(t)} y1={PAD_T} y2={ROW_H - PAD_B} className="dt-grid" />
                    ))}
                    {slides.map((s) => (
                      <line key={`s${s.t}`} x1={x(s.t)} x2={x(s.t)} y1={0} y2={ROW_H} className="dt-slide" />
                    ))}

                    {!measured && (
                      <text x={GUTTER + plotW / 2} y={ROW_H / 2 + 4} textAnchor="middle" className="dt-empty">
                        {row.emptyText ?? 'Not measured'}
                      </text>
                    )}

                    {row.kind === 'line' &&
                      segments.map((seg, i) => (
                        <g key={i}>
                          <path d={seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')} className="dt-line" />
                          {seg.map((p) => (
                            <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={4} className={`dt-dot ${inBand(p.v) ? '' : 'off'}`} />
                          ))}
                        </g>
                      ))}

                    {row.kind === 'bars' &&
                      row.points.map((p) => {
                        if (!p.value) return null
                        const x0 = x(p.t) + 1
                        const w = Math.min(24, Math.max(2, x(Math.min(p.t + windowSize, end)) - x(p.t) - 2))
                        const left = x0 + (x(Math.min(p.t + windowSize, end)) - x(p.t) - 2 - w) / 2
                        const top = y(p.value)
                        const h = ROW_H - PAD_B - top
                        // 4px rounded data-end, square at the baseline
                        return (
                          <path
                            key={p.t}
                            d={`M${left},${top + h}V${top + 4}Q${left},${top} ${left + 4},${top}H${left + w - 4}Q${left + w},${top} ${left + w},${top + 4}V${top + h}Z`}
                            className={`dt-bar ${inBand(p.value) ? '' : 'off'}`}
                          />
                        )
                      })}

                    {row.kind === 'events' &&
                      (row.events ?? []).map((ev) => <circle key={`${ev.t}-${ev.label}`} cx={x(ev.t)} cy={ROW_H / 2} r={5} className={`dt-dot ${ev.good ? '' : 'off'}`} />)}

                    {/* playhead and crosshair */}
                    {playhead !== null && playhead > 0 && <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={ROW_H} className="dt-playhead" />}
                    {hoverT !== null && (
                      <>
                        <line x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={ROW_H} className="dt-crosshair" />
                        {hovered?.value != null && row.kind === 'line' && <circle cx={x(mid(hovered.t))} cy={y(hovered.value)} r={5} className="dt-dot hover" />}
                      </>
                    )}
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
            <svg width={width} height={30} aria-hidden>
              {ticks.map((t) => (
                <text key={t} x={x(t)} y={12} textAnchor={t === 0 ? 'start' : 'middle'} className="dt-tick">
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
            if (row.kind === 'events') {
              const near = (row.events ?? []).filter((ev) => Math.abs(ev.t - hoverT) < Math.max(1.5, end / 80))
              text = near.length ? near.map((ev) => ev.label).join(', ') : '–'
            } else {
              const p = valueAt(row, hoverT)
              text = p?.value == null ? 'not measured' : row.format(p.value)
            }
            return (
              <div key={row.key} className="dt-tip-row">
                <strong>{text}</strong>
                <span>{row.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
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
                return <td key={r.key}>{p?.value == null ? '–' : r.format(p.value)}</td>
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
