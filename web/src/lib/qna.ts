// Q&A orchestration. One panelist turn at a time, in one of two modes:
//  - spoken: the question is said through the main avatar (live Anam for the decision-maker,
//            a voice for the other panelists; browser speech when nothing is configured).
//            The answer comes from the live transcript.
//  - voice:  the ElevenLabs agent asks, listens and follows up, calling our client tools.
import { Conversation } from '@elevenlabs/client'
import { getJson, postJson } from '../api'
import type { SpeechLog } from '../avatar/mainAvatar'
import type { Persona, QnaTurn, SessionEvent, Slide } from '../types'

export type QnaMode = 'spoken' | 'voice'

export interface PlannedQuestion {
  persona_id: string
  question: string
  references: string
}

export interface TurnContext {
  slides: Slide[]
  now: () => number
  getTranscript: () => string
  getMetricsSummary: () => string
  /** Answer text heard by the live transcriber between two times (spoken mode). */
  getAnswerBetween: (from: number, to: number) => string
  /** Words heard since a time, to detect the end of an answer (spoken mode). */
  getAnswerWords: (from: number) => { end: number }[]
  onEvent: (e: SessionEvent) => void
  onSpeaking: (speaking: boolean) => void
  onCaption: (text: string) => void
  /** Says a line as this persona (main avatar or voice). See avatar/mainAvatar.ts speakAs. */
  say: (text: string, signal: AbortSignal) => Promise<SpeechLog>
}

const TURN_LIMIT_MS = 150_000
const LEAD_INS = ['Thanks for that.', 'Thank you.', 'Okay, thanks.', 'Right.']

function dynamicVariables(persona: Persona, q: PlannedQuestion, seat: number) {
  return {
    persona_name: persona.name,
    persona_role: persona.role,
    personality: persona.personality,
    focus: persona.focus.join(', '),
    strictness: String(persona.strictness),
    planned_question: q.question,
    first_message: `${LEAD_INS[seat % LEAD_INS.length]} ${q.question}`,
  }
}

/** Client tools shared by both agent modes. Each returns the text the agent sees. */
function makeTools(persona: Persona, ctx: TurnContext, turn: QnaTurn, end: () => void) {
  const log = (detail: string) => {
    turn.toolCalls.push(detail)
    ctx.onEvent({ t: ctx.now(), type: 'tool_called', detail: `${persona.name}: ${detail}` })
  }
  return {
    get_transcript: async () => {
      log('read the transcript')
      return ctx.getTranscript() || 'The speaker said very little.'
    },
    get_slide: async (args: { slide_number?: number }) => {
      const n = Math.round(Number(args?.slide_number ?? 0))
      log(`checked slide ${n}`)
      const slide = ctx.slides[n - 1]
      return slide ? `Slide ${n}: ${slide.text || '(no text on this slide)'}` : `There is no slide ${n}. The deck has ${ctx.slides.length} slides.`
    },
    get_metrics_summary: async () => {
      log('looked at delivery metrics')
      return ctx.getMetricsSummary()
    },
    log_answer_assessment: async (args: { score?: number; note?: string }) => {
      turn.agentScore = Math.max(0, Math.min(10, Number(args?.score ?? 0)))
      turn.agentNote = String(args?.note ?? '')
      log('scored the answer')
      return 'Logged.'
    },
    end_qna: async () => {
      end()
      return 'Ending your turn.'
    },
  }
}

function newTurn(persona: Persona, q: PlannedQuestion, start: number): QnaTurn {
  return {
    personaId: persona.id,
    personaName: persona.name,
    question: q.question,
    answer: '',
    followUps: [],
    start,
    end: start,
    agentScore: null,
    agentNote: null,
    toolCalls: [],
  }
}

/** Fills question, follow-ups and answer from a list of persona and user utterances. */
function applyTranscript(turn: QnaTurn, lines: { role: 'persona' | 'user'; text: string }[]) {
  const persona = lines.filter((l) => l.role === 'persona').map((l) => l.text.trim()).filter(Boolean)
  const user = lines.filter((l) => l.role === 'user').map((l) => l.text.trim()).filter(Boolean)
  if (persona[0]) turn.question = persona[0]
  // Later persona lines that ask something are follow-ups; the closing line is not.
  turn.followUps = persona.slice(1).filter((p) => p.includes('?'))
  turn.answer = user.join(' ')
}

export async function runTurn(
  mode: QnaMode,
  persona: Persona,
  seat: number,
  q: PlannedQuestion,
  ctx: TurnContext,
  skip: AbortSignal,
): Promise<QnaTurn> {
  if (mode === 'voice') return runVoiceTurn(persona, seat, q, ctx, skip)
  return runSpokenTurn(persona, q, ctx, skip)
}

async function runVoiceTurn(persona: Persona, seat: number, q: PlannedQuestion, ctx: TurnContext, skip: AbortSignal) {
  const { signedUrl } = await getJson<{ signedUrl: string }>('/api/voice/signed-url', 10000)
  const turn = newTurn(persona, q, ctx.now())
  turn.provider = 'elevenlabs'
  const lines: { role: 'persona' | 'user'; text: string }[] = []

  await new Promise<void>((resolve, reject) => {
    let conversation: Awaited<ReturnType<typeof Conversation.startSession>> | null = null
    let done = false
    const finish = (delayMs: number) => {
      if (done) return
      done = true
      window.setTimeout(async () => {
        try {
          await conversation?.endSession()
        } catch {
          // already ended
        }
        resolve()
      }, delayMs)
    }
    const tools = makeTools(persona, ctx, turn, () => finish(2500))
    Conversation.startSession({
      signedUrl,
      connectionType: 'websocket',
      dynamicVariables: dynamicVariables(persona, q, seat),
      overrides: { tts: { voiceId: persona.voiceId } },
      clientTools: tools as Record<string, (p: unknown) => Promise<string>>,
      onMessage: ({ message, source }) => {
        lines.push({ role: source === 'ai' ? 'persona' : 'user', text: message })
        if (source === 'ai') ctx.onCaption(message)
      },
      onModeChange: ({ mode }) => ctx.onSpeaking(mode === 'speaking'),
      onDisconnect: () => finish(0),
      onError: (message) => console.warn('ElevenLabs:', message),
    })
      .then((c) => {
        conversation = c
        if (done) void c.endSession()
      })
      .catch(reject)
    skip.addEventListener('abort', () => finish(0))
    window.setTimeout(() => finish(0), TURN_LIMIT_MS)
  })

  ctx.onSpeaking(false)
  turn.end = ctx.now()
  applyTranscript(turn, lines)
  return turn
}

/** The user has answered once they spoke and then stayed quiet this long. */
const ANSWER_SILENCE_S = 4
const ANSWER_LIMIT_MS = 90_000

async function runSpokenTurn(persona: Persona, q: PlannedQuestion, ctx: TurnContext, skip: AbortSignal) {
  const turn = newTurn(persona, q, ctx.now())
  ctx.onCaption(q.question)
  const spoken = await ctx.say(q.question, skip)
  turn.provider = spoken.provider
  turn.latencyMs = spoken.latencyMs
  const answerFrom = ctx.now()
  // Wait for "next question", for the user to answer and fall quiet, or for the time limit.
  await new Promise<void>((resolve) => {
    if (skip.aborted) return resolve()
    const started = performance.now()
    const timer = window.setInterval(() => {
      const answer = ctx.getAnswerWords(answerFrom)
      const quietFor = answer.length ? ctx.now() - answer[answer.length - 1].end : 0
      if (quietFor > ANSWER_SILENCE_S || performance.now() - started > ANSWER_LIMIT_MS) done()
    }, 500)
    const done = () => {
      window.clearInterval(timer)
      resolve()
    }
    skip.addEventListener('abort', done)
  })
  turn.end = ctx.now()
  // Give the transcriber a moment to commit the last words.
  await new Promise((r) => window.setTimeout(r, 1200))
  turn.answer = ctx.getAnswerBetween(answerFrom, turn.end + 1.5)
  return turn
}

/** Opening questions from Claude, or simple slide-based questions if that fails. */
export async function planQuestions(
  personas: Persona[],
  count: number,
  transcript: string,
  slides: Slide[],
  context: string,
): Promise<{ questions: PlannedQuestion[]; fallback: boolean }> {
  try {
    const res = await postJson<{ questions: PlannedQuestion[] }>(
      '/api/llm/questions',
      {
        personas: personas.map(({ id, name, role, personality, focus, strictness }) => ({ id, name, role, personality, focus, strictness })),
        count,
        transcript,
        slides: slides.map(({ index, text }) => ({ index, text })),
        context,
      },
      35000,
    )
    if (res.questions?.length) return { questions: res.questions.slice(0, count), fallback: false }
    throw new Error('No questions returned')
  } catch {
    const generic = [
      'What is the single strongest piece of evidence that people want this?',
      'Who exactly is your first customer, and how will you reach them?',
      'What is the biggest risk in your plan, and how would you know early that it is going wrong?',
      'Why is now the right time for this, and why are you the right team?',
      'What would you do with the next three months if this goes well?',
    ]
    const withSlides = slides
      .filter((s) => s.index > 0 && s.text.length > 20)
      .map((s) => `On slide ${s.index + 1} you say "${s.text.split(' ').slice(0, 8).join(' ')}". How do you know that is true?`)
    const pool = [...withSlides.slice(0, 2), ...generic]
    return {
      fallback: true,
      questions: Array.from({ length: count }, (_, i) => ({
        persona_id: personas[i % personas.length].id,
        question: pool[i % pool.length],
        references: 'fallback',
      })),
    }
  }
}
