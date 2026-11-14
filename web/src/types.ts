// Shared data shapes. All times are seconds since the session recording started.
import type { ContentEvaluation, EvaluationResult } from './eval/contracts'

// Evaluation types live in eval/contracts.ts (owned by the evaluation workstream).
export type { ContentEvaluation, DimensionScore, EvaluationResult } from './eval/contracts'

export type Reaction = 'nod' | 'smile' | 'frown' | 'glance' | 'sceptical'

export interface Persona {
  id: string
  name: string
  role: string
  personality: string
  focus: string[]
  /** 1 (easy to impress) to 5 (very hard to impress) */
  strictness: number
  /** How likely each reaction is when its trigger fires, 0 to 1. Different personas react differently to the same event. */
  expression: Record<Reaction, number>
  /** ElevenLabs voice id */
  voiceId: string
  /** Prompt for the fal portrait */
  look: string
  /** Idle behaviour for the Anam avatar while listening */
  idleStyle: string
  /** Speaks through the live main avatar. Defaults to the first persona on the panel. */
  decisionMaker?: boolean
  /** Anam avatar and voice for this agent. Without them the server matches one by gender and look. */
  anamAvatarId?: string
  anamVoiceId?: string
  /** Interactive mode (web/src/agents): may cut in while the speaker talks. Default: strictness >= 4. */
  canInterrupt?: boolean
  /** Seconds of uninterrupted monologue this agent tolerates before cutting in. Default by strictness. */
  patienceSec?: number
  /** Follow-ups this agent asks on its own question before letting go. Default by strictness. */
  followUps?: number
}

export interface Panel {
  id: string
  name: string
  description: string
  setting: string
  backdropPrompt: string
  /** The lineup for this session (drawn from `pool` when there is one). */
  personas: Persona[]
  /** Everyone who can sit on this kind of panel. A lineup of `size` is drawn from it for each session. */
  pool?: Persona[]
  size?: number
}

export interface Slide {
  index: number
  image: string // data URL
  text: string
}

export interface SessionConfig {
  panel: Panel
  slides: Slide[]
  deckName: string | null
  pitchSeconds: number
  /** 0 means Q&A is off */
  questionCount: number
  context: string
  /**
   * timed: solo pitch for pitchSeconds, then questionCount questions.
   * interactive: no time limits; the agents listen, interrupt, follow up and comment (web/src/agents).
   */
  format?: 'timed' | 'interactive'
}

export interface Word {
  text: string
  start: number
  end: number
  /** Speaker id from diarization (accurate transcript only). */
  speaker?: string
}

export type EventType =
  | 'slide_changed'
  | 'filler_burst'
  | 'long_pause'
  | 'fast_pace'
  | 'slow_pace'
  | 'monotone_stretch'
  | 'eye_contact_lost'
  | 'eye_contact_regained'
  | 'strong_moment'
  | 'claim_without_evidence'
  | 'evidence_given'
  | 'question_asked'
  | 'answer_given'
  | 'tool_called'
  | 'pitch_ended'

export interface SessionEvent {
  t: number
  type: EventType
  detail?: string
}

export interface VisionSample {
  t: number
  face: boolean
  eyeContact: boolean
  handsVisible: number // 0, 1 or 2
  movement: number // normalised hand movement per second
}

export interface AudioSample {
  t: number
  rms: number
  pitchHz: number | null
}

export interface QnaTurn {
  personaId: string
  personaName: string
  question: string
  answer: string
  followUps: string[]
  start: number
  end: number
  agentScore: number | null
  agentNote: string | null
  toolCalls: string[]
  /** Spoken turns: who voiced the question and floorOpen → first audio in ms */
  provider?: 'anam' | 'browser' | 'elevenlabs'
  latencyMs?: number | null
}

export interface SessionData {
  id: string
  title: string
  startedAt: string
  config: SessionConfig
  pitchEnd: number
  duration: number
  slideChanges: { t: number; slide: number }[]
  events: SessionEvent[]
  liveWords: Word[]
  words: Word[] // accurate transcript after the session (falls back to live words)
  vision: VisionSample[]
  audio: AudioSample[]
  qna: QnaTurn[]
  recordingUrl: string | null
  report: Report | null
  /** Full evaluation (samples, phrases, feedback events, score series, final scores). Absent on older sessions. */
  evaluation?: EvaluationResult | null
}

export interface DeliveryScore {
  key: 'pace' | 'fillers' | 'pauses' | 'eye_contact' | 'gestures' | 'tonality'
  label: string
  score: number | null // 0 to 100, null when the signal was unreliable
  value: string
  note: string
}

export interface Report {
  /** 100 for reports scored 0–100. Older saved reports are 0–10 and have no scale. */
  scale?: 100
  overall: number
  /** True when too little speech was captured for the scores to mean anything */
  insufficientSpeech: boolean
  contentScore: number | null
  deliveryScore: number | null
  contentWeight: number
  delivery: DeliveryScore[]
  content: ContentEvaluation | null
  contentError: string | null
  bestMoment: { start: number; end: number; text: string; note: string } | null
  priorities: { title: string; detail: string; t: number | null }[]
}
