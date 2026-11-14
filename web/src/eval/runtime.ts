// EvalSession: the one object the live session screen talks to. It owns the camera and mic analysis,
// the live transcript, RoomState (for the agents' floor manager), live rule events and the background
// Claude segments. Nothing here renders anything; feedback is only shown in playback.
//
// Lifecycle: new EvalSession(...) -> startCalibration(video) during the countdown -> start(now) when the
// recording starts -> agent hooks during Q&A -> stop() -> capture() / flushJudge() -> buildReport().
import { errorText } from '../api'
import type { AgentTurn, Calibration, FeedbackEvent, Phrase, RoomState, SampleX } from './contracts'
import { Calibrator } from './calibration'
import type { EvalCapture } from './evaluate'
import { JudgeScheduler } from './judge'
import { computeRoomState } from './roomState'
import { RuleEngine } from './rules'
import { AudioMeter } from './signals/audio'
import { SignalSampler } from './signals/sampler'
import { VisionTracker } from './signals/vision'
import { LiveTranscript } from './transcript/liveTranscript'

export interface EvalSessionOptions {
  stream: MediaStream
  /** Called when the transcript changes (for live captions). */
  onUpdate?: () => void
  /** Every ~250 ms while recording. The agents' floor manager subscribes here. */
  onRoomState?: (r: RoomState) => void
  onPhrase?: (p: Phrase) => void
  onFeedback?: (e: FeedbackEvent) => void
  /** Text Claude gets as context for the background segments (mission statement, audience, judging criteria). */
  context?: () => string
  /** Set false when Anthropic is not configured, to skip the background segment calls. */
  judge?: boolean
  /** Optional end-of-turn probability (LiveKit turn detector or an LLM), read on every RoomState tick. */
  turnDetector?: () => number | null
}

export class EvalSession {
  readonly vision = new VisionTracker()
  readonly audio = new AudioMeter()
  readonly sampler: SignalSampler
  readonly transcript: LiveTranscript
  readonly rules: RuleEngine
  readonly judge: JudgeScheduler
  agentTurns: AgentTurn[] = []
  roomState: RoomState | null = null
  calibration: Calibration | null = null
  pitchEnd: number | null = null
  private calibrator = new Calibrator()
  private opts: EvalSessionOptions
  private timers: number[] = []
  private now: () => number = () => 0
  private openTurn: { t: number; agent: string; text: string } | null = null
  private started = false

  constructor(opts: EvalSessionOptions) {
    this.opts = opts
    this.sampler = new SignalSampler(this.vision, this.audio, () => this.openTurn !== null)
    this.transcript = new LiveTranscript(
      () => opts.onUpdate?.(),
      (p) => opts.onPhrase?.(p),
    )
    this.rules = new RuleEngine((e) => opts.onFeedback?.(e))
    this.judge = new JudgeScheduler(
      () => ({
        samples: this.sampler.samples,
        phrases: this.transcript.phrases,
        agentTurns: this.agentTurns,
        events: this.rules.events,
        context: opts.context?.() ?? '',
        pitchEnd: this.pitchEnd,
      }),
      opts.judge ?? true,
    )
  }

  /** Start the camera and mic analysis during the countdown and record the calibration baseline. */
  startCalibration(video: HTMLVideoElement) {
    this.audio.start(this.opts.stream)
    void this.vision.start(video)
    this.timers.push(window.setInterval(() => this.calibrator.add(this.vision.latest), 100))
  }

  /** Call in the same tick the recording starts. `now` is the shared clock (seconds since recording start). */
  start(now: () => number, active: () => boolean = () => true) {
    if (this.started) return
    this.started = true
    this.now = now
    this.clearTimers()
    this.calibration = this.calibrator.finish()
    this.sampler.calibration = this.calibration
    this.sampler.start(now, active, (s) => this.rules.onSample(s))
    this.transcript.start(now).catch((err) => {
      this.transcript.error = errorText(err)
      this.opts.onUpdate?.()
    })
    this.timers.push(
      window.setInterval(() => {
        if (!active()) return
        this.roomState = computeRoomState({
          now: now(),
          samples: this.sampler.samples,
          phrases: this.transcript.phrases,
          partial: this.transcript.partial,
          agentTurns: this.agentTurns,
          agentSpeaking: this.openTurn !== null,
          pitchEnded: this.pitchEnd !== null,
          turnDetectorProb: this.opts.turnDetector?.() ?? null,
        })
        this.opts.onRoomState?.(this.roomState)
      }, 250),
      window.setInterval(() => {
        if (!active() || !this.roomState) return
        const t = now()
        this.rules.tick(t, this.roomState, this.transcript.phrases)
        this.judge.maybeCut(t)
      }, 1000),
    )
  }

  /** Last time (session seconds) the mic heard the speaker. */
  lastVoiceT(): number {
    const s = this.sampler.samples
    for (let i = s.length - 1; i >= 0; i--) if (s[i].speaking) return s[i].t
    return 0
  }

  // ---------- agent hooks (Q&A) ----------

  /**
   * Wire to the agent's speaking state. Opens an AgentTurn when speech starts and closes it when it stops.
   * When closing, `startAt` (session seconds of the first audio) and `interrupted` refine the turn.
   */
  agentSpeaking(speaking: boolean, agent: string, close: { startAt?: number; interrupted?: boolean } = {}) {
    const t = this.now()
    if (speaking && !this.openTurn) this.openTurn = { t, agent, text: '' }
    else if (!speaking && this.openTurn) {
      const start = close.startAt !== undefined ? Math.min(Math.max(close.startAt, this.openTurn.t), t) : this.openTurn.t
      this.addAgentTurn({ ...this.openTurn, t: start, end: t, interrupted: close.interrupted ?? false })
      this.openTurn = null
    }
  }

  /** Latest caption of the speaking agent. */
  agentCaption(text: string) {
    if (this.openTurn && text) this.openTurn.text = text
  }

  /** For orchestrators that already produce AgentTurns (build brief contract). */
  addAgentTurn(turn: AgentTurn) {
    this.agentTurns.push(turn)
  }

  /** The user handed over (end of pitch). Counts as inviting questions and closes a judge segment. */
  markPitchEnded(t = this.now()) {
    this.pitchEnd = t
    this.judge.maybeCut(t, true)
  }

  /** After each question-and-answer exchange: sends that chunk to the judge in the background. */
  exchangeEnded(t = this.now()) {
    this.judge.maybeCut(t, true)
  }

  // ---------- end ----------

  stop() {
    this.agentSpeaking(false, '')
    this.clearTimers()
    this.sampler.stop()
    this.vision.stop()
    this.audio.stop()
    this.transcript.stop()
    this.rules.finish()
  }

  /** Waits (bounded) for background judge segments, after sending the final chunk. */
  flushJudge(timeoutMs?: number) {
    return this.judge.flush(this.now(), timeoutMs)
  }

  capture(): EvalCapture {
    return {
      samples: this.sampler.samples as SampleX[],
      phrases: this.transcript.phrases,
      agentTurns: this.agentTurns,
      ruleEvents: this.rules.events,
      segments: this.judge.segments,
      calibration: this.calibration,
    }
  }

  private clearTimers() {
    this.timers.forEach((t) => window.clearInterval(t))
    this.timers = []
  }
}
