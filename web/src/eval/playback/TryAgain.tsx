// "Try that answer again": pick a weak answer (or passage), the panelist asks it again out loud, you answer on camera,
// and the report shows the original and the retry side by side, measured the same way.
import { useEffect, useMemo, useRef, useState } from 'react'
import { errorText, postJson } from '../../api'
import type { Report, SessionData } from '../../types'
import { formatTime } from '../metrics'
import { askAloud, loadRetries, RetryCapture } from '../retry/capture'
import { attemptOverall, compareRows, improvement, measure, retryTargets, SAME, type AttemptMetrics, type CompareRow, type RetryAttempt, type RetryTarget } from '../retry/retry'

interface Props {
  session: SessionData
  report: Report
  /** Older 0–10 reports are scaled by 10. */
  k: number
}

export function TryAgain({ session, report, k }: Props) {
  const ev = session.evaluation
  const targets = useMemo(() => (ev && !ev.insufficientSpeech ? retryTargetsSafe(session, report, k) : []), [session, report, k, ev])
  const [sel, setSel] = useState(0)
  const [attempts, setAttempts] = useState<RetryAttempt[]>([])
  const [studio, setStudio] = useState(0) // > 0 while the overlay is open; bumping it restarts the overlay
  const card = useRef<HTMLElement>(null)

  useEffect(() => {
    loadRetries<RetryAttempt>(session.id).then(setAttempts, () => undefined)
  }, [session.id])

  const target = targets[sel] as RetryTarget | undefined
  const before = useMemo(() => (ev && target ? measure(ev.samples, ev.transcript, target.from, target.to) : null), [ev, target])
  if (!ev || !target || !before) return null

  const mine = attempts.filter((a) => a.targetId === target.id)
  const latest = mine[mine.length - 1]

  return (
    <section className="rp-card ta" id="try-again" ref={card}>
      <div className="rp-card-head">
        <h2>Try that answer again</h2>
        {mine.length > 0 && (
          <span className="rp-eyebrow">
            {mine.length} {mine.length === 1 ? 'attempt' : 'attempts'}
          </span>
        )}
      </div>
      <p className="rp-muted">Take another go at your weakest moments. The panel asks again, you answer on camera, and we score both attempts the same way.</p>

      {targets.length > 1 && (
        <div className="hs-chips ta-picker" role="radiogroup" aria-label="What to retry">
          {targets.map((t, i) => (
            <button key={t.id} className={i === sel ? 'on' : ''} role="radio" aria-checked={i === sel} onClick={() => setSel(i)}>
              {t.title}
              {t.priorScore !== null && <span className="sc">{t.priorScore}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="ta-grid">
        <div className="stack">
          <span className="rp-eyebrow">{target.kind === 'question' ? `${target.personaName} asked · ${formatTime(target.from)}` : `What you said · ${formatTime(target.from)}`}</span>
          {target.kind === 'question' && <p className="ta-q">{target.prompt}</p>}
          {target.kind === 'question' && <span className="rp-eyebrow">Your answer</span>}
          <blockquote className="ta-orig">{target.original ? `“${target.original}”` : 'No answer was captured.'}</blockquote>
          <span className="rp-eyebrow">What to fix</span>
          <p className="ta-issue">{target.issue}</p>
          <button className="rp-btn-primary ta-go" onClick={() => setStudio((n) => n + 1)}>
            {latest ? 'Try again' : target.kind === 'question' ? 'Answer it again' : 'Say it again'}
          </button>
          <p className="rp-muted small">Uses your camera and microphone. Your new attempt is recorded in this tab only; its transcript and scores are saved with the session.</p>
        </div>
        <div className="stack">
          {latest ? (
            <Result attempt={latest} earlier={mine.slice(0, -1)} />
          ) : (
            <p className="rp-muted empty">Your new attempt appears here, with the before and after scores side by side.</p>
          )}
        </div>
      </div>

      {studio > 0 && (
        <Studio
          key={studio}
          session={session}
          target={target}
          before={before}
          onDone={(a) => {
            setAttempts((xs) => [...xs, a])
            setStudio(0)
            window.setTimeout(() => card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
          }}
          onRestart={() => setStudio((n) => n + 1)}
          onClose={() => setStudio(0)}
        />
      )}
    </section>
  )
}

/** Old or partial sessions must not break the report: no targets instead of a crash. */
function retryTargetsSafe(session: SessionData, report: Report, k: number) {
  try {
    return retryTargets(session, report, k)
  } catch {
    return []
  }
}

// ---------- result ----------

const signed = (n: number, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`

function changeCell(row: CompareRow) {
  const imp = improvement(row)
  if (row.before === null || row.after === null) return { text: '—', tone: 'none' }
  const d = row.after - row.before
  const text = row.key === 'fillers' ? `${signed(d, 1)}/min` : row.key === 'pace' ? `${signed(Math.round(d))} wpm` : row.key === 'length' ? `${signed(Math.round(d))}s` : signed(Math.round(d))
  if (imp === null) return { text, tone: 'none' }
  const same = SAME[row.better]
  return { text: Math.abs(imp) < same ? 'Same' : text, tone: imp >= same ? 'good' : imp <= -same ? 'bad' : 'same' }
}

function Result({ attempt, earlier }: { attempt: RetryAttempt; earlier: RetryAttempt[] }) {
  const ob = attemptOverall(attempt.before.metrics, attempt.judgement?.before.score ?? null)
  const oa = attemptOverall(attempt.after.metrics, attempt.judgement?.after.score ?? null)
  const d = ob !== null && oa !== null ? oa - ob : null
  const tone = d === null ? 'none' : d >= 3 ? 'good' : d <= -3 ? 'bad' : 'same'
  const rows = compareRows(attempt)
  const metricsFor = (side: 'before' | 'after'): AttemptMetrics => attempt[side].metrics
  return (
    <div className="ta-result">
      <div className="ta-overall">
        <span className="rp-eyebrow">Overall for this answer</span>
        <div className="nums">
          <span className="b">{ob ?? '–'}</span>
          <span className="arrow" aria-label="to">
            →
          </span>
          <span className="a">{oa ?? '–'}</span>
          {d !== null && <span className={`ta-delta ${tone}`}>{Math.abs(d) < 3 ? 'About the same' : signed(d)}</span>}
        </div>
        {attempt.judgement && <p className="rp-muted small">{attempt.judgement.after.note}</p>}
      </div>

      <table className="ta-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr">Measure</span>
            </th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = changeCell(r)
            return (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.before === null ? '—' : r.format(r.before, metricsFor('before'))}</td>
                <td className="after">{r.after === null ? '—' : r.format(r.after, metricsFor('after'))}</td>
                <td>
                  <span className={`ta-chg ${c.tone}`}>{c.text}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {attempt.judgement && attempt.judgement.better.length > 0 && (
        <>
          <span className="rp-eyebrow">What got better</span>
          <ul className="ta-list">
            {attempt.judgement.better.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </>
      )}
      {attempt.judgement && (
        <>
          <span className="rp-eyebrow">Next time</span>
          <p className="ta-issue">{attempt.judgement.next}</p>
        </>
      )}
      {attempt.judgeError && <p className="rp-muted small">Clarity could not be judged ({attempt.judgeError}), so the filler-and-pause measure stands in for it.</p>}
      {attempt.localVideo && <video className="ta-video" src={attempt.localVideo} controls playsInline />}
      <details className="ta-said">
        <summary>Compare what you said</summary>
        <span className="rp-eyebrow">Before</span>
        <p>{attempt.before.text || 'No answer was captured.'}</p>
        <span className="rp-eyebrow">After</span>
        <p>{attempt.after.text}</p>
      </details>
      {earlier.length > 0 && (
        <p className="rp-muted small">
          Earlier attempts:{' '}
          {earlier
            .map((a) => attemptOverall(a.after.metrics, a.judgement?.after.score ?? null))
            .map((v) => v ?? '–')
            .join(', ')}
        </p>
      )}
    </div>
  )
}

// ---------- recording overlay ----------

type Stage = 'camera' | 'countdown' | 'asking' | 'connecting' | 'answering' | 'scoring' | 'error'

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))
/** Stop on its own after this long a pause, once enough has been said. */
const PAUSE_STOP_SEC = 5
const MAX_SEC = 90

function Studio({
  session,
  target,
  before,
  onDone,
  onRestart,
  onClose,
}: {
  session: SessionData
  target: RetryTarget
  before: AttemptMetrics
  onDone: (a: RetryAttempt) => void
  onRestart: () => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const cap = useRef<RetryCapture | null>(null)
  const goAt = useRef(0)
  const finishing = useRef(false)
  const skipAsk = useRef<AbortController | null>(null)
  const [stage, setStage] = useState<Stage>('camera')
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    let cancelled = false
    const abort = new AbortController()
    let stream: MediaStream | null = null
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } })
        if (cancelled || !video.current) return
        video.current.srcObject = stream
        await video.current.play().catch(() => undefined)
        const c = new RetryCapture(stream, () => force((n) => n + 1))
        cap.current = c
        c.calibrate(video.current)
        setStage('countdown')
        for (let n = 3; n > 0; n--) {
          setCount(n)
          await sleep(1000)
          if (cancelled) return
        }
        if (target.kind === 'question') {
          setStage('asking')
          skipAsk.current = new AbortController()
          abort.signal.addEventListener('abort', () => skipAsk.current?.abort())
          await askAloud(target.prompt, target.voiceId, skipAsk.current.signal)
          if (cancelled) return
        }
        c.start()
        setStage('connecting')
        const t0 = performance.now()
        while (!c.transcript.ready && !c.transcript.error && performance.now() - t0 < 5000) {
          await sleep(100)
          if (cancelled) return
        }
        if (c.transcript.error) throw new Error(`The transcriber could not start: ${c.transcript.error}`)
        goAt.current = c.now()
        setStage('answering')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Camera or microphone access was blocked. Allow it in the address bar, then try again.' : errorText(err))
        setStage('error')
      }
    })()
    return () => {
      cancelled = true
      abort.abort()
      cap.current?.dispose()
      cap.current = null
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function finish() {
    const c = cap.current
    if (finishing.current || !c) return
    finishing.current = true
    setStage('scoring')
    try {
      const lastSpeech = c.lastSpeechAt()
      const r = await c.stop()
      ;(video.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop())
      const end = Math.max(goAt.current + 1, Math.min(r.end, lastSpeech + 1))
      const text = r.phrases
        .filter((p) => p.end > goAt.current)
        .map((p) => p.text)
        .join(' ')
        .trim()
      const metrics = measure(r.samples, r.phrases, goAt.current, end)
      if (metrics.words < 6) throw new Error(`We only heard ${metrics.words} ${metrics.words === 1 ? 'word' : 'words'}. Answer out loud, then press Done.`)
      const saved = await postJson<RetryAttempt>(
        '/api/eval/retry',
        {
          sessionId: session.id,
          target: { id: target.id, kind: target.kind, title: target.title, prompt: target.prompt, issue: target.issue },
          before: { text: target.original, metrics: before },
          after: { text, metrics },
          context: session.config.context,
        },
        70_000,
      )
      onDone({ ...saved, localVideo: r.video ? URL.createObjectURL(r.video) : undefined })
    } catch (err) {
      setError(errorText(err))
      setStage('error')
    }
  }

  // While answering: the timer, and stopping on its own after a pause or at the time limit.
  useEffect(() => {
    if (stage !== 'answering') return
    const t = window.setInterval(() => {
      const c = cap.current
      if (!c) return
      const now = c.now()
      setElapsed(now - goAt.current)
      const words = c.transcript.phrases.filter((p) => p.end > goAt.current).reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0)
      const paused = now - Math.max(goAt.current, c.lastSpeechAt()) > PAUSE_STOP_SEC && !c.transcript.partial
      if (now - goAt.current > MAX_SEC || (words >= 8 && paused)) void finish()
    }, 250)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stage !== 'scoring' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, onClose])

  const c = cap.current
  const said = c ? [...c.transcript.phrases.filter((p) => p.end > goAt.current).map((p) => p.text), c.transcript.partial].join(' ').trim() : ''
  const status: Record<Stage, string> = {
    camera: 'Starting your camera and microphone…',
    countdown: `Look at the camera as if it were the panel. Starting in ${count}…`,
    asking: `${target.personaName ?? 'The panel'} is asking…`,
    connecting: 'Get ready…',
    answering:
      target.kind === 'question'
        ? `Your turn. Answer now, then press Done. We stop on our own after a ${PAUSE_STOP_SEC}-second pause.`
        : `Your turn. Say it again, then press Done. We stop on our own after a ${PAUSE_STOP_SEC}-second pause.`,
    scoring: 'Scoring your new attempt against the original…',
    error: error ?? 'Something went wrong.',
  }

  return (
    <div className="ta-overlay" role="dialog" aria-modal="true" aria-label="Try that answer again">
      <div className="ta-studio">
        <div className="ta-stage">
          <video ref={video} muted playsInline className="ta-self" />
          {stage === 'countdown' && <div className="ta-count">{count}</div>}
          {stage === 'answering' && (
            <span className="ta-rec">
              <i /> {formatTime(elapsed)}
            </span>
          )}
          {stage === 'asking' && <div className="ta-asking">{target.personaName} is asking</div>}
        </div>
        <div className="ta-side">
          <span className="rp-eyebrow">{target.kind === 'question' ? `${target.personaName} asks` : 'Say it again, better'}</span>
          <p className="ta-q">{target.kind === 'question' ? target.prompt : `“${target.original}”`}</p>
          <div className="ta-tip">
            <span className="rp-eyebrow">Focus on</span>
            <p>{target.issue}</p>
          </div>
          <p className={`ta-status ${stage === 'error' ? 'err' : ''}`} aria-live="polite">
            {(stage === 'scoring' || stage === 'camera' || stage === 'connecting') && <span className="spinner" />}
            {status[stage]}
          </p>
          {stage === 'answering' && <p className="ta-live">{said || 'Listening…'}</p>}
          <div className="ta-actions">
            {stage === 'asking' && (
              <button className="rp-btn-primary" onClick={() => skipAsk.current?.abort()}>
                Skip to my answer
              </button>
            )}
            {stage === 'answering' && (
              <button className="rp-btn-primary" onClick={() => void finish()}>
                Done
              </button>
            )}
            {stage === 'error' && (
              <button className="rp-btn-primary" onClick={onRestart}>
                Try again
              </button>
            )}
            <button className="rp-btn" onClick={onClose} disabled={stage === 'scoring'}>
              {stage === 'error' ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
