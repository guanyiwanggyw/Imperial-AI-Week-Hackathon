// Hand-shape gestures from MediaPipe hand landmarks, and whether they match what the speaker was saying.
// A thumbs-up while describing a problem sends a mixed message; the evaluation flags it (body language).
import type { FeedbackEvent, Phrase, SampleX } from './contracts'

export type GestureKind = 'thumbs_up' | 'thumbs_down' | 'point' | 'open_palm' | 'fist'

type Lm = { x: number; y: number }

export const GESTURE_LABEL: Record<GestureKind, string> = {
  thumbs_up: 'thumbs-up',
  thumbs_down: 'thumbs-down',
  point: 'pointing',
  open_palm: 'open palm',
  fist: 'fist',
}

/**
 * Classifies one hand (21 landmarks, normalised image coordinates). Distances are measured from the wrist, so the
 * test works whichever way the hand is rotated; "up" and "down" use image y (down is +y).
 */
export function classifyHand(hand: Lm[], aspect: number): GestureKind | null {
  if (hand.length < 21) return null
  const P = (i: number) => ({ x: hand[i].x * aspect, y: hand[i].y })
  const d = (a: number, b: number) => Math.hypot(P(a).x - P(b).x, P(a).y - P(b).y)
  const size = d(0, 9) // wrist to middle-finger knuckle
  if (size < 1e-3) return null
  const fingers = [
    [5, 6, 8],
    [9, 10, 12],
    [13, 14, 16],
    [17, 18, 20],
  ]
  const extended = fingers.map(([mcp, pip, tip]) => d(tip, 0) > d(pip, 0) * 1.2 && d(tip, 0) > d(mcp, 0) * 1.45)
  const curled = fingers.map(([, pip, tip]) => d(tip, 0) < d(pip, 0) * 1.08)
  const thumbOut = d(4, 5) > size * 0.55 && d(4, 0) > d(3, 0)
  const allCurled = curled.every(Boolean)
  if (thumbOut && allCurled) {
    if (P(4).y < P(3).y && P(4).y < P(5).y - size * 0.3) return 'thumbs_up'
    if (P(4).y > P(3).y && P(4).y > P(17).y + size * 0.3) return 'thumbs_down'
  }
  if (extended[0] && curled[1] && curled[2] && curled[3]) return 'point'
  if (extended.every(Boolean)) return 'open_palm'
  if (allCurled && !thumbOut) return 'fist'
  return null
}

/** The most telling gesture across both hands (thumbs beat pointing beat an open palm beat a fist). */
export function frameGesture(hands: Lm[][], aspect: number): GestureKind | null {
  const order: GestureKind[] = ['thumbs_up', 'thumbs_down', 'point', 'open_palm', 'fist']
  const found = hands.map((h) => classifyHand(h, aspect)).filter((g): g is GestureKind => g !== null)
  return order.find((g) => found.includes(g)) ?? null
}

export interface GestureEpisode {
  kind: GestureKind
  t: number
  end: number
}

/** Runs of the same gesture held for at least `minSec` (brief flickers are ignored). */
export function gestureEpisodes(samples: SampleX[], minSec = 0.4): GestureEpisode[] {
  const out: GestureEpisode[] = []
  let cur: GestureEpisode | null = null
  for (const s of samples) {
    const g = (s.gesture ?? null) as GestureKind | null
    if (cur && g === cur.kind && s.t - cur.end < 0.5) {
      cur.end = s.t
      continue
    }
    if (cur && cur.end - cur.t >= minSec) out.push(cur)
    cur = g ? { kind: g, t: s.t, end: s.t } : null
  }
  if (cur && cur.end - cur.t >= minSec) out.push(cur)
  return out
}

// A small sentiment lexicon for pitch talk. "not"/"no"/"never" within two words flips the next sentiment word.
const POSITIVE = new Set(
  'good great growth grew grow growing win wins winning won success successful love loved best easy easier improve improved improving increase increased profit profitable paying record strong fast faster cheaper save saves saved happy excited proud solved solves works working traction signed doubled tripled launch launched'.split(' '),
)
const NEGATIVE = new Set(
  'problem problems fail failed failing failure lost lose losing loss drop dropped decline declined declining bad worse worst risk risky churn churned struggle struggling broken expensive slow slower pain painful difficult hard hate wrong issue issues concern concerns crisis waste wasted debt behind stuck frustrated frustrating miss missed cancel cancelled complaint complaints'.split(' '),
)
const NEGATORS = new Set(['not', 'no', 'never', "don't", "doesn't", "didn't", "isn't", "wasn't", "can't", 'cannot', 'without'])

/** Sentiment of the words spoken in [from, to]: + positive, − negative, with the words that decided it. */
export function sentimentBetween(phrases: Phrase[], from: number, to: number): { score: number; words: string[]; text: string } {
  const inWin = phrases.filter((p) => p.end >= from && p.t <= to)
  const tokens = inWin.flatMap((p) => p.text.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean))
  let score = 0
  const hits: string[] = []
  tokens.forEach((w, i) => {
    const flip = NEGATORS.has(tokens[i - 1] ?? '') || NEGATORS.has(tokens[i - 2] ?? '')
    const v = POSITIVE.has(w) ? 1 : NEGATIVE.has(w) ? -1 : 0
    if (!v) return
    score += flip ? -v : v
    hits.push(flip ? `not ${w}` : w)
  })
  return { score, words: hits, text: inWin.map((p) => p.text).join(' ').slice(0, 90) }
}

/**
 * Body-language events for gestures that contradict, or reinforce, what was being said at the time.
 * Only thumbs up/down carry a clear valence; the others are left to Claude (which sees the gesture timeline).
 */
export function gestureCongruence(samples: SampleX[], phrases: Phrase[]): Omit<FeedbackEvent, 'source'>[] {
  const out: Omit<FeedbackEvent, 'source'>[] = []
  for (const g of gestureEpisodes(samples)) {
    if (g.kind !== 'thumbs_up' && g.kind !== 'thumbs_down') continue
    const s = sentimentBetween(phrases, g.t - 2.5, g.end + 2.5)
    if (!s.words.length) continue
    const quote = s.text ? ` ("${s.text.length >= 90 ? s.text + '…' : s.text}")` : ''
    if (g.kind === 'thumbs_up' && s.score < 0) out.push({ t: g.t, end: g.end, cat: 'body', severity: 'warn', msg: `Thumbs-up while describing something negative${quote}. Mixed message.` })
    else if (g.kind === 'thumbs_down' && s.score > 0) out.push({ t: g.t, end: g.end, cat: 'body', severity: 'warn', msg: `Thumbs-down while saying something positive${quote}. Mixed message.` })
    else if ((g.kind === 'thumbs_up' && s.score > 0) || (g.kind === 'thumbs_down' && s.score < 0)) out.push({ t: g.t, end: g.end, cat: 'body', severity: 'good', msg: `Your ${GESTURE_LABEL[g.kind]} matched what you were saying` })
  }
  return out
}
