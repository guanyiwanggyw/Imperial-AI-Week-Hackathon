// "See yourself do it better": your weakest passage, rewritten by Claude, spoken in a clone of your voice
// (ElevenLabs, with consent; the clone is deleted straight after) and lip-synced onto your face (fal).
import { useEffect, useMemo, useState } from 'react'
import { getJson } from '../../api'
import type { Report, SessionData } from '../../types'
import type { Phrase, SampleX } from '../contracts'
import { formatTime } from '../metrics'

interface RedoResult {
  at: string
  start: number
  end: number
  original: string
  issue: string
  improved: string
  why: string
  cloned: boolean
  audioUrl: string
  videoUrl: string | null
  note: string | null
}

interface Passage {
  start: number
  end: number
  text: string
  issue: string
}

/** The passage to redo: around Claude's top priority, else the worst delivery warning, else the longest stretch. */
export function pickPassage(session: SessionData, report: Report): Passage | null {
  const ev = session.evaluation
  if (!ev || ev.insufficientSpeech) return null
  const phrases = ev.transcript
  const around = (t: number): Passage | null => {
    const run: Phrase[] = []
    for (const p of phrases) {
      if (p.end < t - 3) continue
      if (run.length && (p.t - run[run.length - 1].end > 2.5 || p.end - run[0].t > 16)) break
      run.push(p)
    }
    const text = run.map((p) => p.text).join(' ')
    return run.length && text.split(/\s+/).length >= 8 ? { start: run[0].t, end: run[run.length - 1].end, text, issue: '' } : null
  }
  const top = report.priorities.find((p) => p.t !== null)
  if (top) {
    const p = around(top.t!)
    if (p) return { ...p, issue: `${top.title}: ${top.detail}` }
  }
  const rank = { bad: 0, warn: 1, good: 2 }
  const worst = ev.events.filter((e) => e.severity !== 'good' && ['coherency', 'tone', 'timing'].includes(e.cat)).sort((a, b) => rank[a.severity] - rank[b.severity])
  for (const e of worst) {
    const p = around(e.t)
    if (p) return { ...p, issue: e.msg }
  }
  // Fallback: the stretch with the most words.
  let best: Passage | null = null
  for (const p of phrases) {
    const c = around(p.t)
    if (c && (!best || c.text.length > best.text.length)) best = c
  }
  return best ? { ...best, issue: 'Make it clearer and more confident' } : null
}

/** A frame of the recording where the face is visible and looking at the panel, as a JPEG data URL. */
async function captureFrame(src: string, samples: SampleX[], from: number, to: number): Promise<string> {
  const good = samples.find((s) => s.t >= from && s.t <= to && s.face && s.gazeOnTarget) ?? samples.find((s) => s.t >= from && s.t <= to && s.face)
  const t = good?.t ?? from
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = src
  await new Promise<void>((ok, fail) => {
    v.onloadeddata = () => ok()
    v.onerror = () => fail(new Error('The recording could not be loaded'))
  })
  v.currentTime = Math.max(0, Math.min(t, (v.duration || t + 1) - 0.1))
  await new Promise<void>((ok) => (v.onseeked = () => ok()))
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  c.getContext('2d')!.drawImage(v, 0, 0)
  return c.toDataURL('image/jpeg', 0.88)
}

async function runRedo(body: unknown, onStep: (s: string) => void): Promise<RedoResult> {
  const res = await fetch('/api/eval/redo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok || !res.body) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { error?: string }).error ?? `Request failed (${res.status})`)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const event = /^event: (.*)$/m.exec(chunk)?.[1]
      const data = /^data: (.*)$/m.exec(chunk)?.[1]
      if (!event || data === undefined) continue
      const parsed = JSON.parse(data)
      if (event === 'step') onStep(parsed as string)
      else if (event === 'result') return parsed as RedoResult
      else if (event === 'error') throw new Error((parsed as { error: string }).error)
    }
  }
  throw new Error('The request ended without a result')
}

/**
 * Estimated progress. The server reports named stages but the lip-sync model gives no percentage, so each
 * stage owns a slice of the bar and eases towards its end over its typical duration (never reaching it).
 */
const STAGES: { match: RegExp; from: number; to: number; seconds: number }[] = [
  { match: /frame/i, from: 0, to: 6, seconds: 2 },
  { match: /writing/i, from: 6, to: 22, seconds: 8 },
  { match: /cloning/i, from: 22, to: 36, seconds: 8 },
  { match: /speaking/i, from: 36, to: 46, seconds: 5 },
  { match: /lip-sync/i, from: 46, to: 98, seconds: 60 },
]

function useEstimatedProgress(step: string | null): number {
  const [now, setNow] = useState(() => Date.now())
  const [since, setSince] = useState(() => Date.now())
  useEffect(() => {
    setSince(Date.now())
    setNow(Date.now())
    if (!step) return
    const t = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(t)
  }, [step])
  const stage = step ? STAGES.find((s) => s.match.test(step)) : undefined
  if (!stage) return 0
  const elapsed = Math.max(0, (now - since) / 1000)
  // ~86% of the slice after the typical duration, then a slow creep
  return stage.from + (stage.to - stage.from) * (1 - Math.exp((-2 * elapsed) / stage.seconds))
}

interface Props {
  session: SessionData
  report: Report
  /** Recording URL (server or local blob). */
  src: string | null
  seek: (t: number) => void
}

export function DoItBetter({ session, report, src, seek }: Props) {
  const passage = useMemo(() => pickPassage(session, report), [session, report])
  const [consent, setConsent] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<RedoResult[]>([])
  const progress = useEstimatedProgress(step)

  useEffect(() => {
    getJson<RedoResult[]>(`/api/eval/redo/${session.id}`, 8000).then(setResults, () => undefined)
  }, [session.id])

  if (!src || !session.evaluation) return null
  if (!passage) {
    return (
      <section className="rp-card rp-redo">
        <h2>See yourself do it better</h2>
        <p className="rp-muted">
          Once you have said a few full sentences (a passage of at least 8 words), this rewrites your weakest one and shows you delivering it better, in your own
          voice and on your own face.
        </p>
      </section>
    )
  }

  async function start() {
    if (!passage || !src) return
    setError(null)
    setStep('Grabbing a frame of you from the recording')
    try {
      const frame = await captureFrame(src, session.evaluation!.samples, passage.start, passage.end)
      const result = await runRedo(
        { sessionId: session.id, start: passage.start, end: passage.end, original: passage.text, issue: passage.issue, context: session.config.context, frame, consent },
        setStep,
      )
      setResults((r) => [...r, result])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStep(null)
    }
  }

  const latest = results[results.length - 1]
  return (
    <section className="rp-card rp-redo">
      <h2>See yourself do it better</h2>
      <p className="rp-muted">Your weakest passage, rewritten and delivered with better pacing: in your own voice, on your own face.</p>
      <div className="rp-redo-grid">
        <div className="stack">
          <span className="rp-eyebrow">
            What you said · {formatTime(passage.start)}–{formatTime(passage.end)}
          </span>
          <blockquote>“{passage.text}”</blockquote>
          <span className="rp-eyebrow">What to improve</span>
          <p>{passage.issue}</p>
          <button className="rp-jump" style={{ alignSelf: 'flex-start' }} onClick={() => seek(passage.start)}>
            Watch the original
          </button>
          <label className="rp-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={Boolean(step)} />
            <span>Use my voice from this session. A temporary voice clone is made with ElevenLabs and deleted straight after. Without this, a stock voice is used.</span>
          </label>
          <button className="rp-btn" onClick={() => void start()} disabled={Boolean(step)}>
            {step ? 'Working…' : latest ? 'Make another version' : 'Show me'}
          </button>
          {error && <p className="rp-muted">Could not make it: {error}</p>}
        </div>
        <div className="stack">
          {step ? (
            <div className="rp-redo-progress" aria-live="polite">
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Making the improved clip">
                <div className="fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="meta">
                <span>{step}</span>
                <span>{Math.round(progress)}%</span>
              </div>
            </div>
          ) : latest ? (
            <>
              {latest.videoUrl ? (
                <video src={latest.videoUrl} controls playsInline className="rp-redo-video" />
              ) : (
                <audio src={latest.audioUrl} controls style={{ width: '100%' }} />
              )}
              {latest.note && <p className="rp-muted small">{latest.note}</p>}
              <span className="rp-eyebrow">The better version{latest.cloned ? ' · your voice' : ' · stock voice'}</span>
              <blockquote>“{latest.improved}”</blockquote>
              <p className="rp-muted">{latest.why}</p>
            </>
          ) : (
            <p className="rp-muted empty">The improved clip appears here. It takes about a minute.</p>
          )}
        </div>
      </div>
    </section>
  )
}
