// Client side of the Claude judge. Segments run in the background during the session (never on the
// critical path); the final merge is one streamed call at the end.
import { postJson } from '../api'
import type { AgentTurn, ContentEvaluation, FeedbackEvent, Phrase, SampleX, SegmentNote } from './contracts'
import { gestureEpisodes, GESTURE_LABEL } from './gestures'
import { pitchSpread } from './metrics'
import { wpmIn } from './rules'

const SEGMENT_EVERY_SEC = 45
const MIN_SEGMENT_SEC = 8

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

export interface JudgeData {
  samples: SampleX[]
  phrases: Phrase[]
  agentTurns: AgentTurn[]
  events: FeedbackEvent[]
  context: string
  pitchEnd: number | null
}

/** Numbers Claude can use in place of audio and video for one stretch of the session. */
export function signalSummary(samples: SampleX[], phrases: Phrase[], from: number, to: number) {
  const win = samples.filter((s) => s.t >= from && s.t < to)
  const face = win.filter((s) => s.face)
  const share = (xs: SampleX[], f: (s: SampleX) => boolean) => (xs.length ? r(xs.filter(f).length / xs.length) : null)
  const spread = pitchSpread(win, from, to)
  const wpm = wpmIn(phrases, from, to)
  const fillers = phrases.reduce((n, p) => n + p.fillers.filter((f) => f >= from && f < to).length, 0)
  return {
    eye_on_target_share: share(face, (s) => s.gazeOnTarget),
    arms_open_share: share(face, (s) => s.armsOpen),
    face_touch_frames: win.filter((s) => s.faceTouch).length,
    facing_panel_share: share(face.filter((s) => s.facing != null), (s) => s.facing! >= 0.75),
    gesturing_while_speaking_share: share(
      win.filter((s) => s.speaking),
      (s) => s.handSpeed >= 0.05 && s.handSpeed <= 1.2,
    ),
    fidget_frames: win.filter((s) => s.handsTogether && s.handSpeed > 0.05).length,
    // Judge whether each gesture fits what was being said at that moment.
    gestures: gestureEpisodes(win).map((g) => `${g.t.toFixed(1)}s ${GESTURE_LABEL[g.kind]}`),
    mean_slouch_0_1: face.length ? r(face.reduce((a, s) => a + s.slouch, 0) / face.length) : null,
    speaking_share: share(win, (s) => s.speaking),
    pitch_variety_semitones: spread === null ? null : r(spread, 1),
    words_per_minute: wpm === null ? null : Math.round(wpm),
    filler_words: fillers,
  }
}

export const transcriptLines = (phrases: Phrase[], from = 0, to = Infinity) =>
  phrases
    .filter((p) => p.t >= from && p.t < to)
    .map((p) => `[${p.t.toFixed(1)}s] ${p.text}`)
    .join('\n')

export class JudgeScheduler {
  segments: SegmentNote[] = []
  private pending = new Set<Promise<void>>()
  private lastCut = 0
  private enabled: boolean
  private data: () => JudgeData

  constructor(data: () => JudgeData, enabled = true) {
    this.data = data
    this.enabled = enabled
  }

  /** Call about once a second. Sends a chunk every 45 s, or immediately with `force` (after a Q&A exchange). */
  maybeCut(now: number, force = false) {
    if (!this.enabled) return
    const len = now - this.lastCut
    if (len < MIN_SEGMENT_SEC || (!force && len < SEGMENT_EVERY_SEC)) return
    const from = this.lastCut
    this.lastCut = now
    const d = this.data()
    if (!d.phrases.some((p) => p.t >= from && p.t < now)) return
    const body = {
      from: r(from, 1),
      to: r(now, 1),
      phase: d.pitchEnd !== null && from >= d.pitchEnd ? 'questions and answers' : 'pitch',
      context: d.context,
      transcript: transcriptLines(d.phrases, from, now),
      agentTurns: d.agentTurns
        .filter((a) => a.t >= from - 5 && a.t < now)
        .map((a) => `[${a.t.toFixed(1)}s] ${a.agent}: ${a.text}`)
        .join('\n'),
      signals: signalSummary(d.samples, d.phrases, from, now),
      ruleEvents: d.events.filter((e) => e.t >= from && e.t < now).map((e) => `[${e.t}s] ${e.cat}/${e.severity}: ${e.msg}`),
    }
    const p = postJson<SegmentNote>('/api/eval/segment', body, 35000)
      .then((note) => {
        this.segments.push(note)
        this.segments.sort((a, b) => a.from - b.from)
      })
      .catch((err) => console.warn('Judge segment failed:', err))
      .finally(() => this.pending.delete(p))
    this.pending.add(p)
  }

  /** Sends the last chunk and waits (bounded) for every segment still in flight. */
  async flush(now: number, timeoutMs = 20000) {
    this.maybeCut(now, true)
    await Promise.race([Promise.allSettled([...this.pending]), new Promise((res) => setTimeout(res, timeoutMs))])
    return this.segments
  }
}

export interface FinalJudgeInput {
  durationSec: number
  context: string
  slides: { index: number; text: string }[]
  transcript: string
  qna: { persona: string; question: string; answer: string; agentNote?: string | null }[]
  segments: SegmentNote[]
  measured: Record<string, unknown>
  ruleEvents: string[]
  bestMoment: { start: number; end: number; text: string } | null
}

/**
 * Streams the final merge. `onDelta` receives raw JSON text as it arrives (for a "writing your tips" indicator);
 * the promise resolves with the validated result.
 */
export async function finalJudge(input: FinalJudgeInput, onDelta?: (text: string) => void, timeoutMs = 100000): Promise<ContentEvaluation> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('/api/eval/final', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { error?: string }).error ?? `Final judge failed (${res.status})`)
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const event = /^event: (.*)$/m.exec(chunk)?.[1]
        const data = /^data: (.*)$/m.exec(chunk)?.[1]
        if (!event || data === undefined) continue
        const parsed = JSON.parse(data)
        if (event === 'delta') onDelta?.(parsed as string)
        else if (event === 'result') return parsed as ContentEvaluation
        else if (event === 'error') throw new Error((parsed as { error: string }).error)
      }
    }
    throw new Error('The final judge stream ended without a result')
  } catch (err) {
    if (controller.signal.aborted) throw new Error('The final judge timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
