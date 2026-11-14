// Interactive session orchestrator (brief §2 "The tick loop"). One object owns the panel's shared
// state; agents are data. Every TICK_MS it asks the floor manager whether anyone should speak,
// takes that agent's line (a Claude Haiku draft that reflects the speaker's latest words, or a
// built-in line that responds to them directly) and speaks it through the agent's live avatar.
// If the speaker talks over an agent, the agent stops, unless it is stubborn.
import { postJson } from '../api'
import type { SpeechLog } from '../avatar/panelAvatars'
import type { Phrase, RoomState, SampleX } from '../eval'
import type { Persona, SessionEvent } from '../types'
import { fallbackLine } from './fallbackLines'
import { decide, type AgentSlot, type Decision, type LastLine, type LineKind } from './floorManager'
import { traits } from './traits'

const TICK_MS = 300
/** Speaker's mouth moving with voice for this long during an agent line = barge-in. */
const BARGE_IN_S = 0.5
/** Minimum time between background draft requests. */
const DRAFT_GAP_S = 2.5
/** How long a reactive line may wait for a fresh Claude draft (about a human beat) before using the built-in line. */
const FRESH_WAIT_MS = 1800

type Draft = Record<Exclude<LineKind, 'nudge'>, string>

export interface ConversationLine {
  t: number
  who: string // persona id, or 'user'
  name: string
  text: string
  kind?: LineKind
}

export interface OrchestratorDeps {
  personas: Persona[]
  /** Claude drafts available (ANTHROPIC_API_KEY set). Otherwise built-in lines only. */
  drafts: boolean
  context: string
  now: () => number
  /** False while paused. */
  active: () => boolean
  room: () => RoomState | null
  phrases: () => Phrase[]
  samples: () => SampleX[]
  /** Speaks as the agent through its avatar; must log the AgentTurn. */
  say: (persona: Persona, seat: number, text: string, signal: AbortSignal) => Promise<SpeechLog>
  /** A question-and-answer exchange finished (for the background judge). */
  onExchange?: () => void
  /** For the UI and debugging. */
  onDecision?: (d: Decision & { text: string }) => void
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ASKED = /\b(what do you (all )?think|any thoughts|does that make sense|what would you (do|say))\b/i

export class Orchestrator {
  private deps: OrchestratorDeps
  private agents: AgentSlot[]
  private timer: number | null = null
  private speaking = false
  private abort: AbortController | null = null
  private last: LastLine | null = null
  private followUpsLeft = 0
  private lastInterruptAt = -Infinity
  private lastCommentAt = -Infinity
  private claimAt: number | null = null
  private nudged = false
  /** Per agent: Claude's latest lines, and how many transcript phrases they were written from. */
  private drafts = new Map<string, { basedOn: number; lines: Draft }>()
  private inFlight: Promise<void> | null = null
  private lastDraftAt = -Infinity
  private draftedPhrases = -1
  private used = new Set<string>()
  readonly conversation: ConversationLine[] = []

  constructor(deps: OrchestratorDeps) {
    this.deps = deps
    this.agents = deps.personas.map((persona) => ({ persona, traits: traits(persona), turns: 0 }))
  }

  start() {
    if (this.timer !== null) return
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.abort?.abort()
  }

  /** Live events from the reaction engine; an unsupported claim lets evidence-minded agents cut in. */
  notifyEvent(e: SessionEvent) {
    if (e.type === 'claim_without_evidence') this.claimAt = e.t
  }

  /** The speaker's latest turn: everything said since the last agent line, who they named, whether they asked. */
  private latestTurn(phrases: Phrase[]) {
    const since = this.last ? this.last.end - 0.2 : -Infinity
    const turn = phrases.filter((p) => p.t > since)
    const text = turn.map((p) => p.text).join(' ').trim()
    // Named an agent? ("Priya, what do you think?") The last name mentioned wins.
    let addressedId: string | null = null
    let at = -1
    for (const a of this.agents) {
      const first = a.persona.name.split(' ')[0]
      const hits = [...text.matchAll(new RegExp(`\\b${escapeRe(first)}\\b`, 'gi'))]
      const idx = hits.length ? (hits[hits.length - 1].index ?? -1) : -1
      if (idx > at) {
        at = idx
        addressedId = a.persona.id
      }
    }
    const askedPanel = Boolean(text) && (/\?\s*$/.test(text) || ASKED.test(text))
    return { phrases: turn, text, addressedId, askedPanel }
  }

  private tick() {
    const room = this.deps.room()
    if (!room || !this.deps.active()) return
    this.maybeRefreshDrafts()
    if (this.speaking) return
    const phrases = this.deps.phrases()
    const turn = this.latestTurn(phrases)
    const answeredSinceLast = this.last !== null && turn.phrases.length > 0
    if (answeredSinceLast) this.nudged = false
    const decision = decide({
      now: this.deps.now(),
      room,
      agents: this.agents,
      agentSpeaking: this.speaking,
      last: this.last,
      answeredSinceLast,
      followUpsLeft: this.followUpsLeft,
      lastInterruptAt: this.lastInterruptAt,
      lastCommentAt: this.lastCommentAt,
      claimAt: this.claimAt,
      nudged: this.nudged,
      addressedId: turn.addressedId,
      askedPanel: turn.askedPanel,
    })
    if (decision) void this.speak(decision, turn.text)
  }

  /**
   * The line to say. A Claude draft is used only if it already saw the speaker's latest words; for a
   * reactive line (follow-up, comment, reply, or a question after an answer) a stale draft is first
   * refreshed for this one agent, waiting at most FRESH_WAIT_MS. Otherwise the built-in line, which
   * responds to the latest turn directly.
   */
  private async lineFor(persona: Persona, kind: LineKind, turn: string): Promise<string> {
    const phrases = this.deps.phrases().length
    const reactive = kind === 'follow_up' || kind === 'comment' || kind === 'reply' || (kind === 'question' && turn.length > 0)
    if (kind !== 'nudge' && this.deps.drafts) {
      let entry = this.drafts.get(persona.id)
      if (reactive && (!entry || entry.basedOn < phrases)) {
        await Promise.race([this.requestDrafts([persona]), new Promise((r) => window.setTimeout(r, FRESH_WAIT_MS))])
        entry = this.drafts.get(persona.id)
      }
      const draft = entry && (!reactive || entry.basedOn >= phrases) ? entry.lines[kind] : undefined
      if (draft && !this.used.has(draft)) {
        this.used.add(draft)
        return draft
      }
    }
    const other = this.last && this.last.personaId !== persona.id ? this.agents.find((a) => a.persona.id === this.last!.personaId) : undefined
    return fallbackLine(persona, kind, { turn, askedUs: kind === 'reply', otherName: other?.persona.name.split(' ')[0], used: this.used })
  }

  private async speak(d: Decision, turn: string) {
    const seat = this.agents.findIndex((a) => a.persona.id === d.personaId)
    const agent = this.agents[seat]
    if (!agent) return
    this.speaking = true // holds the floor while the line is prepared
    const text = await this.lineFor(agent.persona, d.kind, turn)
    const t = this.deps.now()
    if (d.kind === 'interjection') this.lastInterruptAt = t
    if (d.kind === 'comment') this.lastCommentAt = t
    if (d.kind === 'nudge') this.nudged = true
    // A new question closes the previous exchange for the judge.
    if ((d.kind === 'question' || d.kind === 'interjection') && this.last && this.last.kind !== 'comment') this.deps.onExchange?.()
    this.deps.onDecision?.({ ...d, text })

    const abort = new AbortController()
    this.abort = abort
    // Barge-in: the speaker's own mouth moves with voice while the agent talks (Jihu's mouth gate
    // keeps the agent's audio leaking into the mic from counting). Stubborn agents finish.
    const watch = window.setInterval(() => {
      if (agent.traits.stubborn) return
      const now = this.deps.now()
      const recent = this.deps.samples().filter((s) => s.t > now - BARGE_IN_S - 0.1)
      const talking = recent.filter((s) => s.mouthMoving && s.micVoice)
      if (recent.length >= 3 && talking.length >= recent.length * 0.7) abort.abort()
    }, 150)
    try {
      await this.deps.say(agent.persona, seat, text, abort.signal)
    } catch (err) {
      console.warn('[agents] line failed:', err)
    } finally {
      window.clearInterval(watch)
      this.abort = null
    }
    const end = this.deps.now()
    agent.turns++
    if (d.kind === 'question' || d.kind === 'interjection') this.followUpsLeft = agent.traits.followUps
    else if (d.kind === 'follow_up') this.followUpsLeft = Math.max(0, this.followUpsLeft - 1)
    this.last = { personaId: agent.persona.id, kind: d.kind, t, end }
    this.conversation.push({ t, who: agent.persona.id, name: agent.persona.name, text, kind: d.kind })
    this.speaking = false
    if (abort.signal.aborted) console.info(`[agents] ${agent.persona.name} stopped: the speaker talked over them`)
  }

  /** Background drafts for the whole panel, refreshed after new transcript commits. */
  private maybeRefreshDrafts() {
    if (!this.deps.drafts || this.inFlight) return
    if (this.deps.phrases().length === this.draftedPhrases || this.deps.now() - this.lastDraftAt < DRAFT_GAP_S) return
    void this.requestDrafts(this.deps.personas)
  }

  /** One batched Claude call for these agents; results are tagged with how much transcript they saw. */
  private requestDrafts(personas: Persona[]): Promise<void> {
    if (this.inFlight) return this.inFlight
    const phrases = this.deps.phrases()
    const basedOn = phrases.length
    this.lastDraftAt = this.deps.now()
    this.draftedPhrases = basedOn
    const conversation = [
      ...phrases.slice(-20).map((p) => ({ t: p.t, who: 'Speaker', text: p.text })),
      ...this.conversation.slice(-10).map((c) => ({ t: c.t, who: c.name, text: c.text })),
    ].sort((a, b) => a.t - b.t)
    const since = this.last ? this.last.end - 0.2 : -Infinity
    const latest = phrases
      .filter((p) => p.t > since)
      .map((p) => p.text)
      .join(' ')
    this.inFlight = postJson<{ drafts: ({ persona_id: string } & Draft)[] }>(
      '/api/agents/drafts',
      {
        personas: personas.map(({ id, name, role, personality, focus, strictness }) => ({ id, name, role, personality, focus, strictness })),
        transcript: phrases.map((p) => `[${Math.round(p.t)}s] ${p.text}`).join('\n'),
        conversation: conversation.map(({ who, text }) => ({ who, text })),
        latest,
        context: this.deps.context,
      },
      15000,
    )
      .then(({ drafts }) => {
        for (const d of drafts) {
          this.drafts.set(d.persona_id, {
            basedOn,
            lines: { question: d.question, follow_up: d.follow_up, comment: d.comment, interjection: d.interjection, reply: d.reply },
          })
        }
      })
      .catch((err) => {
        // No key or a slow/failed call: the built-in lines carry the session.
        console.warn('[agents] drafts unavailable, using built-in lines:', err instanceof Error ? err.message : err)
        if (/not configured/i.test(String(err))) this.deps.drafts = false
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }
}
