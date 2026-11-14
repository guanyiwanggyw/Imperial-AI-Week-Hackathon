// Lines for when there is no Claude draft (no ANTHROPIC_API_KEY, or the draft is late).
// They respond to what the speaker just said: the latest turn is mirrored back in the second
// person ("you already have three paying clinics") and probed according to what it is
// (a number, customers, money, competitors, a problem, a plan). Persona strictness sets the tone;
// short spoken reactions ("Mm, okay.") and contractions keep it sounding like a person.
import type { Persona } from '../types'
import type { LineKind } from './floorManager'

export interface LineContext {
  /** What the speaker said since the last agent line (their latest turn). */
  turn: string
  /** The speaker addressed this agent by name, or asked the panel a question. */
  askedUs: boolean
  /** Another panelist who spoke last, to build on. */
  otherName?: string
  used: Set<string>
}

const FILLERS = /\b(um+|uh+|erm|you know|i mean|sort of|kind of|basically|actually|like,)\s*/gi
const FLIP: [RegExp, string][] = [
  [/\bI am\b/gi, 'you are'],
  [/\bI'm\b/gi, "you're"],
  [/\bI've\b/gi, "you've"],
  [/\bI'll\b/gi, "you'll"],
  [/\bI'd\b/gi, "you'd"],
  [/\bwe're\b/gi, "you're"],
  [/\bwe've\b/gi, "you've"],
  [/\bwe'll\b/gi, "you'll"],
  [/\bwe'd\b/gi, "you'd"],
  [/\bI\b/g, 'you'],
  [/\bwe\b/gi, 'you'],
  [/\bmy\b/gi, 'your'],
  [/\bour\b/gi, 'your'],
  [/\bours\b/gi, 'yours'],
  [/\bmine\b/gi, 'yours'],
  [/\bus\b/gi, 'you'],
  [/\bme\b/gi, 'you'],
]

/** Drops fillers and the punctuation or discourse words they leave behind ("Um, so we..." -> "we..."). */
function tidy(text: string): string {
  return text
    .replace(FILLERS, '')
    .replace(/\s+/g, ' ')
    .replace(/(^|[.!?]\s*)[\s,;:-]*(?:(?:so|well|okay|right|yeah|and)\b[\s,]*)*/gi, '$1')
    .replace(/\s+([,.!?])/g, '$1')
    .trim()
}

/** "We already have three paying clinics." -> "you already have three paying clinics" */
export function mirror(sentence: string): string {
  let s = tidy(sentence).replace(/[.!?,;:]+$/, '')
  for (const [re, to] of FLIP) s = s.replace(re, to)
  return s.charAt(0).toLowerCase() + s.slice(1)
}

type Topic = 'figure' | 'customers' | 'money' | 'competition' | 'problem' | 'plan' | 'team' | 'product' | 'general'

// Checked in order: the most specific signal wins ("unlike the incumbents ... patient records" is competition).
const TOPICS: [Topic, RegExp][] = [
  ['competition', /\b(competitors?|competition|alternatives?|incumbents?|instead of|unlike|better than)\b/i],
  ['money', /(£|\$|€)|\b(pounds?|dollars?|euros?|raise|raising|funding|invest|investment|revenue|price|pricing|charge|subscription|ask)\b/i],
  ['problem', /\b(problem|pain|struggle|hard|waste|wasting|slow|expensive|frustrat\w*|manual|paperwork)\b/i],
  ['customers', /\b(customers?|clients?|users?|clinics?|schools?|companies|businesses|students?|pilots?|signed|paying)\b/i],
  ['plan', /\b(will|going to|plan|planning|next|launch|roadmap|soon|future|expand|scale)\b/i],
  ['team', /\b(team|co-?founders?|engineers?|hired|hire|background|experience)\b/i],
  ['product', /\b(app|platform|product|tool|software|ai|model|feature|build|built)\b/i],
]

/** The sentence of the turn most worth responding to, and what it is about. */
const NUM = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand|million|billion|half|double|\\d[\\d,.]*)'
const UNIT = '(?:%|percent|k|m|x|times|pounds?|dollars?|euros?|hours?|days?|weeks?|months?|years?)'
/** A spoken figure with its scale and unit: "two hundred thousand pounds", "£200k", "30%", "two hours". */
const FIGURE = new RegExp(`(?:£|\\$|€)?\\b${NUM}\\b(?:[\\s-]+${NUM}\\b)*(?:\\s?${UNIT}\\b)?`, 'i')
const STOP = /^(to|for|in|at|on|by|and|but|so|because|which|that|with|from|of)$/i

export interface Said {
  sentence: string
  topic: Topic
  figure: string | null
  /** Short gist for comments: the figure and the words right after it ("three paying clinics"). */
  gist: string | null
  question: boolean
}

export function analyse(turn: string): Said | null {
  const clean = tidy(turn)
  if (clean.split(/\s+/).length < 3) return null
  const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3)
  if (!sentences.length) return null
  const figureOf = (s: string) => s.match(FIGURE)?.[0].trim() ?? null
  // Prefer the latest sentence with a figure or a recognisable topic.
  const scored = sentences.map((s) => ({ s, figure: figureOf(s), topic: (TOPICS.find(([, re]) => re.test(s))?.[0] ?? 'general') as Topic }))
  // Mirror statements, never the speaker's own questions ("You said Marcus, what do you think..." is wrong).
  const statements = scored.filter((x) => !/\?\s*$/.test(x.s))
  const pool = statements.length ? statements : scored
  const best = [...pool].reverse().find((x) => x.figure || x.topic !== 'general') ?? pool[pool.length - 1]
  // Mirror one clause, not a run-on: stop at ", and/but/so" once there are a few words.
  const clause = best.s.match(/^(.{20,}?),\s+(and|but|so|which|because)\s/i)?.[1] ?? best.s
  const words = clause.split(/\s+/)
  const sentence = words.length > 14 ? words.slice(-14).join(' ') : clause
  // The gist comes from the latest sentence with a figure, even if the best sentence is a question
  // about it ("We charge four hundred pounds a month. Marcus, what do you think about that price?").
  const withFigure = best.figure ? best : [...scored].reverse().find((x) => x.figure)
  let gist: string | null = null
  if (withFigure?.figure) {
    const after = withFigure.s.slice(withFigure.s.indexOf(withFigure.figure) + withFigure.figure.length).replace(/[.,;:!?].*$/, '').trim().split(/\s+/)
    const tail: string[] = []
    for (const w of after) {
      if (!w || STOP.test(w) || tail.length >= 3) break
      tail.push(w)
    }
    gist = mirror([withFigure.figure, ...tail].join(' '))
  }
  const figure = best.figure ?? withFigure?.figure ?? null
  return { sentence, topic: best.figure && best.topic === 'general' ? 'figure' : best.topic, figure, gist, question: /\?\s*$/.test(clean) }
}

const PROBES: Record<Topic, (f: string | null) => string[]> = {
  figure: (f) => [`how did you get to ${f}?`, `${f} compared with what?`, `what's behind that ${f}?`],
  customers: () => ['how did you find them?', 'are they paying, and what for?', "what would make them leave?"],
  money: (f) => [f ? `what does ${f} get you, specifically?` : 'what will the money get you, specifically?', "how did you land on that price?", "what's the margin on that?"],
  competition: () => ['why would anyone switch to you?', "what stops them copying you?", "who's the one you actually worry about?"],
  problem: () => ['how do you know that pain is real for them?', "what do they do about it today?", 'how often does that happen?'],
  plan: () => ["what's stopping you doing that today?", 'when, realistically?', "what has to be true for that to work?"],
  team: () => ['why is this the right team for it?', "who's missing from the team?"],
  product: () => ["what's actually built today?", 'what part is hardest to build?', "what's the one thing it does better?"],
  general: () => ['can you say more about that?', 'what makes you sure about that?', 'can you give me an example?'],
}

const REACT_WARM = ['Okay, nice.', 'Mm, I like that.', 'Right, thanks.', 'Okay, that helps.', 'Got it.']
const REACT_COOL = ['Okay.', 'Hm.', 'Right.', 'Mm.']
const COMMENT_WARM = (s: string) => [`${cap(s)}, that's a good sign.`, `Oh, ${s}? I like that.`, `${cap(s)}. Okay, that's genuinely interesting.`]
const COMMENT_COOL = (s: string) => [`${cap(s)}. I'd want to see how that holds up.`, `Hm, ${s}. That's a big claim.`, `${cap(s)}. Okay, noted.`]
/** Comments by topic when there's no short figure to echo. */
const TOPIC_COMMENT: Record<Topic, [string[], string[]]> = {
  figure: [["Those numbers are encouraging."], ["I'd want to see where those numbers come from."]],
  customers: [['Real customers already, that matters.'], ["Okay, but a few customers isn't a market yet."]],
  money: [['That ask sounds about right to me.'], ["That's a big ask for where you are."]],
  competition: [["Okay, that's a clear difference."], ["Everyone says that about the incumbents."]],
  problem: [["Yeah, that's a real pain, I can see it."], ['I believe the pain. I want to see they will pay to fix it.']],
  plan: [["Ambitious. I like it."], ["That's a plan. I'd want to see the steps."]],
  team: [['Sounds like a solid team.'], ["I'd want to know who's actually done this before."]],
  product: [["Nice, that's concrete."], ['Okay. I want to see it working.']],
  general: [['Okay, that makes sense to me.', "That's a clear way to put it."], ["Hm, I'm not fully convinced yet.", 'Okay. Noted.']],
}
const NUDGES = ['Take your time.', "No rush, whenever you're ready.", "Go on, we're listening."]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Questions from the agent's own focus, for when the speaker hasn't said anything to react to yet.
const BY_FOCUS: [RegExp, string[]][] = [
  [/market/i, ["How big is the market you're going after, really?", "Who else is fighting for this market?"]],
  [/traction|evidence/i, ["What's the strongest evidence people want this?", 'What traction do you have so far?']],
  [/customer/i, ['Who exactly is your first customer?', 'What does a customer do today without you?']],
  [/go-to-market|sales/i, ['How will you reach your first hundred customers?', "What does it cost you to win one customer?"]],
  [/team/i, ['Why is your team the one to build this?']],
  [/feasib|technolog/i, ["What's actually built today, and what's still a plan?", "What's the hardest technical part?"]],
  [/risk/i, ["What's the biggest risk in your plan?", 'What would make this fail in year one?']],
]
const GENERAL = ['Why is now the right time for this?', 'How do you make money?', 'What makes this hard to copy?']

export function fallbackLine(persona: Persona, kind: LineKind, ctx: LineContext): string {
  const pick = (pool: string[]) => {
    const fresh = pool.filter((l) => !ctx.used.has(l))
    const choice = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))]
    ctx.used.add(choice)
    return choice
  }
  const warm = persona.strictness <= 3
  const said = analyse(ctx.turn)
  const react = () => (Math.random() < 0.55 ? `${pick(warm ? REACT_WARM : REACT_COOL)} ` : '')
  // Mirror + probe: "You said you already have three paying clinics. How did you find them?"
  const probe = (s: NonNullable<typeof said>) => {
    const q = pick(PROBES[s.topic](s.figure))
    return Math.random() < 0.6 ? `You said ${mirror(s.sentence)}. ${cap(q)}` : `So ${mirror(s.sentence)}. ${cap(q)}`
  }

  switch (kind) {
    case 'reply': {
      // The speaker asked us something: answer like a person, in character, about the thing they asked.
      const g = said?.gist ? cap(said.gist) : null
      if (g && (said?.topic === 'money' || said?.topic === 'figure')) {
        return warm
          ? pick([`${g}? Honestly, that sounds fair if it really saves them that much time.`, `${g} feels reasonable to me. I'd want to know they'll keep paying it.`])
          : pick([`${g}? I'm not sure yet. I'd want proof they'll keep paying that.`, `Honestly, ${said!.gist} needs justifying. What does it save them?`])
      }
      if (g) return warm ? `${g}, honestly, I like it. Tell me a bit more.` : `${g}. Honestly, I'm not convinced yet. Show me more.`
      const about = said && said.topic !== 'general' ? ` on the ${said.topic}` : ''
      return warm
        ? pick([`Honestly? I like where this is going. I'd just want a bit more${about}.`, `I'm fairly positive, I just need more${about}.`])
        : pick([`Honestly, I'm not convinced yet. Show me more${about}.`, `Right now I'd say no, not without more${about}.`])
    }
    case 'follow_up': {
      if (!said) return pick(['Can you put a number on that?', 'Can you give me a concrete example?'])
      const q = cap(pick(PROBES[said.topic](said.figure)))
      // Acknowledge what they said before pressing: "Three paying clinics. What would make them leave?"
      return said.gist && Math.random() < 0.6 ? `${cap(said.gist)}. ${q}` : `${react()}${q}`
    }
    case 'question': {
      // Respond to what they said whenever there is something to respond to.
      if (said && Math.random() < 0.9) {
        const line = probe(said)
        return ctx.otherName && Math.random() < 0.3 ? `Building on ${ctx.otherName}'s point. ${line}` : `${react()}${line}`
      }
      const focused = BY_FOCUS.filter(([re]) => persona.focus.some((f) => re.test(f))).flatMap(([, qs]) => qs)
      return pick(focused.some((l) => !ctx.used.has(l)) ? focused : GENERAL)
    }
    case 'comment': {
      // Echo their point: the figure and its subject, or a short sentence, else a reaction to the topic.
      const [w, c] = TOPIC_COMMENT[said?.topic ?? 'general']
      // A problem gets sympathy or doubt about the pain, not "that's a good sign".
      if (said?.topic === 'problem') return `${said.gist ? `${cap(said.gist)}. ` : ''}${pick(warm ? w : c)}`
      const echo = said?.gist ?? (said && said.sentence.split(/\s+/).length <= 9 ? mirror(said.sentence) : null)
      if (echo) return pick((warm ? COMMENT_WARM : COMMENT_COOL)(echo))
      return pick(warm ? w : c)
    }
    case 'interjection':
      return said
        ? `Sorry to jump in. ${probe(said)}`
        : pick(["Sorry to jump in, what's the one thing you want us to remember?", 'Can I stop you there? Who is this for, exactly?'])
    case 'nudge':
      return pick(NUDGES)
  }
}
