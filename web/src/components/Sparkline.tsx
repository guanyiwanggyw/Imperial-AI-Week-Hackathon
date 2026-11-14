import { useState } from 'react'
import { formatTime } from '../lib/metrics'

export interface Point {
  t: number
  value: number | null
}

interface Props {
  points: Point[]
  duration: number
  /** y range */
  min: number
  max: number
  kind: 'line' | 'bars'
  slideTimes: number[]
  /** Optional band of good values, drawn as a faint background */
  goodBand?: [number, number]
  format: (v: number) => string
  marks?: { t: number; label: string }[]
  onSeek: (t: number) => void
}

const W = 600
const H = 44

/** One signal over time. Single series, so no legend; the row label names it. Hover shows the value, click seeks. */
export function Sparkline({ points, duration, min, max, kind, slideTimes, goodBand, format, marks = [], onSeek }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)
  const x = (t: number) => (t / Math.max(duration, 1)) * W
  const y = (v: number) => H - 3 - ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * (H - 6)
  const step = points.length > 1 ? points[1].t - points[0].t : duration

  // Lines break where the signal was not measured.
  const segments: string[] = []
  let current = ''
  for (const p of points) {
    if (p.value === null) {
      if (current) segments.push(current)
      current = ''
      continue
    }
    const px = x(p.t + step / 2)
    current += `${current ? 'L' : 'M'}${px.toFixed(1)},${y(p.value).toFixed(1)}`
  }
  if (current) segments.push(current)

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - rect.left) / rect.width) * duration
    const p = points.find((pt) => t >= pt.t && t < pt.t + step)
    const mark = marks.find((m) => Math.abs(m.t - t) < duration / 60)
    const text = mark ? `${formatTime(mark.t)}  ${mark.label}` : p ? `${formatTime(p.t)}  ${p.value === null ? 'not measured' : format(p.value)}` : ''
    setHover(text ? { x: e.clientX, y: rect.top - 6, text } : null)
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          onSeek(((e.clientX - rect.left) / rect.width) * duration)
        }}
        style={{ cursor: 'pointer' }}
        role="img"
      >
        {goodBand && (
          <rect x={0} width={W} y={y(goodBand[1])} height={Math.max(0, y(goodBand[0]) - y(goodBand[1]))} fill="var(--good)" opacity={0.07} />
        )}
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" />
        {slideTimes.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="var(--border)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ))}
        {kind === 'line' &&
          segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          ))}
        {kind === 'bars' &&
          points.map(
            (p) =>
              p.value !== null &&
              p.value > 0 && (
                <rect key={p.t} x={x(p.t) + 1} width={Math.max(x(step) - 2, 1)} y={y(p.value)} height={H - y(p.value)} rx={2} fill="var(--accent)" opacity={0.85} />
              ),
          )}
        {marks.map((m) => (
          <circle key={`${m.t}-${m.label}`} cx={x(m.t)} cy={H / 2} r={4} fill="var(--bad)" stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: hover.x + 8, top: hover.y - 22 }}>
          {hover.text}
        </div>
      )}
    </>
  )
}
