// Shared data shapes. All times are seconds since the session recording started.

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
}

export interface Panel {
  id: string
  name: string
  description: string
  setting: string
  backdropPrompt: string
  personas: Persona[]
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
}

export interface Word {
  text: string
  start: number
  end: number
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
}

export interface DimensionScore {
  score: number
  justification: string
  evidence_time_sec: number | null
}

export interface ContentEvaluation {
  summary: string
  dimensions: {
    overall_pitch: DimensionScore
    clarity: DimensionScore
    depth: DimensionScore
    qna: DimensionScore
    composure: DimensionScore
  }
  qna_feedback: { question_index: number; score: number; feedback: string }[]
  priorities: { title: string; detail: string; evidence_time_sec: number | null }[]
  best_moment_note: string
}

export interface DeliveryScore {
  key: 'pace' | 'fillers' | 'pauses' | 'eye_contact' | 'gestures' | 'tonality'
  label: string
  score: number | null // 0 to 10, null when the signal was unreliable
  value: string
  note: string
}

export interface Report {
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
