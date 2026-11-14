// Builds the end-of-session evaluation and the report shown on the report screen.
// Measured layer (signals, rules, timing, scores) + Claude judge (segments during the session, streamed merge at the end).
// All scores are 0–100.
import { errorText } from '../api'
import type { DeliveryScore, Report, SessionData, Word } from '../types'
import { assembleEvaluation, TIPS } from './assemble'
import type { AgentTurn, Calibration, ContentEvaluation, EvaluationResult, FeedbackEvent, LandmarkTrack, Phrase, SampleX, SegmentNote } from './contracts'
import { gestureEpisodes, GESTURE_LABEL } from './gestures'
import { finalJudge, transcriptLines } from './judge'
import { averageScore, bestMoment, deliveryScores, deliveryStats, findPauses, paceScore, pitchSpread, type DeliveryStats } from './metrics'
import { sustainedWpm } from './rules'
import { T } from './thresholds'
import { phrasesFromWords } from './transcript/phrases'

/** What the live session collected (EvalSession.capture()). Null when re-scoring an old session. */
export interface EvalCapture {
  samples: SampleX[]
  phrases: Phrase[]
  agentTurns: AgentTurn[]
  ruleEvents: FeedbackEvent[]
  segments: SegmentNote[]
  calibration: Calibration | null
  landmarks?: LandmarkTrack
}

/** Content dimension weights within the content score. */
const DIMENSION_WEIGHTS = { overall_pitch: 0.3, clarity: 0.2, depth: 0.25, qna: 0.15, composure: 0.1 }

export function contentScore(c: ContentEvaluation, hadQna: boolean): number {
  let total = 0
  let weight = 0
  for (const [key, w] of Object.entries(DIMENSION_WEIGHTS) as [keyof typeof DIMENSION_WEIGHTS, number][]) {
    if (!hadQna && (key === 'qna' || key === 'composure')) continue
    total += c.dimensions[key].score * w
    weight += w
  }
  return total / weight
}

/** Agent turns from Q&A records when the live session did not log them (older sessions). */
function turnsFromQna(session: SessionData): AgentTurn[] {
  return session.qna.map((q) => ({
    t: q.start,
    end: q.start + Math.max(2, q.question.split(/\s+/).length / 2.6),
    agent: q.personaName,
    text: q.question,
    interrupted: false,
  }))
}

const LABEL = { eye: 'Eye contact', body: 'Body language', tone: 'Tone of voice', coherency: 'Clarity', timing: 'Timing' } as const

/** Measured categories under 70, weakest first, each with a tip and the moment of its worst event. */
function weakest(ev: EvaluationResult): Report['priorities'] {
  const cats: [keyof typeof LABEL, number][] = (['eye', 'body', 'tone', 'coherency'] as const).filter((c) => !ev.unmeasured.includes(c)).map((c) => [c, ev.finalScores[c]])
  if (ev.timingScore !== null) cats.push(['timing', ev.timingScore])
  const rank = { bad: 2, warn: 1, good: 0 }
  return cats
    .filter(([, score]) => score < 70)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([c]) => {
      const worst = ev.events.filter((e) => e.cat === c && e.severity !== 'good').sort((a, b) => rank[b.severity] - rank[a.severity] || a.t - b.t)[0]
      return { title: LABEL[c], detail: TIPS[c].replace(/^[^:]+: /, ''), t: worst?.t ?? null }
    })
}

export interface BuildOptions {
  /** Raw JSON text from the streamed final judge, as it arrives. */
  onDelta?: (text: string) => void
  /** Skip the Claude call because no key is configured. */
  skipJudge?: boolean
}

/**
 * With speaker labels (diarized accurate transcript): keep the speaker whose words line up with the user's mouth
 * movement. The panel's voices and other people in the room get other speaker ids. Without labels, all words pass.
 */
export function ownSpeakerWords(words: Word[], samples: SampleX[]): Word[] {
  const speakers = [...new Set(words.map((w) => w.speaker).filter((s): s is string => Boolean(s)))]
  if (speakers.length < 2 || !samples.some((s) => s.jawOpen != null)) return words
  const score = (sp: string) => {
    const ws = words.filter((w) => w.speaker === sp)
    let moving = 0
    let seen = 0
    for (const w of ws) {
      const near = samples.filter((s) => s.face && s.t >= w.start - 0.2 && s.t <= w.end + 0.2)
      if (!near.length) continue
      seen++
      if (near.some((s) => s.mouthMoving)) moving++
    }
    return { sp, n: ws.length, share: seen ? moving / seen : 0 }
  }
  const ranked = speakers.map(score).filter((x) => x.n >= 3).sort((a, b) => b.share - a.share || b.n - a.n)
  if (!ranked.length) return words
  const own = ranked[0].sp
  return words.filter((w) => !w.speaker || w.speaker === own)
}

/** Transcript words inside the phrases attributed to the speaker (drops the panel's lines and other voices). */
function speakerWords(words: Word[], phrases: Phrase[]): Word[] {
  return words.filter((w) => phrases.some((p) => w.start >= p.t - 0.15 && w.end <= p.end + 0.15))
}

/**
 * The per-signal delivery bars, computed only from the speaker's own speech. Eye contact and gestures come straight
 * from the evaluation so the bars cannot contradict the category scores; tonality needs ~6 s of voiced speech.
 */
function deliveryBars(stats: DeliveryStats, ev: EvaluationResult, own: Word[], session: SessionData): DeliveryScore[] {
  const inPitch = own.filter((w) => w.start < session.pitchEnd)
  const wordCount = inPitch.length
  if (ev.insufficientSpeech) {
    return deliveryScores(stats).map((d) => ({ ...d, score: null, value: 'Not scored', note: 'You did not speak enough for this to be scored.' }))
  }
  const few = wordCount < T.minWords
  const spread = pitchSpread(ev.samples, 0, ev.samples[ev.samples.length - 1]?.t ?? 0)
  const gestures = ev.bodyBreakdown?.gestures ?? null
  return deliveryScores(stats).map((d) => {
    if (few && (d.key === 'pace' || d.key === 'fillers' || d.key === 'pauses')) {
      return { ...d, score: null, value: 'Not enough speech', note: `Needs at least ${T.minWords} of your own words; we heard ${wordCount}.` }
    }
    if (d.key === 'pace') {
      const wpm = sustainedWpm(ev.transcript.filter((p) => p.t < session.pitchEnd), 0, session.pitchEnd)
      if (wpm === null) return { ...d, score: null, value: 'Not enough sustained speech', note: 'Pace needs stretches of at least 8 seconds of continuous talking.' }
      const [lo, hi] = T.voice.paceGood
      return {
        ...d,
        score: Math.round(paceScore(wpm)),
        value: `${Math.round(wpm)} wpm`,
        note: wpm > hi ? 'Faster than most audiences can follow. Slow down on key points.' : wpm < lo ? 'On the slow side. Tighten sentences to keep energy up.' : 'A comfortable pace.',
      }
    }
    if (d.key === 'pauses') {
      // Gaps while the panel talks, or long turn-taking gaps, are not your pauses.
      const pauses = findPauses(inPitch, session.slideChanges.map((s) => s.t)).filter(
        (p) => p.end - p.start <= 6 && !ev.agentTurns.some((a) => p.start < a.end + 0.5 && p.end > a.t - 0.5),
      )
      const silentHes = pauses.filter((p) => p.kind === 'hesitation').length
      // Filled pauses ("um", "uh") are hesitations too, just voiced.
      const filled = inPitch.filter((w) => ['um', 'uh', 'er', 'erm', 'uhm', 'umm', 'uhh', 'ah'].includes(w.text.toLowerCase().replace(/[^a-z]/g, ''))).length
      const hes = silentHes + filled
      const del = pauses.length - silentHes
      const longStalls = pauses.filter((p) => p.kind === 'hesitation' && p.end - p.start > 3).length
      const minutes = Math.max(inPitch.length / Math.max(stats.wpm ?? 140, 60), 0.25)
      const hesPerMin = hes / minutes
      const delPerMin = del / minutes
      // Strict: full marks need deliberate pauses that let points land (2–8 a minute) and no mid-sentence hesitation.
      let score = 100 - Math.min(70, hesPerMin * 10) - longStalls * 8
      if (delPerMin < 1) score -= 30
      else if (delPerMin < 2) score -= 12
      else if (delPerMin > 10) score -= 15
      if (hes > 0 || delPerMin < 2 || delPerMin > 8) score = Math.min(score, 90)
      return {
        ...d,
        score: Math.round(Math.min(100, Math.max(0, score))),
        value: `${del} deliberate, ${hes} hesitant${filled ? ` (${filled} um/uh)` : ''}`,
        note:
          delPerMin < 1
            ? 'You barely paused. Stop for a beat after each key point so it lands.'
            : hes > del
              ? 'Most pauses happen mid-sentence. Pause after a point, not inside it.'
              : delPerMin > 10
                ? 'Very frequent pauses make the delivery choppy. Group your ideas into fuller sentences.'
                : 'Pauses mostly land at the end of points, which reads as confident.',
      }
    }
    if (d.key === 'eye_contact') return { ...d, score: ev.unmeasured.includes('eye') ? null : ev.finalScores.eye }
    if (d.key === 'gestures') {
      return gestures === null
        ? { ...d, score: null, value: 'Not measured', note: 'Gestures need your hands in view while you speak.' }
        : { ...d, score: gestures, value: gestures >= 80 ? 'Natural' : gestures >= 55 ? 'Some' : 'Few or frantic' }
    }
    if (d.key === 'tonality') {
      if (spread === null) return { ...d, score: null, value: 'Not enough voice', note: 'Needs about 6 seconds of your voiced speech to judge pitch variety.' }
      const score = Math.round(Math.min(100, Math.max(0, ((spread - 1) / (T.voice.expressiveSemitones - 1)) * 100)))
      return {
        ...d,
        score,
        value: `${spread.toFixed(1)} semitones · ${score < 35 ? 'monotone' : score < 70 ? 'varied' : 'expressive'}`,
        note: score < 35 ? 'Your voice stayed flat. Lift your pitch on the problem and the ask.' : 'Your voice carried variation and energy.',
      }
    }
    return d
  })
}

export async function buildReport(session: SessionData, capture: EvalCapture | null, opts: BuildOptions = {}): Promise<{ report: Report; evaluation: EvaluationResult; ownWords: Word[] }> {
  // Prefer the accurate batch transcript when it replaced the live one (compared by content: identity is lost on reload).
  const sameWords = (a: Word[], b: Word[]) => a.length === b.length && a.every((w, k) => w.text === b[k].text && Math.abs(w.start - b[k].start) < 0.01)
  const accurate = !sameWords(session.words, session.liveWords)
  const phrases = capture && !accurate ? capture.phrases : phrasesFromWords(ownSpeakerWords(session.words, capture?.samples ?? []))
  const base = {
    samples: capture?.samples ?? [],
    phrases,
    agentTurns: capture?.agentTurns.length ? capture.agentTurns : turnsFromQna(session),
    ruleEvents: capture?.ruleEvents ?? [],
    segments: capture?.segments ?? [],
    calibration: capture?.calibration ?? null,
    landmarks: capture?.landmarks,
    duration: session.duration,
    pitchEnd: session.pitchEnd,
    slideTexts: session.config.slides.map((s) => s.text),
  }
  const prelim = assembleEvaluation({ ...base, content: null })
  const insufficient = prelim.insufficientSpeech
  // Measured delivery from the speaker's own words only (prelim.transcript is already attributed to the speaker).
  const own = speakerWords(session.words, prelim.transcript)
  const ownSession = { ...session, words: own }
  const stats = deliveryStats(ownSession)
  const best = bestMoment(ownSession)

  let content: ContentEvaluation | null = null
  let contentError: string | null = insufficient
    ? 'Not enough speech to evaluate the content'
    : opts.skipJudge
      ? 'Claude is not configured (add ANTHROPIC_API_KEY to .env)'
      : null
  if (contentError === null) {
    try {
      content = await finalJudge(
        {
          durationSec: session.duration,
          context: session.config.context,
          slides: session.config.slides.map(({ index, text }) => ({ index, text })),
          transcript: transcriptLines(phrases),
          qna: session.qna.map((q) => ({
            persona: q.personaName,
            question: [q.question, ...q.followUps].join(' / Follow-up: '),
            answer: q.answer,
            agentNote: q.agentNote,
          })),
          segments: base.segments,
          measured: {
            measured_scores_0_100: prelim.finalScores,
            unmeasured: prelim.unmeasured,
            timing: prelim.timing,
            words_per_minute: stats.wpm && Math.round(stats.wpm),
            fillers_per_minute: Number(stats.fillersPerMin.toFixed(1)),
            slide_changes: session.slideChanges.map((s) => ({ t: Math.round(s.t), slide: s.slide + 1 })),
            gestures: gestureEpisodes(base.samples).map((g) => `${g.t.toFixed(1)}s ${GESTURE_LABEL[g.kind]}`),
          },
          ruleEvents: base.ruleEvents.map((e) => `[${e.t}s] ${e.cat}/${e.severity}: ${e.msg}`),
          bestMoment: best,
        },
        opts.onDelta,
      )
    } catch (err) {
      contentError = errorText(err)
    }
  }

  const evaluation = content ? assembleEvaluation({ ...base, content }) : prelim
  const delivery = deliveryBars(stats, evaluation, own, session)
  const fs = evaluation.finalScores
  const cScore = content ? contentScore(content, session.qna.length > 0) : null
  const deliveryScore = averageScore((['eye', 'body', 'tone'] as const).map((c) => (evaluation.unmeasured.includes(c) ? null : fs[c])))
  const sec = evaluation.userSpeechSec

  const priorities = content
    ? content.priorities.slice(0, 3).map((p) => ({ title: p.title, detail: p.detail, t: p.evidence_time_sec }))
    : insufficient
      ? [{ title: 'Speak for longer', detail: `We heard ${sec}s of you speaking. Pitch for at least ${T.minSpeechSec}s, facing the camera so we can tell your voice from others in the room.`, t: null }]
      : weakest(evaluation)

  const report: Report = {
    scale: 100,
    overall: fs.overall,
    insufficientSpeech: insufficient,
    contentScore: cScore,
    deliveryScore,
    contentWeight: T.overallWeights.coherency,
    delivery,
    content,
    contentError,
    bestMoment: best ? { ...best, note: content?.best_moment_note ?? 'Steady pace, few fillers and good energy in this stretch.' } : null,
    priorities,
  }
  return { report, evaluation, ownWords: own }
}
