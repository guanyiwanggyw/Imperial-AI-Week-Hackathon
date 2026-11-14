import { useEffect, useRef, useState } from 'react'
import { errorText, getJson, type Status } from '../api'
import { AnamTag } from '../avatar/AnamTag'
import { Steps, TopNav } from './Chrome'
import { matchAnamAvatars, withAnamIds, type AnamMatch } from '../avatar/anamMatch'
import { loadSlides } from '../lib/pdf'
import {
  backdropKey,
  generateImage,
  hasSynthesiaPortrait,
  initials,
  introKey,
  loadAssets,
  portraitKey,
  reactionKey,
  reactionStatus,
  REACTIONS,
  startReactionClips,
  saveSynthesiaPortrait,
  startSynthesiaFace,
  synthesiaStatus,
  type Assets,
} from '../lib/media'
import { blankPersona, DEFAULT_PITCH_SECONDS, DEFAULT_QUESTION_COUNT, drawPanel, PANELS } from '../personas'
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

/** Any panelist with a Synthesia intro but no Synthesia portrait yet gets a still from the intro. */
async function syncSynthesiaPortraits(current: Assets, personas: Persona[]): Promise<Assets> {
  const pending = personas.filter((p) => current[introKey(p)] && !hasSynthesiaPortrait(p, current))
  if (!pending.length) return current
  await Promise.allSettled(pending.map((p) => saveSynthesiaPortrait(p, current[introKey(p)])))
  return loadAssets()
}

export function Setup({ status, stream, streamError, onRequestMedia, onStart, onOpenSession }: Props) {
  const [panelId, setPanelId] = useState(PANELS[0].id)
  // A fresh random lineup from each panel's pool every time setup opens; "Shuffle panel" redraws it.
  const [drawn, setDrawn] = useState<Record<string, Panel>>(() => Object.fromEntries(PANELS.map((p) => [p.id, drawPanel(p)])))
  const [custom, setCustom] = useState<Panel>(customPanel)
  const [slides, setSlides] = useState<Slide[]>([])
  const [deckName, setDeckName] = useState<string | null>(null)
  const [pdfState, setPdfState] = useState<{ busy: boolean; progress: string; error: string | null }>({ busy: false, progress: '', error: null })
  const [drag, setDrag] = useState(false)
  const [pitchSeconds, setPitchSeconds] = useState(DEFAULT_PITCH_SECONDS)
  const [questionCount, setQuestionCount] = useState(DEFAULT_QUESTION_COUNT)
  // timed: solo pitch, then Q&A. interactive: no time limits; the panel joins in as you go.
  const [format, setFormat] = useState<'timed' | 'interactive'>('timed')
  const [context, setContext] = useState('')
  const [assets, setAssets] = useState<Assets>({})
  const [mediaBusy, setMediaBusy] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [playingIntro, setPlayingIntro] = useState<Persona | null>(null)
  const [history, setHistory] = useState<{ id: string; title: string; startedAt: string; overall: number | null }[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const [level, setLevel] = useState(0)

  const panel = panelId === 'custom' ? custom : drawn[panelId]

  // The Anam avatar for every agent on the panel: their own id, or a match (gender, then look).
  const matchKey = JSON.stringify(panel.personas.map((p) => [p.name, p.look, p.voiceId, p.anamAvatarId, p.anamVoiceId]))
  const [anam, setAnam] = useState<{ key: string; matches: AnamMatch[] } | null>(null)
  const anamMatches = anam?.key === matchKey ? anam.matches : null
  useEffect(() => {
    if (!status.anam) return
    let cancelled = false
    // Debounced, so typing in the custom panel does not fire a request per key.
    const timer = window.setTimeout(() => {
      matchAnamAvatars(panel.personas).then(
        (matches) => !cancelled && setAnam({ key: matchKey, matches }),
        (err) => console.warn('Anam avatar match failed:', err),
      )
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // panel.personas is captured through matchKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, status.anam])

  useEffect(() => {
    void loadAssets()
      .then((a) => syncSynthesiaPortraits(a, PANELS.flatMap((p) => p.pool ?? p.personas)))
      .then(setAssets)
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

  /** A Synthesia avatar face and a short spoken intro per panelist. Renders take a few minutes on Synthesia. */
  async function generateSynthesiaFaces(force = false) {
    setMediaError(null)
    setMediaBusy('Sending the panel to Synthesia')
    try {
      await Promise.all(panel.personas.map((p, i) => startSynthesiaFace(panel, p, i, force)))
      for (;;) {
        const states = await Promise.all(panel.personas.map((p) => synthesiaStatus(p)))
        const done = states.filter((s) => s.status !== 'running').length
        setMediaBusy(`Synthesia is rendering faces: ${done} of ${panel.personas.length} ready`)
        setAssets(await loadAssets().then((a) => syncSynthesiaPortraits(a, panel.personas)))
        if (done === panel.personas.length) {
          const errors = states.filter((s) => s.status === 'failed').map((s) => s.error)
          if (errors.length) setMediaError(`Synthesia could not render ${errors.length} face(s): ${errors[0]}`)
          break
        }
        await new Promise((r) => setTimeout(r, 5000))
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
  const hasIntros = panel.personas.every((p) => assets[introKey(p)])
  const clipCount = panel.personas.reduce((n, p) => n + REACTIONS.filter((r) => assets[reactionKey(p, r)]).length, 0)
  const canStart = Boolean(stream) && !pdfState.busy && panel.personas.length > 0

  return (
    <div className="app">
      <TopNav
        active="practice"
        onPast={history.length ? () => document.getElementById('past-sessions')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
        onFeedback={history.length ? () => onOpenSession(history[0].id) : undefined}
      />
      <div className="rp-wrap">
        <Steps current={0} />

        <div className="setup-grid">
          <div className="stack" style={{ gap: 24 }}>
            <section className="card setup-card">
              <h2 className="title">Tell us about your pitch</h2>
              <p className="muted">Give the panel a little context before you begin.</p>

              <h3 className="field-label">Who are you pitching to?</h3>
              <div className="panel-options">
                {[...PANELS, custom].map((p) => (
                  <button key={p.id} className={`panel-option ${p.id === panelId ? 'on' : ''}`} aria-pressed={p.id === panelId} onClick={() => setPanelId(p.id)}>
                    <span>
                      <strong>{p.name}</strong>
                      <span className="faint">{p.setting}</span>
                    </span>
                    {p.id === panelId && <i aria-hidden />}
                  </button>
                ))}
              </div>

              <h3 className="field-label">Slides</h3>
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
              <h3 className="field-label">Context for the panel</h3>
              <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={4} placeholder="Paste judging criteria, a job description or a README…" aria-label="Context for the panel" />
              <p className="hint">Optional. The panel uses it to ask sharper questions.</p>

              <div className="settings">
                <div>
                  <span>Session</span>
                  <div className="segmented">
                    <button className={format === 'timed' ? 'on' : ''} onClick={() => setFormat('timed')}>
                      Pitch, then questions
                    </button>
                    <button className={format === 'interactive' ? 'on' : ''} onClick={() => setFormat('interactive')}>
                      Interactive
                    </button>
                  </div>
                </div>
                {format === 'interactive' ? (
                  <p className="muted small">
                    No timer and no fixed Q&amp;A. Talk to the panel as you would in a real meeting: they ask when you pause, follow up on your answers,
                    react as you go, and the less patient ones may cut in if you run long. Finish whenever you like.
                  </p>
                ) : (
                  <>
                  <div>
                    <span>Pitch time</span>
                    <div className="segmented">
                      {PITCH_OPTIONS.map((s) => (
                        <button key={s} className={pitchSeconds === s ? 'on' : ''} onClick={() => setPitchSeconds(s)}>
                          {s / 60} min
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span>Follow-up questions</span>
                    <div className="segmented">
                      {QUESTION_OPTIONS.map((n) => (
                        <button key={n} className={questionCount === n ? 'on' : ''} onClick={() => setQuestionCount(n)}>
                          {n === 0 ? 'Off' : n}
                        </button>
                      ))}
                    </div>
                  </div>
                  </>
                )}
              </div>
            </section>

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
          </div>

          <div className="stack" style={{ gap: 24 }}>
            <section className="card setup-card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <h2 className="title">Meet your panel</h2>
                {panelId !== 'custom' && (panel.pool?.length ?? 0) > panel.personas.length && (
                  <button className="btn quiet" onClick={() => setDrawn((d) => ({ ...d, [panelId]: drawPanel(PANELS.find((p) => p.id === panelId)!) }))}>
                    Shuffle panel
                  </button>
                )}
              </div>
              <p className="muted">{panel.description}</p>

              <div className="experts">
                {panelId === 'custom' ? (
                  <div>
                    {custom.personas.map((p, i) => (
                      <div key={p.id} className="persona-edit">
                        <span className="avatar" style={{ width: 56, height: 56, cursor: assets[introKey(p)] ? 'pointer' : undefined }} onClick={() => assets[introKey(p)] && setPlayingIntro(p)} title={assets[introKey(p)] ? 'Play intro' : undefined}>
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
                          {/* A realistic live avatar is matched to the appearance; no ids are shown or typed here. */}
                          {status.anam && <AnamTag match={anamMatches?.[i]} />}
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
                  panel.personas.map((p, i) => (
                    <div key={p.id} className={`expert tone-${i % 3}`}>
                      {assets[portraitKey(p)] ? (
                        <span className="avatar">
                          <img src={assets[portraitKey(p)]} alt="" />
                        </span>
                      ) : (
                        <span className="no">{String(i + 1).padStart(2, '0')}</span>
                      )}
                      <div>
                        <strong>{p.name}</strong>
                        <span className="role">{p.role}</span>
                        <span className="desc">{p.personality}</span>
                        {status.anam && <AnamTag match={anamMatches?.[i]} />}
                        {assets[introKey(p)] && (
                          <button className="link" onClick={() => setPlayingIntro(p)} aria-label={`Play ${p.name}'s intro`}>
                            ▶ Play intro
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {playingIntro && assets[introKey(playingIntro)] && (
                <div className="intro-player">
                  <video key={playingIntro.id} src={assets[introKey(playingIntro)]} autoPlay playsInline controls onEnded={() => setPlayingIntro(null)} />
                  <div className="row small">
                    <span className="faint">{playingIntro.name} says hello</span>
                    <span className="spacer" />
                    <button className="btn quiet" onClick={() => setPlayingIntro(null)}>
                      Close
                    </button>
                  </div>
                </div>
              )}

              {(status.fal || status.synthesia) && (
                <div className="row small" style={{ flexWrap: 'wrap' }}>
                  {status.synthesia && (
                    <button
                      className="btn"
                      onClick={() => void generateSynthesiaFaces()}
                      disabled={Boolean(mediaBusy) || hasIntros}
                      title="Render a Synthesia avatar and a spoken intro for each panelist. Takes a few minutes."
                    >
                      {hasIntros ? 'Synthesia faces ready' : 'Synthesia faces'}
                    </button>
                  )}
                  {status.fal && (
                    <>
                      <button className="btn quiet" onClick={generatePanelImages} disabled={Boolean(mediaBusy)}>
                        {hasPortraits ? 'Regenerate missing images' : 'Generate room and portraits'}
                      </button>
                      <button className="btn quiet" onClick={generateReactions} disabled={Boolean(mediaBusy) || !hasPortraits}>
                        Animate reactions
                      </button>
                    </>
                  )}
                  <span className="faint">{mediaBusy ?? (clipCount ? `${clipCount} reaction clips ready` : '')}</span>
                </div>
              )}
              {mediaError && <div className="notice">{mediaError}</div>}

              <span className="eyebrow purple">AI-simulated experts</span>
              <p className="hint">Questions adapt to your pitch and your answers.</p>

              <button
                className="btn primary large start"
                disabled={!canStart}
                // The session uses exactly the Anam avatars shown here.
                onClick={() => onStart({ panel: { ...panel, personas: withAnamIds(panel.personas, anamMatches) }, slides, deckName, pitchSeconds, questionCount, context: context.trim(), format })}
              >
                Start practice session
              </button>
              <p className="hint center">{stream ? 'Your camera and microphone are ready' : 'Allow camera and microphone to start'}</p>
            </section>

            <section className="card stack">
              <h3>Services</h3>
              <div className="row small" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="chip"><i className={`dot ${status.elevenlabs ? 'on' : ''}`} /> Transcript</span>
                <span className="chip"><i className={`dot ${status.anthropic ? 'on' : ''}`} /> Questions and evaluation</span>
                <span className="chip"><i className={`dot ${status.anam ? 'on' : status.elevenlabsAgent ? 'on' : ''}`} /> {status.anam ? 'Live avatar' : 'Voice panel'}</span>
                <span className="chip"><i className={`dot ${status.fal ? 'on' : ''}`} /> Generated media</span>
                <span className="chip"><i className={`dot ${status.synthesia ? 'on' : ''}`} /> Synthesia faces</span>
              </div>
              {!status.elevenlabs && <p className="faint">Without a transcript, pace and fillers cannot be measured. Add an ElevenLabs key to the .env file.</p>}
            </section>

            {history.length > 0 && (
              <section className="card stack" id="past-sessions">
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
      </div>
    </div>
  )
}
