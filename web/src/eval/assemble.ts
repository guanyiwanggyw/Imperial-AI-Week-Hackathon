// Pure assembly of an EvaluationResult from collected data. No network, no DOM: usable in the browser,
// in the fake-data generator and in the calibration CLI.
import type { AgentTurn, Calibration, ContentEvaluation, EvaluationResult, FeedbackEvent, Phrase, SampleX, ScoreCat, SegmentNote } from './contracts'
import { mergeInto } from './rules'
import { buildScoreSeries, computeFinalScores } from './scores'
import { computeTiming, pitchKeywords } from './timing'

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

const TIPS: Record<ScoreCat | 'timing', string> = {
  eye: 'Eye contact: look at the panel, not the slides, especially while answering.',
  body: 'Body language: keep your arms open and your hands away from your face.',
  tone: 'Tone: vary your pitch and slow down on the key numbers.',
  coherency: 'Clarity: replace filler words with a short pause, and finish each sentence.',
  timing: 'Timing: keep answers to 15–45 seconds and check in with the panel every minute or so.',
}

export function assembleEvaluation(i: AssembleInput): EvaluationResult {
  const keywords = pitchKeywords(i.phrases.filter((p) => p.t < i.pitchEnd), i.slideTexts)
  const timing = computeTiming({ phrases: i.phrases, agentTurns: i.agentTurns, duration: i.duration, keywords })

  const events: FeedbackEvent[] = i.ruleEvents.map((e) => ({ ...e }))
  for (const d of timing.events) mergeInto(events, { ...d, source: 'rule' })
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
    timingScore: timing.score,
    lookAwayEvents: ruleNonGood('eye', 'You looked away'),
    monotoneEvents: ruleNonGood('tone', 'Flat pitch'),
  })

  let coaching: EvaluationResult['coaching']
  if (i.content) {
    coaching = { top3: i.content.priorities.slice(0, 3).map((p) => `${p.title}: ${p.detail}`), summary: i.content.summary }
  } else {
    const ranked = ([...(['eye', 'body', 'tone', 'coherency'] as ScoreCat[]).filter((c) => !unmeasured.includes(c)).map((c) => [c, scores[c]] as const), ['timing', timing.score] as const])
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
    scoreSeries: buildScoreSeries(i.samples, i.phrases, i.duration, i.segments),
    finalScores: scores,
    unmeasured,
    timing: timing.stats,
    timingScore: timing.score,
    coaching,
    segments: i.segments,
    calibration: i.calibration,
  }
}
