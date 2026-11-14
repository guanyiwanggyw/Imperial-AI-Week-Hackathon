// Phrase objects (the brief's transcript contract) from timestamped words.
import type { Word } from '../../types'
import type { Phrase } from '../contracts'
import { fillerTimes } from './fillers'

const round = (n: number) => Math.round(n * 100) / 100

export function makePhrase(words: Word[]): Phrase | null {
  if (!words.length) return null
  const t = words[0].start
  const end = words[words.length - 1].end
  return {
    t: round(t),
    end: round(end),
    text: words.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'),
    fillers: fillerTimes(words).map(round),
    wpm: Math.round((words.length / Math.max(end - t, 0.5)) * 60),
  }
}

/** Splits a word list into phrases at pauses of `gap` seconds or more, like a VAD commit would. */
export function phrasesFromWords(words: Word[], gap = 0.6): Phrase[] {
  const out: Phrase[] = []
  let cur: Word[] = []
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end >= gap) {
      const p = makePhrase(cur)
      if (p) out.push(p)
      cur = []
    }
    cur.push(w)
  }
  const p = makePhrase(cur)
  if (p) out.push(p)
  return out
}

/** Words back out of phrases (approximate timing, spread evenly). Used when only phrases exist. */
export function wordsFromPhrases(phrases: Phrase[]): Word[] {
  return phrases.flatMap((p) => {
    const tokens = p.text.split(/\s+/).filter(Boolean)
    const step = (p.end - p.t) / Math.max(tokens.length, 1)
    return tokens.map((text, i) => ({ text, start: p.t + i * step, end: p.t + (i + 1) * step }))
  })
}
