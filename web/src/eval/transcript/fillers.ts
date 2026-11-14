// Filler-word detection over timestamped words. Works on Scribe's verbatim output (um/uh kept).
import type { Word } from '../../types'

export const clean = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '')

const SINGLE = new Set(['um', 'uh', 'erm', 'er', 'ah', 'uhm', 'hmm', 'mm', 'umm', 'uhh', 'basically', 'literally', 'actually'])
const PHRASES = [
  ['you', 'know'],
  ['i', 'mean'],
  ['sort', 'of'],
  ['kind', 'of'],
]

// "like" is a filler in "it was, like, huge" or "and like we…", but not in "I like it" or "like a phone".
const LIKE_NOT_AFTER = new Set([
  'i', 'you', 'we', 'they', 'would', "i'd", "we'd", "you'd", 'really', "don't", "didn't", "doesn't", 'do', 'does', 'did',
  'feel', 'feels', 'felt', 'look', 'looks', 'looked', 'seem', 'seems', 'sound', 'sounds', 'something', 'anything', 'nothing',
  'things', 'more', 'much', 'just', 'exactly', 'not', 'people', 'customers', 'users',
])
const LIKE_FILLER_AFTER = new Set(['and', 'but', 'so', 'was', 'is', "it's", 'were', 'been', 'um', 'uh', 'then', 'just', "that's", 'are'])
const LIKE_NOT_BEFORE = new Set(['a', 'an', 'the', 'to', 'this', 'that', 'these', 'those', 'them', 'him', 'her', 'me', 'us', 'it', 'what', 'how'])

function likeIsFiller(words: Word[], i: number): boolean {
  const raw = words[i].text
  const prevRaw = words[i - 1]?.text ?? ''
  if (/,$/.test(raw.trim()) || /,$/.test(prevRaw.trim())) return true
  const prev = clean(prevRaw)
  const next = clean(words[i + 1]?.text ?? '')
  if (SINGLE.has(next)) return true
  if (!prev || LIKE_NOT_AFTER.has(prev)) return false
  return LIKE_FILLER_AFTER.has(prev) && !LIKE_NOT_BEFORE.has(next)
}

/** Indices of words that are fillers. Phrase fillers mark the first word only. */
export function fillerIndices(words: Word[]): number[] {
  const out: number[] = []
  for (let i = 0; i < words.length; i++) {
    const w = clean(words[i].text)
    if (SINGLE.has(w)) {
      out.push(i)
      continue
    }
    if (w === 'like') {
      if (likeIsFiller(words, i)) out.push(i)
      continue
    }
    const next = clean(words[i + 1]?.text ?? '')
    if (PHRASES.some(([a, b]) => a === w && b === next)) out.push(i)
  }
  return out
}

/** Start times of filler words. */
export const fillerTimes = (words: Word[]) => fillerIndices(words).map((i) => words[i].start)
