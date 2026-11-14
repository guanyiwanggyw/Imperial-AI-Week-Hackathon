// Evaluation data contracts. The first block is copied verbatim from the build brief
// ("Shared data contracts"). When shared/types.ts exists, replace that block with a re-export.
// All times are seconds since the recording started.

// ---------- brief contracts ----------

/** Per-sample signals (5–10 Hz). */
export type Sample = {
  t: number
  gazeOnTarget: boolean
  headYaw: number
  headPitch: number
  armsOpen: boolean
  handSpeed: number
  faceTouch: boolean
  slouch: number
  smile: number
  pitchHz: number | null
  rms: number
  speaking: boolean
}

/** Transcript phrase (on each STT commit). `fillers` holds the start time of each filler word. */
export type Phrase = { t: number; end: number; text: string; fillers: number[]; wpm: number }

/** Live room state for the floor manager. */
export type RoomState = {
  t: number
  silenceSec: number
  endOfThoughtProb: number
  userSpeaking: boolean
  monologueSec: number
  invitedQuestions: boolean
  gazeAwaySec: number
  fillersLast10s: number
  ramblingScore: number
}

/** Pitch ledger: what the user has claimed and what's missing. Produced by the agents. */
export type Ledger = {
  claims: { t: number; text: string; evidence: boolean }[]
  coverage: {
    problem: boolean
    customer: boolean
    solution: boolean
    pricing: boolean
    competition: boolean
    traction: 'none' | 'weak' | 'strong'
    ask: boolean
  }
  openQuestions: { t: number; by: string; q: string; answered: boolean }[]
}

export type AgentTurn = { t: number; end: number; agent: string; text: string; interrupted: boolean }

export type FeedbackCat = 'eye' | 'body' | 'tone' | 'coherency' | 'timing' | 'panel'
export type Severity = 'good' | 'warn' | 'bad'

export type FeedbackEvent = {
  t: number
  end?: number
  cat: FeedbackCat
  severity: Severity
  msg: string
  source: 'rule' | 'claude'
}

// ---------- evaluation-only types ----------

export type ScoreCat = 'eye' | 'body' | 'tone' | 'coherency'
export const SCORE_CATS: ScoreCat[] = ['eye', 'body', 'tone', 'coherency']

/**
 * A Sample plus fields the evaluation needs internally. It is still assignable to Sample,
 * so consumers that only know the brief contract can use it unchanged.
 */
export type SampleX = Sample & {
  /** A face was detected in this frame. Without it gaze and head angles are meaningless. */
  face: boolean
  /** Number of hands the hand model found (0–2). */
  handsVisible: number
  /** Horizontal body centre (shoulder midpoint, normalised 0–1), for sway. Null without pose. */
  bodyX: number | null
  /** The speaker's mouth is moving (jawOpen varies). `speaking` requires it whenever a face is visible. */
  mouthMoving: boolean
  /** Raw microphone voice activity, before the mouth gate (any voice in the room, including the panel). */
  micVoice: boolean
  /** Raw jawOpen blendshape (0–1), kept for tuning the mouth gate. Null without a face. */
  jawOpen?: number | null
  /** Combined gaze (head + eyes) relative to calibration, degrees. + = towards image right / down. */
  gazeYaw?: number | null
  gazePitch?: number | null
  /** Eye-in-head angle from the irises, degrees (before adding head pose). */
  eyeYaw?: number | null
  eyePitch?: number | null
  /** Horizontal shoulder width (normalised image x), to express sway in shoulder widths. */
  shoulderW?: number | null
  /** Shoulder line angle from horizontal, degrees (absolute). */
  shoulderTilt?: number | null
  /** Torso facing the camera relative to baseline (1 = square on, lower = turned away). */
  facing?: number | null
  /** Distance between the wrists, in shoulder widths. Null unless both wrists are visible. */
  armSpan?: number | null
  /** Wrists close together (clasping, wringing). */
  handsTogether?: boolean
  /** Waist is in frame but neither hand can be seen (pockets, behind the back). */
  handsHidden?: boolean
  /** Eyebrow raise (browInnerUp/OuterUp average), 0–1, for facial expressiveness. */
  brow?: number | null
  /** Hand shape in this frame: thumbs_up, thumbs_down, point, open_palm, fist (see gestures.ts). */
  gesture?: string | null
}

/** Body language broken into the parts of the Tübingen presentation rubric and coaches' criteria. Each 0–100 or null. */
export interface BodyBreakdown {
  posture: number | null
  openness: number | null
  gestures: number | null
  selfTouch: number | null
  movement: number | null
  expression: number | null
}

/** Baseline captured during the pre-pitch countdown. Angles in degrees. */
export interface Calibration {
  yaw0: number
  pitch0: number
  /** Resting value of each eyeLook* blendshape while looking at the target. */
  eyeLook0: Record<string, number>
  /** (shoulder midpoint y − nose y) / shoulder width while standing naturally. */
  headRise0: number | null
  shoulderWidth0: number | null
  /** Combined gaze (head + eyes) while looking at the target, degrees. */
  gazeYaw0?: number
  gazePitch0?: number
  /** Shoulder width / eye span while standing square on. */
  facing0?: number | null
  frames: number
  /** True when too few frames were seen and defaults were used. */
  usedDefaults: boolean
}

export interface AnswerTiming {
  agent: string
  question: string
  /** When the agent finished asking. */
  askedAt: number
  /** Seconds from the agent finishing to the user's first word. Null if no answer. */
  latencySec: number | null
  answerSec: number | null
  /** Seconds from answer start until the user referred back to the pitch. Null if never. */
  bridgeBackSec: number | null
  /** Seconds the user kept talking after the agent started (talking over). */
  overlapSec: number
}

export interface TimingStats {
  longestMonologueSec: number
  /** User talk time divided by user + agent talk time, 0–1. */
  talkRatio: number | null
  answers: AnswerTiming[]
  medianLatencySec: number | null
  medianAnswerSec: number | null
}

/** Notes Claude returns for one chunk of the session. */
export interface SegmentNote {
  from: number
  to: number
  /** 0–100 coherency for this chunk, or null if there was too little speech. */
  coherency: number | null
  notes: Omit<FeedbackEvent, 'source'>[]
  summary: string
}

export interface DimensionScore {
  /** 0–100 */
  score: number
  justification: string
  evidence_time_sec: number | null
}

/** Claude's final judgement. Scores are 0–100. */
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
  key_moments: Omit<FeedbackEvent, 'source'>[]
  best_moment_note: string
  coherency_score: number
}

/** One recorded camera frame. Coordinates are integers 0–999, x and y interleaved; -1 = not visible. */
export interface LandmarkTrackFrame {
  t: number
  /** Face points, in the order of LandmarkTrack.faceIdx. */
  f: number[] | null
  /** Hands, 21 points each. */
  h: number[][]
  /** Upper-body pose points, in the order of LandmarkTrack.poseIdx. */
  p: number[] | null
}

/** Face, hand and pose landmarks over time (~7 Hz), for drawing the tracking over the recording. */
export interface LandmarkTrack {
  version: 1
  /** Which of the 478 face-mesh points are stored (outline, eyes, brows, lips, irises). */
  faceIdx: number[]
  /** Which of the 33 pose points are stored (upper body). */
  poseIdx: number[]
  frames: LandmarkTrackFrame[]
}

/** Everything the evaluation produces for one session. Stored on SessionData.evaluation. */
export interface EvaluationResult {
  version: 1
  samples: SampleX[]
  transcript: Phrase[]
  agentTurns: AgentTurn[]
  /** Rule events (live) plus Claude key moments (end of session), sorted by t. */
  events: FeedbackEvent[]
  /** Rolling 10 s score per second, 0–100. Index = whole seconds since the recording started. */
  scoreSeries: Record<ScoreCat, number[]>
  finalScores: Record<ScoreCat | 'overall', number>
  /** Categories that could not be measured (their finalScores value is 0 and they are left out of overall). */
  unmeasured: ScoreCat[]
  /** The parts of the body-language score. */
  bodyBreakdown?: BodyBreakdown
  /** The speaker said too little for any score to mean anything. All categories are then unmeasured. */
  insufficientSpeech: boolean
  /** Seconds of the speaker's own speech (transcript if available, else mouth-gated voice activity). */
  userSpeechSec: number
  timing: TimingStats
  /** Null when it could not be measured (no transcript, or too little speech). */
  timingScore: number | null
  coaching: { top3: string[]; summary: string }
  segments: SegmentNote[]
  calibration: Calibration | null
  /** Landmarks for the playback overlay. Absent on older sessions. */
  landmarks?: LandmarkTrack
}
