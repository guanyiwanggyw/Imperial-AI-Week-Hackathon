import { useMemo, useRef, useState } from 'react'
import { expressiveness, eyeContactShare, fillerIndices, findPauses, formatTime, wpmBetween, windows } from '../eval/metrics'
import type { DimensionScore, SessionData } from '../types'
import { Sparkline } from './Sparkline'

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

const fmt1 = (n: number) => n.toFixed(1)
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
  const byKey = Object.fromEntries(report.delivery.map((d) => [d.key, d]))

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
              <video ref={video} src={recording} controls playsInline onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)} />
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
      <section className="section card">
        <h2>Delivery over time</h2>
        <p className="faint" style={{ marginBottom: 12 }}>
          Dashed lines are slide changes. Click any timeline to jump the recording there. Signals that could not be measured reliably are left blank.
        </p>
        <div className="timeline">
          <span className="label">Eye contact</span>
          <Sparkline points={timelines.eye} duration={session.pitchEnd} min={0} max={1} kind="line" slideTimes={slideTimes} goodBand={[0.6, 1]} format={(v) => `${Math.round(v * 100)}%`} onSeek={seek} />
          <span className="value">{byKey.eye_contact?.value}</span>
        </div>
        <div className="timeline">
          <span className="label">Gestures</span>
          <Sparkline points={timelines.gestures} duration={session.pitchEnd} min={0} max={1} kind="line" slideTimes={slideTimes} format={(v) => (v < 0.05 ? 'still' : v > 0.6 ? 'busy' : 'natural')} onSeek={seek} />
          <span className="value">{byKey.gestures?.value}</span>
        </div>
        <div className="timeline">
          <span className="label">Tonality</span>
          <Sparkline points={timelines.tonality} duration={session.pitchEnd} min={0} max={1} kind="line" slideTimes={slideTimes} goodBand={[0.45, 1]} format={(v) => (v < 0.35 ? 'monotone' : v < 0.65 ? 'varied' : 'expressive')} onSeek={seek} />
          <span className="value">{byKey.tonality?.value}</span>
        </div>
        <div className="timeline">
          <span className="label">Pace</span>
          <Sparkline points={timelines.pace} duration={session.pitchEnd} min={60} max={220} kind="line" slideTimes={slideTimes} goodBand={[130, 165]} format={(v) => `${Math.round(v)} wpm`} onSeek={seek} />
          <span className="value">{byKey.pace?.value}</span>
        </div>
        <div className="timeline">
          <span className="label">Fillers</span>
          <Sparkline points={timelines.fillers} duration={session.pitchEnd} min={0} max={Math.max(3, ...timelines.fillers.map((p) => p.value ?? 0))} kind="bars" slideTimes={slideTimes} format={(v) => `${v} filler${v === 1 ? '' : 's'}`} onSeek={seek} />
          <span className="value">{timelines.fillerTimes.length} total</span>
        </div>
        <div className="timeline">
          <span className="label">Pauses</span>
          <Sparkline
            points={[]}
            duration={session.pitchEnd}
            min={0}
            max={1}
            kind="line"
            slideTimes={slideTimes}
            format={() => ''}
            marks={timelines.hesitations.map((p) => ({ t: p.start, label: `Hesitant pause, ${fmt1(p.end - p.start)} s` }))}
            onSeek={seek}
          />
          <span className="value">{byKey.pauses?.value}</span>
        </div>
      </section>

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
