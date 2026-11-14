// Builds the report: delivery layer (measured locally) + content layer (Claude, schema-validated) -> overall.
import { z } from 'zod'
import { errorText, postJson } from '../api'
import type { ContentEvaluation, Report, SessionData } from '../types'
import { averageScore, bestMoment, CONTENT_WEIGHT, deliveryScores, deliveryStats, timestampedTranscript } from './metrics'

// The server validates too; this guards the report screen against anything malformed.
const Dim = z.object({ score: z.number(), justification: z.string(), evidence_time_sec: z.number().nullable() })
const ContentSchema = z.object({
  summary: z.string(),
  dimensions: z.object({ overall_pitch: Dim, clarity: Dim, depth: Dim, qna: Dim, composure: Dim }),
  qna_feedback: z.array(z.object({ question_index: z.number(), score: z.number(), feedback: z.string() })),
  priorities: z.array(z.object({ title: z.string(), detail: z.string(), evidence_time_sec: z.number().nullable() })),
  best_moment_note: z.string(),
})

/** Below this many transcribed words the session is not scored. */
const MIN_WORDS = 20

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

export async function buildReport(session: SessionData): Promise<Report> {
  const stats = deliveryStats(session)
  const delivery = deliveryScores(stats)
  const deliveryScore = averageScore(delivery.map((d) => d.score))
  const best = bestMoment(session)
  const pitchWords = session.words.filter((w) => w.start < session.pitchEnd)

  let content: ContentEvaluation | null = null
  let contentError: string | null = null
  try {
    const raw = await postJson<unknown>(
      '/api/llm/evaluate',
      {
        context: session.config.context,
        durationSec: session.duration,
        slides: session.config.slides.map(({ index, text }) => ({ index, text })),
        transcript: timestampedTranscript(pitchWords),
        delivery: {
          words_per_minute: stats.wpm && Math.round(stats.wpm),
          fillers_per_minute: Number(stats.fillersPerMin.toFixed(1)),
          hesitant_pauses: stats.hesitations,
          deliberate_pauses: stats.deliberatePauses,
          eye_contact_share: stats.eyeContact,
          gestures: stats.gestures?.level ?? null,
          vocal_expressiveness: stats.expressiveness,
          slide_changes: session.slideChanges.map((s) => ({ t: Math.round(s.t), slide: s.slide + 1 })),
        },
        qna: session.qna.map((q) => ({
          persona: q.personaName,
          question: [q.question, ...q.followUps].join(' / Follow-up: '),
          answer: q.answer,
          agentScore: q.agentScore,
          agentNote: q.agentNote,
        })),
        bestMoment: best,
      },
      100000,
    )
    content = ContentSchema.parse(raw)
  } catch (err) {
    contentError = errorText(err)
  }

  const cScore = content ? contentScore(content, session.qna.length > 0) : null
  const overall =
    cScore !== null && deliveryScore !== null
      ? CONTENT_WEIGHT * cScore + (1 - CONTENT_WEIGHT) * deliveryScore
      : (cScore ?? deliveryScore ?? 0)

  // Priorities: from the content layer if present, otherwise from the weakest delivery signals.
  const priorities = content
    ? content.priorities.slice(0, 3).map((p) => ({ title: p.title, detail: p.detail, t: p.evidence_time_sec }))
    : delivery
        .filter((d) => d.score !== null && d.score < 7)
        .sort((a, b) => a.score! - b.score!)
        .slice(0, 3)
        .map((d) => ({ title: d.label, detail: d.note, t: null }))

  return {
    overall,
    insufficientSpeech: pitchWords.length < MIN_WORDS,
    contentScore: cScore,
    deliveryScore,
    contentWeight: CONTENT_WEIGHT,
    delivery,
    content,
    contentError,
    bestMoment: best ? { ...best, note: content?.best_moment_note ?? 'Steady pace, few fillers and good energy in this stretch.' } : null,
    priorities,
  }
}
