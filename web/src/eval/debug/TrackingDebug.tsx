// Tracking debug page (/#/eval-debug). Shows the webcam with MediaPipe landmarks drawn on top and every
// live reading the evaluation computes from them, so thresholds can be checked against a real face and body.
// No transcript or API keys needed; RoomState runs without phrases.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BodyBreakdown, Calibration, FeedbackEvent, RoomState, SampleX } from '../contracts'
import { Calibrator } from '../calibration'
import { formatTime } from '../metrics'
import { computeRoomState } from '../roomState'
import { RuleEngine } from '../rules'
import { bodyBreakdown, bodyScore, eyeScore, toneScore } from '../scores'
import { AudioMeter } from '../signals/audio'
import { SignalSampler } from '../signals/sampler'
import { VisionTracker } from '../signals/vision'
import { T } from '../thresholds'
import { TrackingOverlay, type OverlayLayers } from './TrackingOverlay'

interface Props {
  stream: MediaStream | null
  streamError: string | null
  onRequestMedia: () => void
  onBack: () => void
}

interface Reading {
  sample: SampleX | null
  room: RoomState | null
  scores: { eye: number | null; body: number | null; tone: number | null }
  breakdown: BodyBreakdown | null
  events: FeedbackEvent[]
  level: number
}

const CALIBRATE_SEC = 5

function Row({ label, value, state }: { label: string; value: string; state?: 'good' | 'warn' | 'bad' | null }) {
  const color = state ? `var(--${state})` : 'var(--text-3)'
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '3px 0' }}>
      <span className="row" style={{ gap: 8 }}>
        <span className="dot" style={{ background: color }} />
        {label}
      </span>
      <span className="num" style={{ color: state ? color : undefined }}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-3)' }}>{title}</h3>
      {children}
    </section>
  )
}

const fmtScore = (n: number | null) => (n === null ? '–' : String(n))
const scoreState = (n: number | null) => (n === null ? null : n >= 70 ? 'good' : n >= 45 ? 'warn' : 'bad')

export function TrackingDebug({ stream, streamError, onRequestMedia, onBack }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const engine = useMemo(() => {
    const vision = new VisionTracker()
    const audio = new AudioMeter()
    return { vision, audio, sampler: new SignalSampler(vision, audio), rules: new RuleEngine(), startedAt: performance.now() }
  }, [])
  const [layers, setLayers] = useState<OverlayLayers>({ face: true, hands: true, pose: true })
  const [reading, setReading] = useState<Reading>({ sample: null, room: null, scores: { eye: null, body: null, tone: null }, breakdown: null, events: [], level: 0 })
  const [calibration, setCalibration] = useState<Calibration>(engine.sampler.calibration)
  const [calibrating, setCalibrating] = useState<number | null>(null)
  const [visionState, setVisionState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!stream || !video.current) return
    const { vision, audio, sampler, rules, startedAt } = engine
    const now = () => (performance.now() - startedAt) / 1000
    video.current.srcObject = stream
    audio.start(stream)
    void vision.start(video.current).then(() => setVisionState(vision.error ? 'error' : 'ready'))
    sampler.start(now, () => true, (s) => rules.onSample(s))
    let room: RoomState | null = null
    const roomTimer = window.setInterval(() => {
      room = computeRoomState({ now: now(), samples: sampler.samples, phrases: [], partial: '', agentTurns: [], agentSpeaking: false, pitchEnded: false })
    }, 250)
    const ruleTimer = window.setInterval(() => room && rules.tick(now(), room, []), 1000)
    const uiTimer = window.setInterval(() => {
      const t = now()
      const recent = sampler.samples.filter((s) => s.t > t - 10)
      setReading({
        sample: sampler.samples[sampler.samples.length - 1] ?? null,
        room,
        scores: { eye: eyeScore(recent), body: bodyScore(recent), tone: toneScore(recent, [], t - 10, t) },
        breakdown: recent.some((x) => x.face) ? bodyBreakdown(recent) : null,
        events: rules.events.slice(-8).reverse(),
        level: audio.level,
      })
    }, 200)
    return () => {
      window.clearInterval(roomTimer)
      window.clearInterval(ruleTimer)
      window.clearInterval(uiTimer)
      sampler.stop()
      vision.stop()
      audio.stop()
    }
  }, [stream, engine])

  function calibrate() {
    const cal = new Calibrator()
    const started = performance.now()
    setCalibrating(CALIBRATE_SEC)
    const timer = window.setInterval(() => {
      cal.add(engine.vision.latest)
      const left = CALIBRATE_SEC - (performance.now() - started) / 1000
      setCalibrating(Math.max(0, Math.ceil(left)))
      if (left > 0) return
      window.clearInterval(timer)
      const result = cal.finish()
      engine.sampler.calibration = result
      setCalibration(result)
      setCalibrating(null)
    }, 100)
  }

  const s = reading.sample
  const r = reading.room
  // No pose landmarks: arms and slouch are defaults, not measurements.
  const body = s && s.bodyX !== null ? s : null
  const hand = s?.handSpeed ?? 0
  const handLevel = hand < T.body.handSpeedStill ? 'still' : hand > T.body.handSpeedBusy ? 'busy' : 'natural'

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="header row" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tracking debug</h1>
          <span className="faint">Face, hands and body as the evaluation sees them. Nothing is recorded or uploaded.</span>
        </div>
        <span className="spacer" />
        <button className="btn quiet" onClick={onBack}>
          Back to setup
        </button>
      </div>

      {!stream ? (
        <div className="card stack" style={{ alignItems: 'flex-start' }}>
          <p>The camera and microphone are needed for this page.</p>
          {streamError && <div className="notice">{streamError}</div>}
          <button className="btn primary" onClick={onRequestMedia}>
            Allow camera and microphone
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
          <div className="stack" style={{ gap: 12 }}>
            <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 'var(--radius)', overflow: 'hidden', background: '#000' }}>
              <video ref={video} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              <TrackingOverlay tracker={engine.vision} getSample={() => engine.sampler.samples[engine.sampler.samples.length - 1] ?? null} layers={layers} />
              {visionState !== 'ready' && (
                <div className="chip" style={{ position: 'absolute', top: 12, left: 12 }}>
                  {visionState === 'loading' ? 'Loading tracking models…' : `Tracking failed: ${engine.vision.error}`}
                </div>
              )}
              {calibrating !== null && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)', color: '#fff', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: 56, fontWeight: 600 }}>{calibrating}</div>
                    <div>Look at where the panel will be and stand naturally</div>
                  </div>
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {(['face', 'hands', 'pose'] as const).map((k) => (
                <label key={k} className="chip" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                  {k === 'pose' ? 'Body' : k[0].toUpperCase() + k.slice(1)}
                </label>
              ))}
              <span className="spacer" />
              <button className="btn" onClick={calibrate} disabled={calibrating !== null || visionState !== 'ready'}>
                {calibrating !== null ? 'Calibrating…' : `Calibrate (${CALIBRATE_SEC} s)`}
              </button>
            </div>
            <div className="faint">
              {calibration.usedDefaults
                ? 'Not calibrated: angles are relative to looking straight at the camera.'
                : `Calibrated on ${calibration.frames} frames: rest yaw ${calibration.yaw0.toFixed(1)}°, pitch ${calibration.pitch0.toFixed(1)}°${calibration.headRise0 ? ', posture baseline set' : ', no posture baseline (shoulders not visible)'}.`}{' '}
              Face outline: green on target, red looking away; the arrow shows where your eyes point (a dot means on target). Hands turn amber when touching your face. Forearms turn red when crossed; the shoulder line turns amber when slouching.
            </div>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            <Section title="Eye contact">
              <Row label="Gaze on target" value={s ? (s.gazeOnTarget ? 'yes' : 'no') : '–'} state={s ? (s.gazeOnTarget ? 'good' : 'bad') : null} />
              <Row label="Gaze (head + eyes)" value={s?.gazeYaw != null ? `${s.gazeYaw.toFixed(0)}° · ${s.gazePitch!.toFixed(0)}°` : '–'} state={s?.gazeYaw != null ? (Math.abs(s.gazeYaw) < T.gaze.maxGazeYawDeg && Math.abs(s.gazePitch!) < T.gaze.maxGazePitchDeg ? 'good' : 'bad') : null} />
              <Row label="Eyes only (iris)" value={s?.eyeYaw != null ? `${s.eyeYaw.toFixed(0)}° · ${s.eyePitch!.toFixed(0)}°` : '–'} />
              <Row label="Head only" value={s?.face ? `${s.headYaw.toFixed(0)}° · ${s.headPitch.toFixed(0)}°` : '–'} state={s?.face ? (Math.abs(s.headYaw) < T.gaze.maxHeadYawDeg ? null : 'bad') : null} />
              <Row label="Looking away for" value={r ? `${r.gazeAwaySec.toFixed(1)} s` : '–'} state={r ? (r.gazeAwaySec > T.rules.lookAwaySec ? 'bad' : r.gazeAwaySec > 1 ? 'warn' : 'good') : null} />
              <p className="faint" style={{ margin: '6px 0 0', fontSize: 12 }}>Angles are left/right · up/down from where you looked during calibration.</p>
            </Section>
            <Section title="Body language">
              <Row label="Arms" value={body ? (body.armsOpen ? 'open' : 'crossed') : 'no body detected'} state={body ? (body.armsOpen ? 'good' : 'bad') : null} />
              <Row label="Slouch" value={body ? body.slouch.toFixed(2) : '–'} state={body ? (body.slouch > T.body.slouchBad ? 'warn' : 'good') : null} />
              <Row label="Shoulder tilt" value={body?.shoulderTilt != null ? `${body.shoulderTilt.toFixed(0)}°` : '–'} state={body?.shoulderTilt != null ? (body.shoulderTilt > T.body.tiltBad ? 'warn' : 'good') : null} />
              <Row label="Facing the panel" value={body?.facing != null ? `${Math.round(body.facing * 100)}%` : 'calibrate first'} state={body?.facing != null ? (body.facing < T.body.facingMin ? 'warn' : 'good') : null} />
              <Row label="Hand speed" value={s ? `${hand.toFixed(2)} · ${handLevel}` : '–'} state={s ? (handLevel === 'natural' ? 'good' : 'warn') : null} />
              <Row label="Hands together" value={s ? (s.handsTogether ? 'yes' : 'no') : '–'} state={s?.handsTogether ? 'warn' : null} />
              <Row label="Hands hidden" value={s ? (s.handsHidden ? 'yes' : 'no') : '–'} state={s?.handsHidden ? 'warn' : null} />
              <Row label="Touching face" value={s ? (s.faceTouch ? 'yes' : 'no') : '–'} state={s ? (s.faceTouch ? 'warn' : 'good') : null} />
              <Row label="Smile · brows" value={s ? `${s.smile.toFixed(2)} · ${(s.brow ?? 0).toFixed(2)}` : '–'} />
            </Section>
            <Section title="Voice">
              <Row label="Mic hears a voice" value={s ? (s.micVoice ? 'yes' : 'no') : '–'} state={s?.micVoice ? 'warn' : null} />
              <Row label="Mouth moving" value={s?.face ? (s.mouthMoving ? 'yes' : 'no') : 'face hidden'} state={s?.mouthMoving ? 'good' : null} />
              <Row label="Jaw open (raw)" value={s?.jawOpen != null ? s.jawOpen.toFixed(3) : '–'} />
              <Row label="Speaking (you)" value={s ? (s.speaking ? 'yes' : 'no') : '–'} state={s?.speaking ? 'good' : null} />
              <div className="level" style={{ margin: '4px 0 6px' }}>
                <div style={{ width: `${Math.round(reading.level * 100)}%` }} />
              </div>
              <Row label="Pitch" value={s?.pitchHz ? `${s.pitchHz} Hz` : '–'} />
              <Row label="Silence" value={r ? `${r.silenceSec.toFixed(1)} s` : '–'} />
              <Row label="Monologue" value={r ? formatTime(r.monologueSec) : '–'} state={r ? (r.monologueSec > T.rules.monologueSec ? 'warn' : null) : null} />
              <Row label="End of thought" value={r ? r.endOfThoughtProb.toFixed(2) : '–'} />
            </Section>
            <Section title="Scores, last 10 s">
              <Row label="Eye contact" value={fmtScore(reading.scores.eye)} state={scoreState(reading.scores.eye)} />
              <Row label="Body language" value={fmtScore(reading.scores.body)} state={scoreState(reading.scores.body)} />
              {reading.breakdown &&
                (Object.entries(reading.breakdown) as [string, number | null][]).map(([k, v]) => (
                  <Row key={k} label={`  · ${k === 'selfTouch' ? 'self-touch' : k}`} value={fmtScore(v)} state={scoreState(v)} />
                ))}
              <Row label="Tone (pitch variety)" value={fmtScore(reading.scores.tone)} state={scoreState(reading.scores.tone)} />
            </Section>
            <Section title="Rule events">
              {reading.events.length ? (
                reading.events.map((e, i) => (
                  <Row key={`${e.t}-${i}`} label={`${formatTime(e.t)} · ${e.msg}`} value={e.cat} state={e.severity} />
                ))
              ) : (
                <p className="faint" style={{ margin: 0 }}>
                  None yet. Try looking away for 4 seconds or crossing your arms.
                </p>
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}
