import { useMemo, useRef, useState } from 'react'
import { expressiveness, eyeContactShare, fillerIndices, findPauses, formatTime, wpmBetween, windows } from '../eval/metrics'
import type { DimensionScore, SessionData } from '../types'
import { Steps, TopNav } from './Chrome'
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

function ScoreBar({ label, score, hint, k = 1, head }: { label: string; score: number | null; hint?: string; k?: number; head?: boolean }) {
  return (
    <div className={`rp-bar${head ? ' head' : ''}`} title={hint}>
      <span className="l">{label}</span>
      <div className="track">{score !== null && <div className="fill" style={{ width: `${Math.min(100, score * k)}%` }} />}</div>
      <span className="v">{score === null ? '—' : fmtScore(score, k)}</span>
    </div>
  )
}

export function Report({ session, localRecording, onNew }: Props) {
  const report = session.report
  const video = useRef<HTMLVideoElement>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const duration = Math.max(session.duration, 1)
  const slideTimes = session.slideChanges.filter((s) => s.t > 0).map((s) => s.t)
  const pitchWords = session.words.filter((w) => w.start < session.pitchEnd)

  const togglePlay = () => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

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
      <div className="rp">
        <div className="rp-wrap">
          <p className="rp-notice" style={{ marginTop: 40 }}>This session has no report yet.</p>
        </div>
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

  const dash = '—'
  const subScores = ev
    ? (['eye', 'body', 'tone', 'coherency'] as const)
        .map((c) => `${c[0].toUpperCase()}${c.slice(1)} ${ev.unmeasured.includes(c) ? dash : ev.finalScores[c]}`)
        .concat(`Timing ${ev.timingScore ?? dash}`)
        .join(' · ')
    : report.contentScore !== null && report.deliveryScore !== null
      ? `Content ${Math.round(report.contentWeight * 100)}%, delivery ${Math.round((1 - report.contentWeight) * 100)}%`
      : report.contentScore === null
        ? 'Delivery only'
        : 'Content only'

  return (
    <div className="rp">
      <TopNav active="feedback" onPractice={onNew} onPast={onNew} />

      <div className="rp-wrap">
        <Steps current={2} />

        <div className="rp-heading">
          <div>
            <h1>{session.title}</h1>
            <p className="rp-meta">
              {session.config.panel.name} · {formatTime(session.pitchEnd)} pitch · {session.qna.length} {session.qna.length === 1 ? 'question' : 'questions'} ·{' '}
              {new Date(session.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button className="rp-btn-primary" onClick={onNew}>
            New session
          </button>
        </div>

        {/* 1. Overall with component scores */}
        <section className="rp-card rp-score">
          <div className="rp-overall">
            <span className="rp-eyebrow">Overall score</span>
            <span className="big">{report.insufficientSpeech ? dash : fmtScore(report.overall, k)}</span>
            <span className="out">out of 100</span>
            {report.insufficientSpeech && <span className="rp-pill warn">Not scored</span>}
            <span className="sub">{subScores}</span>
          </div>
          <div className="rp-score-body">
            {report.insufficientSpeech && (
              <div className="rp-notice">
                <strong>A little more speaking time is needed</strong>
                <span>
                  {ev?.coaching.summary ?? 'Not enough speech was captured to score this session. Check that the transcript service is configured and speak for at least 20 seconds.'}
                </span>
              </div>
            )}
            <div className="rp-components">
              <div className="rp-bars">
                <ScoreBar head label="Content" score={report.contentScore} k={k} />
                {report.content &&
                  (Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]).map((d) => (
                    <ScoreBar key={d} label={DIMENSION_LABELS[d]} score={report.content!.dimensions[d].score} k={k} />
                  ))}
                {report.content ? (
                  <p className="rp-summary">{report.content.summary}</p>
                ) : report.insufficientSpeech ? (
                  <p className="rp-summary">Scores appear when enough speech is captured for a reliable evaluation.</p>
                ) : (
                  <p className="rp-summary">Content evaluation unavailable{report.contentError ? `: ${report.contentError}` : ''}. The score uses delivery only.</p>
                )}
              </div>
              <div className="rp-bars">
                <ScoreBar head label="Delivery" score={report.deliveryScore} k={k} />
                {report.delivery.map((d) => (
                  <ScoreBar key={d.key} label={d.label} score={d.score} hint={d.value} k={k} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 2 and 3. Best moment and priorities */}
        <div className="rp-grid-2">
          <section className="rp-card rp-best">
            <h2>Best moment</h2>
            {report.bestMoment ? (
              <>
                <span className="rp-time">
                  {formatTime(report.bestMoment.start)} to {formatTime(report.bestMoment.end)}
                </span>
                <p className="quote">“{report.bestMoment.text}”</p>
                <p>{report.bestMoment.note}</p>
                <button className="rp-btn" onClick={() => seek(report.bestMoment!.start + 1)}>
                  Play this moment
                </button>
              </>
            ) : (
              <p>The pitch was too short to pick a 20-second highlight.</p>
            )}
          </section>
          <section className="rp-card rp-work">
            <h2>What to work on</h2>
            {report.priorities.length ? (
              report.priorities.map((p, i) => (
                <div key={i} className="rp-priority">
                  <span className="n">{i + 1}</span>
                  <div>
                    <strong>{p.title}</strong>
                    <span>{p.detail}</span>
                    {p.t !== null && (
                      <button className="rp-jump" onClick={() => seek(p.t)}>
                        See it at {formatTime(p.t)}
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="rp-muted">Nothing stood out. Keep practising with a stricter panel.</p>
            )}
          </section>
        </div>

        {/* 6. Recording with markers */}
        <section className="rp-card">
          <h2>Recording</h2>
          <div className="rp-recording">
            <div>
              <div className="rp-player">
                {recording ? (
                  <>
                    <video
                      ref={video}
                      src={recording}
                      playsInline
                      muted={muted}
                      onClick={togglePlay}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
                    />
                    {!playing && (
                      <button className="rp-btn rp-play" onClick={togglePlay}>
                        Play recording
                      </button>
                    )}
                    <div className="rp-controls">
                      <button className="play" onClick={togglePlay}>
                        {playing ? 'Pause' : 'Play'}
                      </button>
                      <span className="t">{formatTime(playhead)}</span>
                      <div
                        className="seek"
                        role="slider"
                        tabIndex={0}
                        aria-label="Seek"
                        aria-valuemin={0}
                        aria-valuemax={Math.round(duration)}
                        aria-valuenow={Math.round(playhead)}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          if (video.current) video.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
                        }}
                        onKeyDown={(e) => {
                          if (!video.current || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
                          video.current.currentTime = Math.max(0, video.current.currentTime + (e.key === 'ArrowRight' ? 5 : -5))
                        }}
                      >
                        <i style={{ left: `${Math.min(100, (playhead / duration) * 100)}%` }} />
                      </div>
                      <button className="sound" onClick={() => setMuted((m) => !m)} aria-pressed={!muted}>
                        {muted ? 'Sound off' : 'Sound on'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="rp-muted empty">The recording could not be saved.</p>
                )}
              </div>
              <div className="rp-markers">
                <div className="rail" />
                {markers.map((m, i) => (
                  <button
                    key={i}
                    className={`rp-marker ${m.kind}`}
                    style={{ left: `${Math.min(100, (Math.max(0, m.t) / duration) * 100)}%` }}
                    title={`${formatTime(m.t)} · ${m.label}`}
                    aria-label={`${m.label} at ${formatTime(m.t)}`}
                    onClick={() => seek(m.t + 1)}
                  />
                ))}
              </div>
              <div className="rp-legend">
                <span><i style={{ background: 'var(--rp-text-2)' }} /> Slide change</span>
                <span><i style={{ background: 'var(--rp-blue)' }} /> Question</span>
                <span><i style={{ background: 'var(--rp-yellow)' }} /> Filler burst</span>
                <span><i style={{ background: 'var(--rp-green)' }} /> Best moment</span>
              </div>
            </div>
            <div>
              <span className="rp-eyebrow blue">Session events</span>
              <div className="rp-events" aria-label="Session events">
                {eventList.length ? (
                  eventList.map((e, i) => {
                    const isQuestion = e.type === 'question_asked'
                    // Question events carry "Persona: question text".
                    const cut = isQuestion && e.detail ? e.detail.indexOf(': ') : -1
                    const who = cut > 0 ? e.detail!.slice(0, cut) : null
                    const body = cut > 0 ? e.detail!.slice(cut + 2) : null
                    const detail = who ?? e.detail
                    return (
                      <button key={i} className={isQuestion ? 'question' : undefined} onClick={() => seek(e.t)}>
                        <span className="t">{formatTime(e.t)}</span>
                        <span className="what">
                          {e.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}
                          {detail && ` · ${detail}`}
                        </span>
                        {body && <span className="body">{body}</span>}
                      </button>
                    )
                  })
                ) : (
                  <p className="rp-muted">No notable events were detected.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 4. Delivery timelines */}
        <section className="rp-card">
          <h2>Delivery over time</h2>
          <p className="rp-muted rp-lede">
            Dashed lines are slide changes. Click any timeline to jump the recording there.
            <br />
            Signals that could not be measured reliably are left blank.
          </p>
          <div className="rp-timeline">
            <span className="label">Eye contact</span>
            <Sparkline points={timelines.eye} duration={session.pitchEnd} min={0} max={1} kind="line" slideTimes={slideTimes} goodBand={[0.6, 1]} format={(v) => `${Math.round(v * 100)}%`} onSeek={seek} />
            <span className="value">{byKey.eye_contact?.value ?? 'Not scored'}</span>
          </div>
          <div className="rp-timeline">
            <span className="label">Gestures</span>
            <Sparkline points={timelines.gestures} duration={session.pitchEnd} min={0} max={1} kind="line" slideTimes={slideTimes} format={(v) => (v < 0.05 ? 'still' : v > 0.6 ? 'busy' : 'natural')} onSeek={seek} />
            <span className="value">{byKey.gestures?.value ?? 'Not scored'}</span>
          </div>
          <div className="rp-timeline">
            <span className="label">Tonality</span>
            <Sparkline points={timelines.tonality} duration={session.pitchEnd} min={0} max={1} kind="line" slideTimes={slideTimes} goodBand={[0.45, 1]} format={(v) => (v < 0.35 ? 'monotone' : v < 0.65 ? 'varied' : 'expressive')} onSeek={seek} />
            <span className="value">{byKey.tonality?.value ?? 'Not scored'}</span>
          </div>
          <div className="rp-timeline">
            <span className="label">Pace</span>
            <Sparkline points={timelines.pace} duration={session.pitchEnd} min={60} max={220} kind="line" slideTimes={slideTimes} goodBand={[130, 165]} format={(v) => `${Math.round(v)} wpm`} onSeek={seek} />
            <span className="value">{byKey.pace?.value ?? 'Not scored'}</span>
          </div>
          <div className="rp-timeline">
            <span className="label">Fillers</span>
            <Sparkline points={timelines.fillers} duration={session.pitchEnd} min={0} max={Math.max(3, ...timelines.fillers.map((p) => p.value ?? 0))} kind="bars" slideTimes={slideTimes} format={(v) => `${v} filler${v === 1 ? '' : 's'}`} onSeek={seek} />
            <span className="value">{timelines.fillerTimes.length} total</span>
          </div>
          <div className="rp-timeline">
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
            <span className="value">{byKey.pauses?.value ?? 'Not scored'}</span>
          </div>
        </section>

        {/* 5. Content feedback and Q&A */}
        {report.content && (
          <section className="rp-card">
            <h2>Content feedback</h2>
            {(Object.entries(report.content.dimensions) as [keyof typeof DIMENSION_LABELS, DimensionScore][]).map(([dim, d]) => (
              <div key={dim} className="rp-qa">
                <div className="top">
                  <strong>{DIMENSION_LABELS[dim]}</strong>
                  <span className="score">{fmtScore(d.score, k)}</span>
                  <span className="spacer" />
                  {d.evidence_time_sec !== null && (
                    <button className="rp-stamp" onClick={() => seek(d.evidence_time_sec)}>
                      {formatTime(d.evidence_time_sec)}
                    </button>
                  )}
                </div>
                <span className="rp-muted">{d.justification}</span>
              </div>
            ))}
          </section>
        )}

        {session.qna.length > 0 && (
          <section className="rp-card">
            <div className="rp-card-head">
              <h2>Questions and answers</h2>
              <span className="rp-eyebrow">
                {session.qna.length} {session.qna.length === 1 ? 'question' : 'questions'}
              </span>
            </div>
            {session.qna.map((q, i) => {
              const fb = report.content?.qna_feedback.find((f) => f.question_index === i)
              return (
                <div key={i} className="rp-qa">
                  <div className="top">
                    <span className="who">{q.personaName}</span>
                    <span className="spacer" />
                    {fb && <span className="score">{fmtScore(fb.score, k)}</span>}
                    <button className="rp-stamp" onClick={() => seek(q.start)}>
                      {formatTime(q.start)}
                    </button>
                  </div>
                  <p className="q">{q.question}</p>
                  {q.followUps.map((f, j) => (
                    <span key={j} className="rp-muted">
                      Follow-up: {f}
                    </span>
                  ))}
                  <div className="answer">{q.answer ? `Your answer: ${q.answer}` : 'No answer was captured.'}</div>
                  {fb && <span>{fb.feedback}</span>}
                  {q.agentNote && <span className="rp-muted small">{q.personaName}'s note: {q.agentNote}</span>}
                  {q.toolCalls.length > 0 && (
                    <div className="tools">
                      {q.toolCalls.map((t, j) => (
                        <span key={j} className="rp-pill">
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

        <p className="rp-footer">
          Delivery signals are measured, not judged: {pitchWords.length} words, {timelines.deliberate.length} deliberate pauses. The overall score combines them with the content evaluation so no single metric decides the result.
        </p>
      </div>
    </div>
  )
}
