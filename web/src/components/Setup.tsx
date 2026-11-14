import { useEffect, useRef, useState } from 'react'
import { errorText, getJson, type Status } from '../api'
import { loadSlides } from '../lib/pdf'
import {
  backdropKey,
  generateImage,
  initials,
  loadAssets,
  portraitKey,
  reactionKey,
  reactionStatus,
  REACTIONS,
  startReactionClips,
  type Assets,
} from '../lib/media'
import { blankPersona, DEFAULT_PITCH_SECONDS, DEFAULT_QUESTION_COUNT, PANELS } from '../personas'
import type { Panel, Persona, SessionConfig, Slide } from '../types'

interface Props {
  status: Status
  stream: MediaStream | null
  streamError: string | null
  onRequestMedia: () => void
  onStart: (config: SessionConfig) => void
  onOpenSession: (id: string) => void
}

const PITCH_OPTIONS = [60, 120, 180, 300]
const QUESTION_OPTIONS = [0, 1, 2, 3, 5]

function customPanel(): Panel {
  return {
    id: 'custom',
    name: 'Custom panel',
    description: 'Describe your own audience.',
    setting: 'Meeting room',
    backdropPrompt:
      'A calm, modern meeting room seen from the presenter position, soft daylight, muted neutral tones, no people, photorealistic.',
    personas: [blankPersona(1), blankPersona(2)],
  }
}

export function Setup({ status, stream, streamError, onRequestMedia, onStart, onOpenSession }: Props) {
  const [panelId, setPanelId] = useState(PANELS[0].id)
  const [custom, setCustom] = useState<Panel>(customPanel)
  const [slides, setSlides] = useState<Slide[]>([])
  const [deckName, setDeckName] = useState<string | null>(null)
  const [pdfState, setPdfState] = useState<{ busy: boolean; progress: string; error: string | null }>({ busy: false, progress: '', error: null })
  const [drag, setDrag] = useState(false)
  const [pitchSeconds, setPitchSeconds] = useState(DEFAULT_PITCH_SECONDS)
  const [questionCount, setQuestionCount] = useState(DEFAULT_QUESTION_COUNT)
  const [context, setContext] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [assets, setAssets] = useState<Assets>({})
  const [mediaBusy, setMediaBusy] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ id: string; title: string; startedAt: string; overall: number | null }[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const [level, setLevel] = useState(0)

  const panel = panelId === 'custom' ? custom : PANELS.find((p) => p.id === panelId)!

  useEffect(() => {
    void loadAssets().then(setAssets)
    getJson<typeof history>('/api/sessions', 5000).then(setHistory, () => setHistory([]))
  }, [])

  // Camera preview and a simple microphone level meter.
  useEffect(() => {
    if (!stream) return
    if (preview.current) preview.current.srcObject = stream
    if (!stream.getAudioTracks().length) return
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let raf = 0
    const loop = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 10))
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      void ctx.close()
    }
  }, [stream])

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfState({ busy: false, progress: '', error: 'Please choose a PDF file.' })
      return
    }
    setPdfState({ busy: true, progress: 'Reading slides', error: null })
    try {
      const result = await loadSlides(file, (done, total) => setPdfState({ busy: true, progress: `Reading slide ${done} of ${total}`, error: null }))
      setSlides(result)
      setDeckName(file.name)
      setPdfState({ busy: false, progress: '', error: null })
    } catch (err) {
      setPdfState({ busy: false, progress: '', error: `Could not read this PDF. ${errorText(err)}` })
    }
  }

  /** Backdrop and portraits for the selected panel, generated with fal and cached. */
  async function generatePanelImages() {
    setMediaError(null)
    try {
      setMediaBusy('Generating the room')
      const jobs: Promise<unknown>[] = []
      if (!assets[backdropKey(panel)]) jobs.push(generateImage(backdropKey(panel), panel.backdropPrompt, 'backdrop'))
      for (const p of panel.personas) if (!assets[portraitKey(p)]) jobs.push(generateImage(portraitKey(p), p.look, 'portrait'))
      setMediaBusy(`Generating ${jobs.length} images`)
      const results = await Promise.allSettled(jobs)
      setAssets(await loadAssets())
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length) setMediaError(`${failed.length} image(s) could not be generated. The panel will use initials instead.`)
    } finally {
      setMediaBusy(null)
    }
  }

  /** Short reaction clips per panelist (image to video). Slow, so it runs in the background on the server. */
  async function generateReactions() {
    setMediaError(null)
    const ready = panel.personas.filter((p) => assets[portraitKey(p)])
    if (!ready.length) {
      setMediaError('Generate portraits first.')
      return
    }
    setMediaBusy('Animating reactions, this takes a few minutes')
    try {
      await Promise.all(ready.map((p) => startReactionClips(p, assets[portraitKey(p)])))
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000))
        const states = await Promise.all(ready.map((p) => reactionStatus(p)))
        const done = states.reduce((n, s) => n + s.done, 0)
        setMediaBusy(`Animating reactions: ${done} of ${ready.length * REACTIONS.length} clips`)
        setAssets(await loadAssets())
        if (states.every((s) => s.status !== 'running')) {
          const errors = states.flatMap((s) => s.errors)
          if (errors.length) setMediaError(`Some clips failed (${errors.length}). Those reactions use a subtle motion instead.`)
          break
        }
      }
    } catch (err) {
      setMediaError(errorText(err))
    } finally {
      setMediaBusy(null)
    }
  }

  function updatePersona(i: number, patch: Partial<Persona>) {
    setCustom((c) => ({ ...c, personas: c.personas.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  }

  const hasPortraits = panel.personas.every((p) => assets[portraitKey(p)])
  const clipCount = panel.personas.reduce((n, p) => n + REACTIONS.filter((r) => assets[reactionKey(p, r)]).length, 0)
  const canStart = Boolean(stream) && !pdfState.busy && panel.personas.length > 0

  return (
    <div className="page">
      <div className="header">
        <h1>Pitch sparring partner</h1>
        <span className="muted">Practise in front of a panel that listens, reacts and asks the hard questions.</span>
      </div>

      <div className="setup-grid">
        <div className="stack" style={{ gap: 20 }}>
          <section className="card stack">
            <h2>Audience</h2>
            <div className="panel-options">
              {[...PANELS, custom].map((p) => (
                <button key={p.id} className={`panel-option ${p.id === panelId ? 'on' : ''}`} onClick={() => setPanelId(p.id)}>
                  <strong>{p.name}</strong>
                  <span className="faint">{p.setting}</span>
                  <span className="faces">
                    {p.personas.map((x) => (
                      <span key={x.id} className="avatar">
                        {assets[portraitKey(x)] ? <img src={assets[portraitKey(x)]} alt="" /> : initials(x.name)}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <p className="muted small">{panel.description}</p>

            {panelId === 'custom' ? (
              <div>
                {custom.personas.map((p, i) => (
                  <div key={p.id} className="persona-edit">
                    <span className="avatar" style={{ width: 56, height: 56 }}>
                      {assets[portraitKey(p)] ? <img src={assets[portraitKey(p)]} alt="" /> : initials(p.name)}
                    </span>
                    <div className="stack" style={{ gap: 8 }}>
                      <div className="row">
                        <input type="text" value={p.name} onChange={(e) => updatePersona(i, { name: e.target.value })} aria-label="Name" />
                        <input type="text" value={p.role} onChange={(e) => updatePersona(i, { role: e.target.value })} aria-label="Role" />
                      </div>
                      <input type="text" value={p.personality} onChange={(e) => updatePersona(i, { personality: e.target.value })} aria-label="Personality" />
                      <div className="row">
                        <input
                          type="text"
                          value={p.focus.join(', ')}
                          onChange={(e) => updatePersona(i, { focus: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                          aria-label="Focus areas"
                          placeholder="Focus areas, comma separated"
                        />
                        <label className="row faint" style={{ flex: 'none', gap: 6 }}>
                          Strictness
                          <input type="range" min={1} max={5} value={p.strictness} onChange={(e) => updatePersona(i, { strictness: Number(e.target.value) })} />
                        </label>
                      </div>
                      <input type="text" value={p.look} onChange={(e) => updatePersona(i, { look: e.target.value })} aria-label="Appearance for the portrait" placeholder="Appearance, used to generate the portrait" />
                    </div>
                  </div>
                ))}
                <div className="row" style={{ marginTop: 8 }}>
                  {custom.personas.length < 3 && (
                    <button className="btn quiet" onClick={() => setCustom((c) => ({ ...c, personas: [...c.personas, blankPersona(c.personas.length + 1)] }))}>
                      Add panelist
                    </button>
                  )}
                  {custom.personas.length > 1 && (
                    <button className="btn quiet" onClick={() => setCustom((c) => ({ ...c, personas: c.personas.slice(0, -1) }))}>
                      Remove last
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {panel.personas.map((p) => (
                  <div key={p.id} className="row">
                    <span className="avatar" style={{ width: 36, height: 36 }}>
                      {assets[portraitKey(p)] ? <img src={assets[portraitKey(p)]} alt="" /> : initials(p.name)}
                    </span>
                    <div>
                      <div>
                        {p.name} <span className="faint">· {p.role}</span>
                      </div>
                      <div className="faint">{p.personality}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {status.fal && (
              <div className="row small" style={{ flexWrap: 'wrap' }}>
                <button className="btn" onClick={generatePanelImages} disabled={Boolean(mediaBusy)}>
                  {hasPortraits ? 'Regenerate missing images' : 'Generate room and portraits'}
                </button>
                <button className="btn quiet" onClick={generateReactions} disabled={Boolean(mediaBusy) || !hasPortraits}>
                  Animate reactions
                </button>
                <span className="faint">{mediaBusy ?? (clipCount ? `${clipCount} reaction clips ready` : '')}</span>
              </div>
            )}
            {mediaError && <div className="notice">{mediaError}</div>}
          </section>

          <section className="card stack">
            <h2>Slides</h2>
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                void onFile(e.dataTransfer.files[0])
              }}
              role="button"
              tabIndex={0}
            >
              {pdfState.busy ? pdfState.progress : deckName ? `${deckName} · ${slides.length} slides · choose another` : 'Drop a PDF here or click to choose. Optional.'}
            </div>
            <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            {pdfState.error && <div className="notice">{pdfState.error}</div>}
            {slides.length > 0 && (
              <div className="thumbs">
                {slides.map((s) => (
                  <img key={s.index} src={s.image} alt={`Slide ${s.index + 1}`} />
                ))}
              </div>
            )}
          </section>

          <section className="card stack">
            <h2>Timing</h2>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="muted">Pitch length</span>
              <div className="segmented">
                {PITCH_OPTIONS.map((s) => (
                  <button key={s} className={pitchSeconds === s ? 'on' : ''} onClick={() => setPitchSeconds(s)}>
                    {s / 60} min
                  </button>
                ))}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="muted">Questions afterwards</span>
              <div className="segmented">
                {QUESTION_OPTIONS.map((n) => (
                  <button key={n} className={questionCount === n ? 'on' : ''} onClick={() => setQuestionCount(n)}>
                    {n === 0 ? 'Off' : n}
                  </button>
                ))}
              </div>
            </div>
            {showContext ? (
              <label className="field">
                Context for the panel, such as judging criteria, a job description or a README
                <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={5} autoFocus />
              </label>
            ) : (
              <button className="btn quiet" style={{ alignSelf: 'flex-start' }} onClick={() => setShowContext(true)}>
                Add context for the panel
              </button>
            )}
          </section>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <section className="card stack">
            <h2>Camera and microphone</h2>
            <div className="preview">
              <video ref={preview} autoPlay muted playsInline />
              {!stream && (
                <div className="empty">
                  <div className="stack" style={{ alignItems: 'center' }}>
                    <span>{streamError ?? 'The panel needs to see and hear you.'}</span>
                    <button className="btn" onClick={onRequestMedia}>
                      Allow camera and microphone
                    </button>
                  </div>
                </div>
              )}
            </div>
            {stream && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="faint">Say something to check your microphone</span>
                <div className="level">
                  <div style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              </div>
            )}
            <p className="faint">Video is analysed on this device and never uploaded for analysis.</p>
          </section>

          <section className="card stack">
            <h3>Services</h3>
            <div className="row small" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="chip"><i className={`dot ${status.elevenlabs ? 'on' : ''}`} /> Transcript</span>
              <span className="chip"><i className={`dot ${status.anthropic ? 'on' : ''}`} /> Questions and evaluation</span>
              <span className="chip"><i className={`dot ${status.anam ? 'on' : status.elevenlabsAgent ? 'on' : ''}`} /> {status.anam ? 'Avatar panel' : 'Voice panel'}</span>
              <span className="chip"><i className={`dot ${status.fal ? 'on' : ''}`} /> Generated media</span>
            </div>
            {!status.elevenlabs && <p className="faint">Without a transcript, pace and fillers cannot be measured. Add an ElevenLabs key to the .env file.</p>}
          </section>

          {history.length > 0 && (
            <section className="card stack">
              <h3>Past sessions</h3>
              <div className="history">
                {history.slice(0, 6).map((h) => (
                  <button key={h.id} onClick={() => onOpenSession(h.id)}>
                    <span>{h.title}</span>
                    <span className="faint num">
                      {typeof h.overall === 'number' ? `${h.overall.toFixed(1)} · ` : ''}
                      {new Date(h.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="start-bar">
        <button
          className="btn primary large"
          disabled={!canStart}
          onClick={() => onStart({ panel, slides, deckName, pitchSeconds, questionCount, context: context.trim() })}
        >
          Start pitch
        </button>
        {!stream && <span className="faint">Allow camera and microphone to start</span>}
      </div>
    </div>
  )
}
