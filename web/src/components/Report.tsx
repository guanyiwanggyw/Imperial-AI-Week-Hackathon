import { useMemo, useRef, useState } from 'react'
import type { Layers } from '../eval/debug/draw'
import { expressiveness, eyeContactShare, fillerIndices, findPauses, formatTime, wpmBetween, windows } from '../eval/metrics'
import { LandmarkPlayback } from '../eval/playback/LandmarkPlayback'
import type { DimensionScore, SessionData } from '../types'
import { DeliveryTimeline, type TimelineRow, type Verdict } from './DeliveryTimeline'

interface Props {
  session: SessionData
  localRecording: string | null
  onNew: () => void
}

const DIMENSION_LABELS = {
  overall_pitch: 'Overall pitch',
  clarity: 'Clarity',
  depth: 'Depth of thinking',
  qna: 'Q&A performance',
  composure: 'Composure',
} as const

/** Scores are 0–100. Reports saved before the switch are 0–10; `k` scales them up. */
const fmtScore = (n: number, k = 1) => String(Math.round(n * k))

function ScoreBar({ label, score, hint, k = 1 }: { label: string; score: number | null; hint?: string; k?: number }) {
  return (
    <div className="bar-row" title={hint}>
      <span>{label}</span>
      <div className="track">{score !== null && <div className="fill" style={{ width: `${Math.min(100, score * k)}%` }} />}</div>
      <span className="v">{score === null ? '–' : fmtScore(score, k)}</span>
    </div>
  )
}

export function Report({ session, localRecording, onNew }: Props) {
  const report = session.report
  const video = useRef<HTMLVideoElement>(null)
  const [playhead, setPlayhead] = useState(0)
  // Face and body tracking drawn over the recording (evaluation workstream). Only in playback, never live.
  const [tracking, setTracking] = useState<Layers>({ face: true, hands: true, pose: true })
  const duration = Math.max(session.duration, 1)
  const slideTimes = session.slideChanges.filter((s) => s.t > 0).map((s) => s.t)
  const pitchWords = session.words.filter((w) => w.start < session.pitchEnd)

  const seek = (t: number | null) => {
    if (t === null || !video.current) return
    video.current.currentTime = Math.max(0, t - 1)
    void video.current.play()
    video.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Timelines per signal over the pitch, in 10 s windows.
  const timelines = useMemo(() => {
    const end = session.pitchEnd
    const size = end > 240 ? 15 : 10
    const fillerIdx = new Set(fillerIndices(pitchWords))
    const fillerTimes = pitchWords.filter((_, i) => fillerIdx.has(i)).map((w) => w.start)
    const pauses = findPauses(pitchWords, slideTimes)
    const gestures = windows(end, size, (a, b) => {
      const frames = session.vision.filter((v) => v.t >= a && v.t < b && v.face)
      if (frames.length < 5) return null
      return frames.reduce((s, v) => s + (v.handsVisible ? Math.min(v.movement, 1.5) : 0), 0) / frames.length
    })
    return {
      size,
      eye: windows(end, size, (a, b) => eyeContactShare(session.vision, a, b)),
      gestures,
      tonality: windows(end, size, (a, b) => expressiveness(session.audio, a, b)),
      pace: windows(end, size, (a, b) => wpmBetween(pitchWords, a, b)),
      fillers: windows(end, size, (a, b) => fillerTimes.filter((t) => t >= a && t < b).length),
      fillerTimes,
      hesitations: pauses.filter((p) => p.kind === 'hesitation'),
      deliberate: pauses.filter((p) => p.kind === 'deliberate'),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  if (!report) {
    return (
      <div className="page">
        <div className="notice">This session has no report yet.</div>
      </div>
    )
  }

  const k = report.scale === 100 ? 1 : 10
  const ev = session.evaluation ?? null
  const recording = session.recordingUrl ?? localRecording

  // Markers on the recording timeline.
  const markers = [
    ...slideTimes.map((t, i) => ({ t, kind: 'slide', label: `Slide ${session.slideChanges[i + 1]?.slide + 1}` })),
    ...session.qna.map((q, i) => ({ t: q.start, kind: 'question', label: `Question ${i + 1} · ${q.personaName}` })),
    ...session.events.filter((e) => e.type === 'filler_burst').map((e) => ({ t: e.t - 4, kind: 'filler', label: 'Filler burst' })),
    ...(report.bestMoment ? [{ t: report.bestMoment.start, kind: 'best', label: 'Best moment' }] : []),
  ].sort((a, b) => a.t - b.t)

  const eventList = session.events
    .filter((e) => !['tool_called', 'answer_given', 'eye_contact_regained'].includes(e.type))
    .slice(0, 80)

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>{session.title}</h1>
          <span className="faint">
            {session.config.panel.name} · {formatTime(session.pitchEnd)} pitch · {session.qna.length} {session.qna.length === 1 ? 'question' : 'questions'} ·{' '}
            {new Date(session.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={onNew}>
          New session
        </button>
      </div>

      {/* 1. Overall with component scores */}
      <section className="card report-top">
        <div className="score-hero">
          <span className="big">{report.insufficientSpeech ? '–' : fmtScore(report.overall, k)}</span>
          <span className="out">out of 100</span>
          <span className="faint" style={{ marginTop: 8 }}>
            {ev
              ? (['eye', 'body', 'tone', 'coherency'] as const)
                  .map((c) => `${c[0].toUpperCase()}${c.slice(1)} ${ev.unmeasured.includes(c) ? '–' : ev.finalScores[c]}`)
                  .concat(`Timing ${ev.timingScore ?? '–'}`)
                  .join(' · ')
              : report.contentScore !== null && report.deliveryScore !== null
                ? `Content ${Math.round(report.contentWeight * 100)}%, delivery ${Math.round((1 - report.contentWeight) * 100)}%`
                : report.contentScore === null
                  ? 'Delivery only'
                  : 'Content only'}
          </span>
        </div>
        <div className="stack">
          {report.insufficientSpeech && (
            <div className="notice">
              {ev?.coaching.summary ?? 'Not enough speech was captured to score this session. Check that the transcript service is configured and speak for at least 20 seconds.'}
            </div>
          )}
          {report.content ? <p>{report.content.summary}</p> : report.insufficientSpeech ? null : <div className="notice">Content evaluation unavailable{report.contentError ? `: ${report.contentError}` : ''}. The score uses delivery only.</div>}
          <div className="components">
            <div className="stack" style={{ gap: 8 }}>
              <ScoreBar label="Content" score={report.contentScore} k={k} />
              {report.content &&
                (Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]).map((d) => (
                  <ScoreBar key={d} label={DIMENSION_LABELS[d]} score={report.content!.dimensions[d].score} k={k} />
                ))}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <ScoreBar label="Delivery" score={report.deliveryScore} k={k} />
              {report.delivery.map((d) => (
                <ScoreBar key={d.key} label={d.label} score={d.score} hint={d.value} k={k} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 2 and 3. Best moment and priorities */}
      <div className="grid-2 section">
        <section className="card stack">
          <h2>Best moment</h2>
          {report.bestMoment ? (
            <>
              <span className="faint num">
                {formatTime(report.bestMoment.start)} to {formatTime(report.bestMoment.end)}
              </span>
              <p className="muted">“{report.bestMoment.text}”</p>
              <p>{report.bestMoment.note}</p>
              <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => seek(report.bestMoment!.start + 1)}>
                Play this moment
              </button>
            </>
          ) : (
            <p className="muted">The pitch was too short to pick a 20-second highlight.</p>
          )}
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>What to work on</h2>
          {report.priorities.length ? (
            report.priorities.map((p, i) => (
              <div key={i} className="priority">
                <span className="n">{i + 1}</span>
                <div className="stack" style={{ gap: 4 }}>
                  <strong>{p.title}</strong>
                  <span className="muted">{p.detail}</span>
                  {p.t !== null && (
                    <button className="jump" style={{ alignSelf: 'flex-start' }} onClick={() => seek(p.t)}>
                      See it at {formatTime(p.t)}
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Nothing stood out. Keep practising with a stricter panel.</p>
          )}
        </section>
      </div>

      {/* 6. Recording with markers */}
      <section className="section card">
        <h2 style={{ marginBottom: 12 }}>Recording</h2>
        <div className="player">
          <div>
            {recording ? (
              <div style={{ position: 'relative' }}>
                <video ref={video} src={recording} controls playsInline style={{ display: 'block' }} onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)} />
                {ev?.landmarks && <LandmarkPlayback video={video} track={ev.landmarks} samples={ev.samples} layers={tracking} />}
              </div>
            ) : (
              <div className="notice">The recording could not be saved.</div>
            )}
            <div className="markers">
              <div className="rail" />
              {markers.map((m, i) => (
                <button
                  key={i}
                  className={`marker ${m.kind}`}
                  style={{ left: `${(Math.max(0, m.t) / duration) * 100}%` }}
                  title={`${formatTime(m.t)} · ${m.label}`}
                  aria-label={`${m.label} at ${formatTime(m.t)}`}
                  onClick={() => seek(m.t + 1)}
                />
              ))}
              <div className="head" style={{ left: `${Math.min(100, (playhead / duration) * 100)}%` }} />
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--text-3)', borderRadius: 2, width: 4 }} /> Slide change</span>
              <span><i style={{ background: 'var(--accent)' }} /> Question</span>
              <span><i style={{ background: 'var(--warn)' }} /> Filler burst</span>
              <span><i style={{ background: 'var(--good)' }} /> Best moment</span>
            </div>
            {recording && ev?.landmarks && (
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span className="faint">Tracking overlay</span>
                {(['face', 'hands', 'pose'] as const).map((k) => (
                  <label key={k} className="chip" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={tracking[k]} onChange={(e) => setTracking({ ...tracking, [k]: e.target.checked })} />
                    {k === 'pose' ? 'Body' : k === 'face' ? 'Face' : 'Hands'}
                  </label>
                ))}
                <span className="faint">Face green = eye contact, red = looking away · hands amber = touching face · forearms red = arms crossed</span>
              </div>
            )}
          </div>
          <div className="event-list" aria-label="Session events">
            {eventList.length ? (
              eventList.map((e, i) => (
                <button key={i} onClick={() => seek(e.t)}>
                  <span className="faint num">{formatTime(e.t)}</span>
                  <span>
                    {e.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}
                    {e.detail && <span className="faint"> · {e.detail}</span>}
                  </span>
                </button>
              ))
            ) : (
              <p className="faint">No notable events were detected.</p>
            )}
          </div>
        </div>
      </section>

      {/* 4. Delivery timelines */}
      <DeliveryTimeline
        rows={deliveryRows(timelines, session.pitchEnd)}
        duration={session.pitchEnd}
        windowSize={timelines.size}
        slides={slideTimes.map((t, i) => ({ t, label: `Slide ${(session.slideChanges[i + 1]?.slide ?? i + 1) + 1}` }))}
        playhead={playhead}
        onSeek={seek}
      />

      {/* 5. Content feedback and Q&A */}
      {report.content && (
        <section className="section card">
          <h2 style={{ marginBottom: 12 }}>Content feedback</h2>
          {(Object.entries(report.content.dimensions) as [keyof typeof DIMENSION_LABELS, DimensionScore][]).map(([dim, d]) => (
            <div key={dim} className="qa">
              <div className="row">
                <strong>{DIMENSION_LABELS[dim]}</strong>
                <span className="faint num">{fmtScore(d.score, k)}</span>
                <span className="spacer" />
                {d.evidence_time_sec !== null && (
                  <button className="jump" onClick={() => seek(d.evidence_time_sec)}>
                    {formatTime(d.evidence_time_sec)}
                  </button>
                )}
              </div>
              <span className="muted">{d.justification}</span>
            </div>
          ))}
        </section>
      )}

      {session.qna.length > 0 && (
        <section className="section card">
          <h2 style={{ marginBottom: 12 }}>Questions and answers</h2>
          {session.qna.map((q, i) => {
            const fb = report.content?.qna_feedback.find((f) => f.question_index === i)
            return (
              <div key={i} className="qa">
                <div className="row">
                  <span className="faint">{q.personaName}</span>
                  <span className="spacer" />
                  {fb && <span className="faint num">{fmtScore(fb.score, k)}</span>}
                  <button className="jump" onClick={() => seek(q.start)}>
                    {formatTime(q.start)}
                  </button>
                </div>
                <span className="q">{q.question}</span>
                {q.followUps.map((f, j) => (
                  <span key={j} className="muted">
                    Follow-up: {f}
                  </span>
                ))}
                <span className="muted">{q.answer ? `Your answer: ${q.answer}` : 'No answer was captured.'}</span>
                {fb && <span>{fb.feedback}</span>}
                {q.agentNote && <span className="faint">{q.personaName}'s note: {q.agentNote}</span>}
                {q.toolCalls.length > 0 && (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                    {q.toolCalls.map((t, j) => (
                      <span key={j} className="chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      <section className="section">
        <p className="faint">
          Delivery signals are measured, not judged: {pitchWords.length} words, {timelines.deliberate.length} deliberate pauses. The overall score combines them with the content evaluation so no single metric decides the result.
        </p>
      </section>
    </div>
  )
}

// ---------- delivery over time: rows and plain-language verdicts ----------

type Timelines = {
  size: number
  eye: { t: number; value: number | null }[]
  gestures: { t: number; value: number | null }[]
  tonality: { t: number; value: number | null }[]
  pace: { t: number; value: number | null }[]
  fillers: { t: number; value: number | null }[]
  fillerTimes: number[]
  hesitations: { start: number; end: number }[]
  deliberate: { start: number; end: number }[]
}

const mean = (pts: { value: number | null }[]) => {
  const v = pts.map((p) => p.value).filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const NOT_MEASURED: Verdict = { status: 'none', text: 'Not measured' }

/** Every row says what good looks like and ends in a verdict computed from the same values it draws. */
function deliveryRows(tl: Timelines, duration: number): TimelineRow[] {
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const eye = mean(tl.eye)
  const gestures = mean(tl.gestures)
  const tone = mean(tl.tonality)
  const pace = mean(tl.pace)
  const perMin = duration > 0 ? tl.fillerTimes.length / (duration / 60) : 0
  const paceMax = Math.max(220, ...tl.pace.map((p) => (p.value ?? 0) + 10))
  const toneWord = (v: number) => (v < 0.35 ? 'monotone' : v < 0.65 ? 'varied' : 'expressive')
  const gestureWord = (v: number) => (v < 0.05 ? 'still' : v > 0.6 ? 'busy' : 'natural')
  return [
    {
      key: 'eye',
      label: 'Eye contact',
      hint: 'Look at the panel at least 60% of the time',
      kind: 'line',
      points: tl.eye,
      min: 0,
      max: 1,
      band: [0.6, 1],
      bandLabel: 'target 60%+',
      format: pct,
      emptyText: 'Not measured: the camera could not see your face',
      verdict:
        eye === null ? NOT_MEASURED : eye >= 0.6 ? { status: 'good', text: `${pct(eye)} · on target` } : { status: eye >= 0.45 ? 'warn' : 'bad', text: `${pct(eye)} · below the 60% target` },
    },
    {
      key: 'gestures',
      label: 'Gestures',
      hint: 'Some natural hand movement, not still, not busy',
      kind: 'line',
      points: tl.gestures,
      min: 0,
      max: 1,
      band: [0.05, 0.6],
      bandLabel: 'natural',
      format: gestureWord,
      ticks: [0, 1],
      emptyText: 'Not measured: hands or face were out of view',
      verdict:
        gestures === null
          ? NOT_MEASURED
          : gestures < 0.05
            ? { status: 'warn', text: 'Very still · use your hands a little' }
            : gestures > 0.6
              ? { status: 'warn', text: 'Busy · calm your hands' }
              : { status: 'good', text: 'Natural · on target' },
    },
    {
      key: 'tonality',
      label: 'Tone of voice',
      hint: 'Vary your pitch; avoid long flat stretches',
      kind: 'line',
      points: tl.tonality,
      min: 0,
      max: 1,
      band: [0.45, 1],
      bandLabel: 'varied',
      format: toneWord,
      ticks: [0, 1],
      emptyText: 'Not measured: no clear voice pitch was heard',
      verdict: tone === null ? NOT_MEASURED : tone >= 0.45 ? { status: 'good', text: `${toneWord(tone)} · on target` } : { status: 'warn', text: `${toneWord(tone)} · vary your pitch` },
    },
    {
      key: 'pace',
      label: 'Pace',
      hint: 'About 130–165 words a minute',
      kind: 'line',
      points: tl.pace,
      min: 60,
      max: paceMax,
      band: [130, 165],
      bandLabel: 'target 130–165',
      format: (v) => `${Math.round(v)} wpm`,
      ticks: [60, paceMax],
      emptyText: 'Not measured: no transcript',
      verdict:
        pace === null
          ? NOT_MEASURED
          : pace > 165
            ? { status: pace > 185 ? 'bad' : 'warn', text: `${Math.round(pace)} wpm · too fast` }
            : pace < 130
              ? { status: pace < 110 ? 'bad' : 'warn', text: `${Math.round(pace)} wpm · a bit slow` }
              : { status: 'good', text: `${Math.round(pace)} wpm · on target` },
    },
    {
      key: 'fillers',
      label: 'Filler words',
      hint: '"Um", "uh", "like": under 3 a minute',
      kind: 'bars',
      points: tl.fillers,
      min: 0,
      max: Math.max(3, ...tl.fillers.map((p) => p.value ?? 0)),
      band: [0, (3 * tl.size) / 60],
      bandLabel: 'fine',
      format: (v) => `${Math.round(v)} filler${Math.round(v) === 1 ? '' : 's'}`,
      ticks: [0, Math.max(3, ...tl.fillers.map((p) => p.value ?? 0))],
      verdict:
        tl.fillerTimes.length === 0
          ? { status: 'good', text: 'None · great' }
          : { status: perMin < 3 ? 'good' : perMin < 6 ? 'warn' : 'bad', text: `${tl.fillerTimes.length} total · ${perMin.toFixed(1)} a minute` },
    },
    {
      key: 'pauses',
      label: 'Pauses',
      hint: 'Pause after a point, not mid-sentence',
      kind: 'events',
      points: [],
      min: 0,
      max: 1,
      format: () => '',
      ticks: [],
      events: [
        ...tl.deliberate.map((p) => ({ t: p.start, label: `Deliberate pause, ${(p.end - p.start).toFixed(1)} s`, good: true })),
        ...tl.hesitations.map((p) => ({ t: p.start, label: `Hesitant pause, ${(p.end - p.start).toFixed(1)} s`, good: false })),
      ],
      verdict:
        tl.hesitations.length === 0
          ? { status: 'good', text: tl.deliberate.length ? `${tl.deliberate.length} deliberate · none hesitant` : 'No long pauses' }
          : { status: 'warn', text: `${tl.hesitations.length} hesitant · ${tl.deliberate.length} deliberate` },
    },
  ]
}
