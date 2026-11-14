// Calibration ("training") CLI. Re-scores saved sessions with the current thresholds, offline and without Claude,
// so you can check that good and bad team recordings separate, then tune src/eval/thresholds.ts.
//
//   npm run eval:calibrate                     # all sessions in server/data/sessions
//   npm run eval:calibrate -- --fake 3         # plus 3 fake sessions (smoke test)
//   npm run eval:calibrate -- --json out.json  # also write the full numbers
//
// Labels: server/data/calibration-labels.json  { "<session id>": "good" | "bad" }, or put [good] / [bad] in the title.
import fs from 'node:fs'
import path from 'node:path'
import type { SessionData } from '../../types'
import { assembleEvaluation } from '../assemble'
import type { AgentTurn, EvaluationResult, Phrase, SampleX } from '../contracts'
import { makeFakeData, replayLive } from '../fake'
import { signalSummary } from '../judge'
import { phrasesFromWords } from '../transcript/phrases'

type Label = 'good' | 'bad' | '-'

interface Row {
  id: string
  label: Label
  duration: number
  scores: EvaluationResult['finalScores'] & { timing: number }
  unmeasured: string[]
  raw: ReturnType<typeof signalSummary> & { longest_monologue_s: number; rule_events: number }
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? '') : null
}
const root = process.cwd()
const sessionsDir = path.resolve(root, flag('--dir') ?? 'server/data/sessions')
const labelsFile = path.resolve(root, 'server/data/calibration-labels.json')
const labels: Record<string, Label> = fs.existsSync(labelsFile) ? JSON.parse(fs.readFileSync(labelsFile, 'utf8')) : {}

function score(id: string, label: Label, d: { samples: SampleX[]; phrases: Phrase[]; agentTurns: AgentTurn[]; duration: number; pitchEnd: number; slideTexts: string[]; claudeCoherency: number | null }): Row {
  const { ruleEvents } = replayLive(d)
  const content = null
  const ev = assembleEvaluation({ ...d, ruleEvents, segments: [], calibration: null, content })
  // Keep a previously judged coherency so re-scoring only reflects threshold changes.
  if (d.claudeCoherency !== null) ev.finalScores.coherency = Math.round(0.65 * d.claudeCoherency + 0.35 * ev.finalScores.coherency)
  return {
    id,
    label,
    duration: Math.round(d.duration),
    scores: { ...ev.finalScores, timing: ev.timingScore },
    unmeasured: ev.unmeasured,
    raw: { ...signalSummary(d.samples, d.phrases, 0, d.duration), longest_monologue_s: ev.timing.longestMonologueSec, rule_events: ruleEvents.length },
  }
}

const rows: Row[] = []

if (fs.existsSync(sessionsDir)) {
  for (const id of fs.readdirSync(sessionsDir)) {
    const file = path.join(sessionsDir, id, 'session.json')
    if (!fs.existsSync(file)) continue
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as SessionData
    const ev = s.evaluation
    const label: Label = labels[id] ?? (/\[good\]/i.test(s.title) ? 'good' : /\[bad\]/i.test(s.title) ? 'bad' : '-')
    rows.push(
      score(id, label, {
        samples: ev?.samples ?? [],
        phrases: ev?.transcript?.length ? ev.transcript : phrasesFromWords(s.words ?? []),
        agentTurns: ev?.agentTurns ?? [],
        duration: s.duration,
        pitchEnd: s.pitchEnd,
        slideTexts: (s.config?.slides ?? []).map((x) => x.text),
        claudeCoherency: s.report?.content?.coherency_score ?? null,
      }),
    )
  }
}

const fakeCount = Number(flag('--fake') ?? 0)
for (let i = 1; i <= fakeCount; i++) {
  const d = makeFakeData(i)
  rows.push(score(`fake-${i}`, '-', { ...d, slideTexts: [], claudeCoherency: null }))
}

if (!rows.length) {
  console.log(`No sessions found in ${sessionsDir}. Record some, or run with --fake 3.`)
  process.exit(0)
}

const pad = (v: unknown, n: number) => String(v ?? '–').slice(0, n).padEnd(n)
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '–' : Number(v.toFixed(d)))
console.log(
  [pad('session', 20), pad('label', 5), pad('dur', 5), pad('eye', 4), pad('body', 4), pad('tone', 4), pad('coh', 4), pad('time', 4), pad('ALL', 4), '|', pad('eyeShare', 8), pad('armsOpen', 8), pad('pitchSt', 7), pad('fillers', 7), pad('wpm', 4), pad('mono', 5), pad('rules', 5)].join(' '),
)
for (const r of rows) {
  const s = r.scores
  const un = (c: string, v: number) => (r.unmeasured.includes(c) ? 'n/a' : v)
  console.log(
    [
      pad(r.id, 20), pad(r.label, 5), pad(r.duration, 5), pad(un('eye', s.eye), 4), pad(un('body', s.body), 4), pad(un('tone', s.tone), 4), pad(un('coherency', s.coherency), 4), pad(s.timing, 4), pad(s.overall, 4), '|',
      pad(num(r.raw.eye_on_target_share), 8), pad(num(r.raw.arms_open_share), 8), pad(num(r.raw.pitch_variety_semitones, 1), 7), pad(r.raw.filler_words, 7), pad(r.raw.words_per_minute, 4), pad(r.raw.longest_monologue_s, 5), pad(r.raw.rule_events, 5),
    ].join(' '),
  )
}

const good = rows.filter((r) => r.label === 'good')
const bad = rows.filter((r) => r.label === 'bad')
if (good.length && bad.length) {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  console.log('\nSeparation (mean good − mean bad; want clearly positive):')
  for (const k of ['eye', 'body', 'tone', 'coherency', 'timing', 'overall'] as const) {
    const g = mean(good.map((r) => r.scores[k]))
    const b = mean(bad.map((r) => r.scores[k]))
    console.log(`  ${k.padEnd(10)} ${g.toFixed(0).padStart(4)} vs ${b.toFixed(0).padStart(4)}  Δ ${(g - b).toFixed(0)}`)
  }
  let ordered = 0
  for (const g of good) for (const b of bad) if (g.scores.overall > b.scores.overall) ordered++
  console.log(`  overall ranks good above bad in ${Math.round((ordered / (good.length * bad.length)) * 100)}% of pairs`)
} else {
  console.log(`\nLabel sessions as good or bad in ${path.relative(root, labelsFile)} to see separation.`)
}

const out = flag('--json')
if (out) {
  fs.writeFileSync(path.resolve(root, out), JSON.stringify(rows, null, 2))
  console.log(`Wrote ${out}`)
}
