import { useCallback, useEffect, useRef, useState } from 'react'
import { postForm, type Status } from '../api'
import { PanelAvatars, speakAs, useAvatarState, type CaptionLine } from '../avatar/panelAvatars'
import { buildReport } from '../eval/evaluate'
import { LiveEventEngine } from '../eval/liveEvents'
import { deliveryStats, eyeContactShare, fillerIndices, formatTime, timestampedTranscript, wpmBetween } from '../eval/metrics'
import { EvalSession } from '../eval/runtime'
import { backdropKey, loadAssets, type Assets } from '../lib/media'
import { planQuestions, runTurn, type QnaMode } from '../lib/qna'
import { chooseReaction } from '../lib/reactions'
import { SessionRecorder } from '../lib/recorder'
import type { QnaTurn, SessionConfig, SessionData, SessionEvent, Word } from '../types'
import { Audience, type ActiveReaction } from './Audience'
import { LiveCaptions } from './LiveCaptions'

interface Props {
  config: SessionConfig
  stream: MediaStream
  status: Status
  onDone: (session: SessionData, localRecording: string | null) => void
  onCancel: () => void
}

type Phase = 'countdown' | 'pitch' | 'conferring' | 'qna' | 'finishing'

/** Session clock in seconds, excluding pauses. Matches the recording timeline. */
class Clock {
  private startedAt = 0
  private pausedAt: number | null = null
  private pausedTotal = 0
  start() {
    this.startedAt = performance.now()
  }
  now = () => {
    if (!this.startedAt) return 0
    const at = this.pausedAt ?? performance.now()
    return (at - this.startedAt - this.pausedTotal) / 1000
  }
  pause() {
    this.pausedAt ??= performance.now()
  }
  resume() {
    if (this.pausedAt !== null) this.pausedTotal += performance.now() - this.pausedAt
    this.pausedAt = null
  }
  get paused() {
    return this.pausedAt !== null
  }
}

/** The live avatar wins when configured; otherwise the ElevenLabs agent; otherwise spoken by the browser. */
function initialMode(status: Status): QnaMode {
  return !status.anam && status.elevenlabsAgent ? 'voice' : 'spoken'
}

export function Session({ config, stream, status, onDone, onCancel }: Props) {
  const { panel, slides } = config
  const clock = useRef(new Clock()).current
  const recorder = useRef<SessionRecorder | null>(null)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])
  // Evaluation engine: camera/mic analysis, live transcript, RoomState, rule events, background judge.
  const evalRef = useRef<EvalSession | null>(null)
  evalRef.current ??= new EvalSession({ stream, onUpdate: rerender, context: () => config.context, judge: status.anthropic })
  const evalRt = evalRef.current
  const transcript = evalRt.transcript
  const selfView = useRef<HTMLVideoElement>(null)
  // A live avatar for every agent, for the whole session.
  const avatars = useRef(new PanelAvatars()).current
  avatars.setClock(clock.now) // caption times on the session clock, like the transcript
  const avatarState = useAvatarState(avatars)

  const [phase, setPhase] = useState<Phase>('countdown')
  const phaseRef = useRef<Phase>('countdown')
  const [countdown, setCountdown] = useState(5)
  const [paused, setPaused] = useState(false)
  const [slide, setSlide] = useState(0)
  const slideChanges = useRef<{ t: number; slide: number }[]>([])
  const [assets, setAssets] = useState<Assets>({})
  const [reactions, setReactions] = useState<Record<string, ActiveReaction | undefined>>({})
  const reactionId = useRef(0)
  const [now, setNow] = useState(0)
  const [live, setLive] = useState<{ wpm: number | null; fillers: number; eye: number | null }>({ wpm: null, fillers: 0, eye: null })
  const [notice, setNotice] = useState<string | null>(null)

  // Q&A state
  const [mode, setMode] = useState<QnaMode>(initialMode(status))
  const modeRef = useRef<QnaMode>(initialMode(status))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [caption, setCaption] = useState('')
  // Voice-agent mode (ElevenLabs) lines for the live captions; spoken-mode lines come from the avatars.
  const [voiceLines, setVoiceLines] = useState<CaptionLine[]>([])
  const [questionInfo, setQuestionInfo] = useState<{ n: number; total: number; who: string } | null>(null)
  const [toolNotes, setToolNotes] = useState<string[]>([])
  const skipRef = useRef<AbortController | null>(null)
  const stopQna = useRef(false)
  const turns = useRef<QnaTurn[]>([])
  const pitchEnd = useRef(0)
  const [finishStep, setFinishStep] = useState('')

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  // ---------- events and reactions ----------

  const onEvent = useCallback(
    (e: SessionEvent) => {
      if (e.type === 'tool_called' && e.detail) setToolNotes((n) => [...n, e.detail!.split(': ').slice(1).join(': ')])
      if (phaseRef.current !== 'pitch') return
      panel.personas.forEach((p) => {
        // Live avatars idle on their own; reaction clips are for the still portraits.
        if (avatars.seat(p.id).status === 'live') return
        const reaction = chooseReaction(p, e)
        if (!reaction) return
        // Stagger so the panel does not react in unison.
        window.setTimeout(() => {
          setReactions((r) => (r[p.id] ? r : { ...r, [p.id]: { reaction, id: ++reactionId.current } }))
        }, 300 + Math.random() * 1200)
      })
    },
    [panel.personas, avatars],
  )
  const engine = useRef<LiveEventEngine | null>(null)
  engine.current ??= new LiveEventEngine(onEvent)

  // ---------- start ----------

  useEffect(() => {
    stopQna.current = false
    // Warm every agent's avatar during the countdown so they are live (and idling) when the pitch starts.
    void avatars.warm(panel.personas, { anam: status.anam })
    if (selfView.current) {
      selfView.current.srcObject = stream
      // Calibrate during the countdown: the speaker looks at the panel and stands naturally.
      evalRt.startCalibration(selfView.current)
    }
    void loadAssets().then(setAssets)
    let n = 5
    const timer = window.setInterval(() => {
      n -= 1
      setCountdown(n)
      if (n > 0) return
      window.clearInterval(timer)
      clock.start()
      const rec = new SessionRecorder(stream)
      rec.start()
      recorder.current = rec
      evalRt.start(clock.now, () => !clock.paused)
      slideChanges.current = [{ t: 0, slide: 0 }]
      setPhaseBoth('pitch')
    }, 1000)
    return () => {
      window.clearInterval(timer)
      evalRt.stop()
      skipRef.current?.abort()
      stopQna.current = true
      void avatars.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live tick: clock, metrics and the event stream.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const t = clock.now()
      setNow(t)
      if (phaseRef.current !== 'pitch' || clock.paused) return
      const words = transcript.words
      engine.current!.tick(t, words, evalRt.sampler.legacyAudio, evalRt.sampler.legacyVision, evalRt.lastVoiceT())
      setLive({
        wpm: wpmBetween(words, t - 30, t),
        fillers: fillerIndices(words).length,
        eye: eyeContactShare(evalRt.sampler.legacyVision, t - 30, t),
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [clock, evalRt, transcript])

  // ---------- slides ----------

  const goTo = useCallback(
    (i: number) => {
      if (!slides.length) return
      const next = Math.max(0, Math.min(slides.length - 1, i))
      const current = slideChanges.current[slideChanges.current.length - 1]?.slide ?? 0
      if (current === next) return
      const t = clock.now()
      slideChanges.current.push({ t, slide: next })
      engine.current!.emit('slide_changed', t, `Slide ${next + 1}`, true)
      setSlide(next)
    },
    [slides.length, clock],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (['ArrowRight', 'PageDown', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        goTo(slide + 1)
      }
      if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        goTo(slide - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, slide])

  const slideSeconds = slides.map((_, i) => {
    let total = 0
    const changes = slideChanges.current
    for (let k = 0; k < changes.length; k++) {
      if (changes[k].slide !== i) continue
      const end = k + 1 < changes.length ? changes[k + 1].t : phase === 'pitch' ? now : pitchEnd.current || now
      total += Math.max(0, end - changes[k].t)
    }
    return total
  })

  // ---------- pause ----------

  function togglePause() {
    if (clock.paused) {
      clock.resume()
      recorder.current?.resume()
      setPaused(false)
    } else {
      clock.pause()
      recorder.current?.pause()
      setPaused(true)
    }
  }

  // ---------- Q&A ----------

  const pitchWords = (): Word[] => transcript.words.filter((w) => w.start < pitchEnd.current)

  function metricsSummary() {
    const s = deliveryStats({ words: pitchWords(), audio: evalRt.sampler.legacyAudio, vision: evalRt.sampler.legacyVision, slideChanges: slideChanges.current, pitchEnd: pitchEnd.current })
    return [
      s.wpm ? `Pace ${Math.round(s.wpm)} words per minute.` : 'Pace not measured.',
      `${s.fillers} filler words.`,
      `${s.hesitations} hesitant pauses, ${s.deliberatePauses} deliberate pauses.`,
      s.eyeContact !== null ? `Eye contact ${Math.round(s.eyeContact * 100)} percent of the time.` : '',
    ].join(' ')
  }

  async function endPitch() {
    if (phaseRef.current !== 'pitch') return
    if (clock.paused) togglePause()
    const t = clock.now()
    pitchEnd.current = t
    evalRt.markPitchEnded(t)
    engine.current!.emit('pitch_ended', t, undefined, true)
    setReactions({})
    if (config.questionCount === 0) return finish()

    setPhaseBoth('conferring')
    // Give the transcriber a moment to commit the last sentence.
    await new Promise((r) => setTimeout(r, 1200))
    const plan = await planQuestions(panel.personas, config.questionCount, timestampedTranscript(pitchWords(), 8000), slides, config.context)
    if (plan.fallback) setNotice('The panel is using general questions because the question service is unavailable.')
    setPhaseBoth('qna')

    for (let i = 0; i < plan.questions.length && !stopQna.current; i++) {
      const q = plan.questions[i]
      const seat = Math.max(0, panel.personas.findIndex((p) => p.id === q.persona_id))
      const persona = panel.personas[seat] ?? panel.personas[i % panel.personas.length]
      setActiveId(persona.id)
      setQuestionInfo({ n: i + 1, total: plan.questions.length, who: persona.name })
      setCaption('')
      setToolNotes([])
      engine.current!.emit('question_asked', clock.now(), `${persona.name}: ${q.question}`, true)
      const skip = new AbortController()
      skipRef.current = skip
      const ctx = {
        slides,
        now: clock.now,
        getTranscript: () => timestampedTranscript(pitchWords(), 6000),
        getMetricsSummary: metricsSummary,
        getAnswerBetween: (from: number, to: number) =>
          transcript.words
            .filter((w) => w.start >= from && w.start <= to)
            .map((w) => w.text)
            .join(' '),
        getAnswerWords: (from: number) => transcript.words.filter((w) => w.start >= from),
        say: async (text: string, signal: AbortSignal) => {
          // Spoken mode: log the agent line for the evaluation (starts at first audio, ends when speech ends).
          const askedAt = clock.now()
          evalRt.agentSpeaking(true, persona.name)
          evalRt.agentCaption(text)
          try {
            const log = await speakAs(avatars, persona, seat, text, signal)
            evalRt.agentSpeaking(false, persona.name, { startAt: askedAt + (log.latencyMs ?? 0) / 1000, interrupted: log.interrupted })
            return log
          } catch (err) {
            evalRt.agentSpeaking(false, persona.name)
            throw err
          }
        },
        onEvent: (e: SessionEvent) => {
          engine.current!.events.push(e)
          onEvent(e)
        },
        // Voice-agent mode reports speaking and captions through these.
        onSpeaking: (on: boolean) => {
          setSpeaking(on)
          evalRt.agentSpeaking(on, persona.name)
        },
        onCaption: (text: string) => {
          setCaption(text)
          evalRt.agentCaption(text)
          if (modeRef.current === 'voice') {
            const t = clock.now()
            setVoiceLines((ls) => [...ls.slice(-29), { id: -(ls.length + 1), personaId: persona.id, text, spoken: text, t, end: t, done: true, interrupted: false }])
          }
        },
      }
      let turn: QnaTurn | null = null
      // Try the richest mode first, then fall back so the demo never stalls.
      const modes: QnaMode[] = modeRef.current === 'voice' ? ['voice', 'spoken'] : ['spoken']
      for (const m of modes) {
        try {
          setMode(m)
          turn = await runTurn(m, persona, seat, q, ctx, skip.signal)
          break
        } catch (err) {
          console.warn(`Q&A mode ${m} failed:`, err)
          modeRef.current = 'spoken'
          setNotice('The voice agent could not connect, so the panel is speaking the questions instead.')
        }
      }
      if (turn) {
        // Answers in browser mode come from the live transcript; agent modes have their own.
        turns.current.push(turn)
        engine.current!.emit('answer_given', turn.end, persona.name, true)
      }
      evalRt.exchangeEnded()
    }
    setActiveId(null)
    void finish()
  }

  async function finish() {
    if (phaseRef.current === 'finishing') return
    stopQna.current = true
    skipRef.current?.abort()
    void avatars.stop()
    setPhaseBoth('finishing')
    const duration = clock.now()
    if (!pitchEnd.current) pitchEnd.current = duration
    setFinishStep('Saving the recording')
    evalRt.stop()
    // Background judge segments finish while the recording saves and the transcript is refined.
    const judgeDone = evalRt.flushJudge()
    const files = recorder.current ? await recorder.current.stop() : null
    const localRecording = files ? URL.createObjectURL(files.video) : null

    const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`
    const session: SessionData = {
      id,
      title: config.deckName ? config.deckName.replace(/\.pdf$/i, '') : `${panel.name} practice`,
      startedAt: new Date(Date.now() - duration * 1000).toISOString(),
      config,
      pitchEnd: pitchEnd.current,
      duration,
      slideChanges: slideChanges.current,
      events: engine.current!.events,
      liveWords: transcript.words,
      words: transcript.words,
      vision: evalRt.sampler.legacyVision,
      audio: evalRt.sampler.legacyAudio,
      qna: turns.current,
      recordingUrl: null,
      report: null,
    }

    try {
      const form = new FormData()
      form.append('session', JSON.stringify(session))
      if (files) form.append('recording', files.video, 'recording.webm')
      const saved = await postForm<{ recordingUrl: string | null }>('/api/sessions', form, 120000)
      session.recordingUrl = saved.recordingUrl
    } catch (err) {
      console.warn('Saving failed:', err)
    }

    if (files && status.elevenlabs) {
      setFinishStep('Transcribing precisely')
      try {
        const form = new FormData()
        form.append('audio', files.audio, 'audio.webm')
        const { words } = await postForm<{ words: Word[] }>('/api/voice/transcribe', form, 130000)
        if (words.length >= transcript.words.length * 0.5) session.words = words
      } catch (err) {
        console.warn('Batch transcription failed, using the live transcript:', err)
      }
    }

    setFinishStep('Writing your report')
    await judgeDone
    const built = await buildReport(session, evalRt.capture(), { skipJudge: !status.anthropic })
    session.report = built.report
    session.evaluation = built.evaluation
    try {
      await fetch(`/api/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session) })
    } catch {
      // The report still shows; it just will not be in the history.
    }
    onDone(session, localRecording)
  }

  // ---------- render ----------

  // The asking panelist's line as it is being spoken (spoken mode), for the question card.
  const askingLine = [...avatarState.lines].reverse().find((l) => l.personaId === activeId)
  const over = phase === 'pitch' && now > config.pitchSeconds
  const backdrop = assets[backdropKey(panel)] ?? null

  return (
    <div className="session">
      <div className="session-main">
        <div className="stage">
          <div className="slide-frame">
            {slides.length ? (
              <img src={slides[slide].image} alt={`Slide ${slide + 1}`} />
            ) : (
              <div className="no-slides">
                <h2>No slides</h2>
                <p className="muted">Speak to the panel directly.</p>
              </div>
            )}
          </div>
          {slides.length > 0 && (
            <div className="slide-progress" aria-label="Time per slide">
              {slides.map((s, i) => (
                <div key={s.index} className={i === slide ? 'current' : ''} onClick={() => goTo(i)} title={`Slide ${i + 1}: ${formatTime(slideSeconds[i])}`}>
                  <span style={{ width: `${Math.min(100, (slideSeconds[i] / Math.max(config.pitchSeconds / slides.length, 1)) * 100)}%` }} />
                </div>
              ))}
            </div>
          )}
          <LiveCaptions
            personas={panel.personas}
            phrases={transcript.phrases}
            partial={transcript.partial}
            lines={[...avatarState.lines, ...voiceLines]}
            error={transcript.error}
            placeholder={phase === 'pitch' ? 'Your words will appear here.' : ''}
          />
        </div>

        <div className="side">
          <div className="self-view">
            <video ref={selfView} autoPlay muted playsInline />
            {phase !== 'countdown' && phase !== 'finishing' && (
              <div className="rec">
                <i /> {paused ? 'Paused' : 'Recording'}
              </div>
            )}
          </div>

          <Audience
            personas={panel.personas}
            assets={assets}
            backdrop={backdrop}
            reactions={reactions}
            onReactionEnd={(id) => setReactions((r) => ({ ...r, [id]: undefined }))}
            activeId={phase === 'qna' ? activeId : null}
            avatars={avatars}
            speakingId={mode === 'voice' && speaking ? activeId : null}
          />

          {(phase === 'qna' || phase === 'conferring') && (
            <div className="question-card">
              <div className="who">
                {phase === 'conferring' ? 'The panel is preparing questions' : questionInfo && `Question ${questionInfo.n} of ${questionInfo.total} · ${questionInfo.who}`}
              </div>
              <div>
                {phase === 'conferring' ? (
                  <span className="spinner" style={{ display: 'inline-block' }} />
                ) : mode === 'spoken' && askingLine ? (
                  <>
                    {askingLine.done ? askingLine.text : askingLine.spoken}
                    {!askingLine.done && <span className="faint"> {askingLine.text.slice(askingLine.spoken.length)}</span>}
                  </>
                ) : (
                  caption || <span className="faint">Listening</span>
                )}
              </div>
              {toolNotes.length > 0 && (
                <div className="tools">
                  {toolNotes.map((n, i) => (
                    <span key={i} className="chip">
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase === 'pitch' && (
            <div className="metrics">
              <div className="metric">
                <div className="label">Pace</div>
                <div className="value">{live.wpm ? `${Math.round(live.wpm)} wpm` : '–'}</div>
              </div>
              <div className="metric">
                <div className="label">Fillers</div>
                <div className="value">{live.fillers}</div>
              </div>
              <div className="metric" title={live.eye === null ? 'Not measured: the camera needs to see your face' : undefined}>
                <div className="label">Eye contact</div>
                <div className="value">{live.eye === null ? '–' : `${Math.round(live.eye * 100)}%`}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="controls">
        <span className={`timer ${over ? 'over' : ''}`}>
          {formatTime(phase === 'pitch' ? now : pitchEnd.current || now)} <span className="faint">/ {formatTime(config.pitchSeconds)}</span>
        </span>
        {slides.length > 0 && (
          <div className="row" style={{ gap: 4 }}>
            <button className="btn quiet" onClick={() => goTo(slide - 1)} disabled={slide === 0} aria-label="Previous slide">
              ←
            </button>
            <span className="faint num">
              {slide + 1} / {slides.length}
            </span>
            <button className="btn quiet" onClick={() => goTo(slide + 1)} disabled={slide === slides.length - 1} aria-label="Next slide">
              →
            </button>
          </div>
        )}
        <span className="phase">
          {phase === 'pitch' && (over ? 'Time is up. Wrap up when ready.' : 'The panel is listening')}
          {phase === 'qna' && (mode === 'spoken' ? 'Answer aloud. The next question comes when you finish.' : 'Answer aloud. The panelist will follow up if needed.')}
          {notice && <span className="faint"> · {notice}</span>}
        </span>
        <span className="spacer" />
        {phase === 'pitch' && (
          <>
            <button className="btn quiet" onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn primary" onClick={() => void endPitch()}>
              {config.questionCount ? 'End pitch and take questions' : 'End pitch'}
            </button>
          </>
        )}
        {phase === 'qna' && (
          <>
            <button className="btn quiet" onClick={() => skipRef.current?.abort()}>
              {mode === 'spoken' ? 'Next question' : 'Skip question'}
            </button>
            <button className="btn primary" onClick={() => void finish()}>
              Finish and see report
            </button>
          </>
        )}
        {phase === 'countdown' && (
          <button className="btn quiet" onClick={onCancel}>
            Back to setup
          </button>
        )}
      </div>

      {phase === 'countdown' && (
        <div className="overlay">
          <div className="card">
            <div className="countdown">{countdown}</div>
            <p className="muted">Look at the panel and stand naturally. Begin when the count ends.</p>
            {slides.length > 0 && <p className="faint">Use the arrow keys to change slides.</p>}
          </div>
        </div>
      )}
      {phase === 'finishing' && (
        <div className="overlay">
          <div className="card">
            <span className="spinner" />
            <h2>{finishStep}</h2>
            <p className="faint">This takes up to a minute.</p>
          </div>
        </div>
      )}
    </div>
  )
}
