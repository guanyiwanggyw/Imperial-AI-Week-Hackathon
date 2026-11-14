// Pure assembly of an EvaluationResult from collected data. No network, no DOM: usable in the browser,
// in the fake-data generator and in the calibration CLI.
import type { AgentTurn, Calibration, ContentEvaluation, EvaluationResult, FeedbackEvent, Phrase, SampleX, ScoreCat, SegmentNote } from './contracts'
import { mergeInto } from './rules'
import { buildScoreSeries, computeFinalScores } from './scores'
import { T } from './thresholds'
import { computeTiming, pitchKeywords } from './timing'

/**
 * Transcript lines heard while a panel voice was playing are likely the panel leaking into the mic.
 * Keep them only if the speaker's mouth was moving during the line (talking over the panel is real).
 */
export function dropPanelLeakage(phrases: Phrase[], agentTurns: AgentTurn[], samples: SampleX[]): Phrase[] {
  if (!agentTurns.length) return phrases
  const haveMouth = samples.some((s) => s.face)
  return phrases.filter((p) => {
    const mid = (p.t + p.end) / 2
    if (!agentTurns.some((a) => mid >= a.t && mid <= a.end + 0.5)) return true
    if (!haveMouth) return false
    return samples.some((s) => s.t >= p.t && s.t <= p.end && s.mouthMoving)
  })
}

/**
 * Seconds of the speaker's own speech: the transcript when there is one, else mouth-gated voice activity.
 * Samples saved before the mouth gate existed (no `mouthMoving` field) are mic-only, so they don't count as evidence.
 */
export function userSpeechSeconds(phrases: Phrase[], samples: SampleX[]): number {
  if (phrases.length) return phrases.reduce((s, p) => s + Math.max(0, p.end - p.t), 0)
  return samples.filter((s) => s.speaking && (s as Partial<SampleX>).mouthMoving !== undefined).length / T.sampleHz
}

export interface AssembleInput {
  samples: SampleX[]
  phrases: Phrase[]
  agentTurns: AgentTurn[]
  ruleEvents: FeedbackEvent[]
  segments: SegmentNote[]
  calibration: Calibration | null
  duration: number
  pitchEnd: number
  slideTexts: string[]
  content: ContentEvaluation | null
}

export const TIPS: Record<ScoreCat | 'timing', string> = {
  eye: 'Eye contact: look at the panel, not the slides, especially while answering.',
  body: 'Body language: keep your arms open and your hands away from your face.',
  tone: 'Tone: vary your pitch and slow down on the key numbers.',
  coherency: 'Clarity: replace filler words with a short pause, and finish each sentence.',
  timing: 'Timing: keep answers to 15–45 seconds and check in with the panel every minute or so.',
}

export function assembleEvaluation(input: AssembleInput): EvaluationResult {
  const i = { ...input, phrases: dropPanelLeakage(input.phrases, input.agentTurns, input.samples) }
  const userSpeechSec = Math.round(userSpeechSeconds(i.phrases, i.samples) * 10) / 10
  const insufficientSpeech = userSpeechSec < T.minSpeechSec
  const keywords = pitchKeywords(i.phrases.filter((p) => p.t < i.pitchEnd), i.slideTexts)
  const timing = computeTiming({ phrases: i.phrases, agentTurns: i.agentTurns, duration: i.duration, keywords })
  // Timing needs a transcript (who spoke when). Without one, "no answer" would be a guess.
  const timingMeasured = i.phrases.length > 0 && !insufficientSpeech
  const timingScore = timingMeasured ? timing.score : null

  const events: FeedbackEvent[] = i.ruleEvents.map((e) => ({ ...e }))
  if (timingMeasured) for (const d of timing.events) mergeInto(events, { ...d, source: 'rule' })
  const claudeNotes = i.content ? i.content.key_moments : i.segments.flatMap((s) => s.notes)
  for (const d of claudeNotes) events.push({ ...d, source: 'claude' })
  events.sort((a, b) => a.t - b.t)

  const ruleNonGood = (cat: string, prefix: string) => i.ruleEvents.filter((e) => e.cat === cat && e.severity !== 'good' && e.msg.startsWith(prefix)).length
  const { scores, unmeasured } = computeFinalScores({
    samples: i.samples,
    phrases: i.phrases,
    duration: i.duration,
    segments: i.segments,
    claudeCoherency: i.content?.coherency_score ?? null,
    timingScore,
    agentTurns: i.agentTurns,
    insufficientSpeech,
    lookAwayEvents: ruleNonGood('eye', 'You looked away'),
    monotoneEvents: ruleNonGood('tone', 'Flat pitch'),
  })

  let coaching: EvaluationResult['coaching']
  if (insufficientSpeech) {
    coaching = {
      top3: [],
      summary: `Not scored: we heard ${userSpeechSec}s of you speaking, and at least ${T.minSpeechSec}s is needed. Background voices are ignored unless your mouth is moving.`,
    }
  } else if (i.content) {
    coaching = { top3: i.content.priorities.slice(0, 3).map((p) => `${p.title}: ${p.detail}`), summary: i.content.summary }
  } else {
    const measured: (readonly [ScoreCat | 'timing', number])[] = (['eye', 'body', 'tone', 'coherency'] as ScoreCat[]).filter((c) => !unmeasured.includes(c)).map((c) => [c, scores[c]] as const)
    if (timingScore !== null) measured.push(['timing', timingScore] as const)
    const ranked = measured
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
    coaching = { top3: ranked.map(([c]) => TIPS[c]), summary: 'Measured delivery only: the content judge was unavailable for this session.' }
  }

  return {
    version: 1,
    samples: i.samples,
    transcript: i.phrases,
    agentTurns: i.agentTurns,
    events,
    // No series when nothing was measurable: a silent session should not show moving score bars.
    scoreSeries: insufficientSpeech ? { eye: [], body: [], tone: [], coherency: [] } : buildScoreSeries(i.samples, i.phrases, i.duration, i.segments),
    finalScores: scores,
    unmeasured,
    insufficientSpeech,
    userSpeechSec,
    timing: timing.stats,
    timingScore,
    coaching,
    segments: i.segments,
    calibration: i.calibration,
  }
}
