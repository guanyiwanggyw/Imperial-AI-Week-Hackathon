import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "../env.js";
import { errorMessage } from "../util.js";

/**
 * Claude judge for the evaluation engine, done incrementally (build brief §1):
 *  - POST /api/eval/segment: after each Q&A exchange or every ~45 s, the client sends that chunk in the background.
 *    A fast model returns timestamped notes and a coherency score for the chunk.
 *  - POST /api/eval/final: at session end, one streamed call merges the segment notes into the top 3 tips,
 *    5–8 key moments and the content rubric. Server-sent events: `delta` (raw JSON text), then `result` or `error`.
 *
 * Both calls use structured outputs (zod), and the rubric is a fixed system block with prompt caching.
 * Note: current models reject non-default temperature, so "temperature 0" from the brief is not sent;
 * the schema plus the anchored rubric keep results stable.
 */
export const evalRouter = Router();

const SEGMENT_MODEL = process.env.EVAL_SEGMENT_MODEL?.trim() || "claude-haiku-5-5";
const FINAL_MODEL = process.env.EVAL_FINAL_MODEL?.trim() || "claude-sonnet-5-5";

export function anthropicClient() {
  if (!env.anthropicKey) throw new Error("Anthropic is not configured");
  // Keys that are not scoped to a workspace must name one with this header (ANTHROPIC_WORKSPACE_ID in .env).
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: env.anthropicKey,
    timeout: 100_000,
    maxRetries: 1,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
}

// Fixed rubric: identical bytes on every request so it is cached (render order: system before messages).
const RUBRIC = `You are an experienced pitch coach reviewing a practice session in which a speaker pitches to an AI panel that may interrupt and ask questions.

Delivery signals (eye contact, posture, gestures, pitch variety, pace, fillers, timing) are measured by software and given to you as numbers and rule events. Do not re-score them from the transcript; use them as context and to point at moments. Claude cannot hear the audio, so tone arrives only as numbers.

You judge COHERENCY and CONTENT:
- Structure: problem -> customer -> solution -> proof (evidence, traction) -> ask, in a sensible order.
- Answering: did each answer address the question that was asked? (0 = dodged, 1 = partly, 2 = directly), and did the speaker bridge back to the pitch?
- Clarity: short concrete sentences, defined terms, numbers with context, no rambling.

Scores are 0-100, anchored to a 1/3/5 rubric:
- 20 (level 1): no clear structure; claims without evidence; answers miss the question. Example: "So we basically, um, do AI for, like, everything, and it's huge, everyone needs it."
- 60 (level 3): the main parts are present but out of order or thin; some numbers lack context; answers are relevant but wander. Example: "We help small clinics book appointments. It saves time. We have some pilots. We're raising money."
- 100 (level 5): crisp problem, specific customer, clear solution, concrete proof, explicit ask; answers are direct and tie back. Example: "Independent clinics lose 12% of revenue to no-shows. Our SMS agent cut no-shows by 40% across 9 paying clinics. We're raising 1.5 million to reach 300 clinics."
Interpolate between anchors.

Notes and moments:
- Each note has t (seconds since recording start, from the transcript timestamps), optional end, a category (eye, body, tone, coherency, timing, panel), a severity (good, warn, bad) and a message under 20 words, addressed to the speaker as "you", specific to what happened.
- Include good moments as well as problems.
- Write in plain sentence case, no exclamation marks.`;

// ---------- segment ----------

const Note = z.object({
  t: z.number(),
  end: z.number().nullable(),
  cat: z.enum(["eye", "body", "tone", "coherency", "timing", "panel"]),
  severity: z.enum(["good", "warn", "bad"]),
  msg: z.string(),
});

const SegmentSchema = z.object({
  coherency: z.number().nullable().describe("0-100 for this chunk, or null if the speaker said too little to judge."),
  notes: z.array(Note).describe("0 to 4 notes for this chunk."),
  summary: z.string().describe("One sentence on this chunk."),
});

const cleanNote = (n: z.infer<typeof Note>, lo: number, hi: number) => ({
  t: clamp(n.t, lo, hi),
  ...(n.end !== null ? { end: clamp(n.end, lo, hi) } : {}),
  cat: n.cat,
  severity: n.severity,
  // Models occasionally leave a stray bracket or quote at the end of a string.
  msg: n.msg.replace(/^[\s"'`\[\]{}]+|[\s"'`\[\]{}]+$/g, ""),
});

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

evalRouter.post("/segment", async (req, res) => {
  const input = req.body as {
    from: number;
    to: number;
    phase: string;
    context?: string;
    transcript: string;
    agentTurns: string;
    signals: Record<string, unknown>;
    ruleEvents: string[];
  };
  if (!input || typeof input.from !== "number" || typeof input.to !== "number") return res.status(400).json({ error: "from and to are required" });
  const user = [
    `Chunk ${input.from.toFixed(1)}s to ${input.to.toFixed(1)}s of the session (${input.phase}).`,
    input.context ? `<context>\n${String(input.context).slice(0, 2000)}\n</context>` : "",
    `<speaker_transcript>\n${input.transcript || "(nothing transcribed)"}\n</speaker_transcript>`,
    `<panel_lines>\n${input.agentTurns || "(none)"}\n</panel_lines>`,
    `<measured_signals>\n${JSON.stringify(input.signals)}\n</measured_signals>`,
    `<rule_events>\n${input.ruleEvents?.join("\n") || "(none)"}\n</rule_events>`,
    "Return notes only for times inside this chunk.",
    "If measured_signals lists gestures, check each against what the speaker was saying at that time. Flag a gesture that contradicts the words (for example a thumbs-up while describing a problem) as a body note.",
  ].join("\n\n");
  try {
    const response = await anthropicClient().beta.messages.parse(
      {
        model: SEGMENT_MODEL,
        max_tokens: 4000,
        system: [{ type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: betaZodOutputFormat(SegmentSchema) },
      },
      { timeout: 30_000 },
    );
    if (response.stop_reason === "refusal") throw new Error("The model declined this request");
    const out = response.parsed_output;
    if (!out) throw new Error(`No structured output (stop reason: ${response.stop_reason})`);
    res.json({
      from: input.from,
      to: input.to,
      coherency: out.coherency === null ? null : clamp(out.coherency, 0, 100),
      notes: out.notes.slice(0, 4).map((n) => cleanNote(n, input.from, input.to)),
      summary: out.summary,
    });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

// ---------- final ----------

const Dimension = z.object({
  score: z.number().describe("0 to 100"),
  justification: z.string().describe("Two sentences at most, specific to this pitch."),
  evidence_time_sec: z.number().nullable().describe("Seconds from session start of the moment that best supports the score, or null."),
});

const FinalSchema = z.object({
  summary: z.string().describe("Two sentences: the overall verdict and the single biggest reason."),
  priorities: z
    .array(z.object({ title: z.string().describe("Five words or fewer."), detail: z.string().describe("One concrete instruction."), evidence_time_sec: z.number().nullable() }))
    .describe("The top 3 tips, most important first."),
  key_moments: z.array(Note).describe("5 to 8 key moments across the whole session, including good ones."),
  coherency_score: z.number().describe("0-100 overall coherency (structure, answering the question, clarity)."),
  dimensions: z.object({
    overall_pitch: Dimension.describe("Problem, solution, ask, and the order they come in."),
    clarity: Dimension,
    depth: Dimension.describe("Market, risks, alternatives, evidence."),
    qna: Dimension.describe("Directness, consistency, holding up to follow-ups."),
    composure: Dimension.describe("Composure under questioning and interruption."),
  }),
  qna_feedback: z.array(z.object({ question_index: z.number(), score: z.number().describe("0 to 100"), feedback: z.string().describe("One or two sentences.") })),
  best_moment_note: z.string().describe("Why the best moment worked, one or two sentences."),
});

evalRouter.post("/final", async (req, res) => {
  const input = req.body as {
    durationSec: number;
    context?: string;
    slides?: { index: number; text: string }[];
    transcript: string;
    qna: { persona: string; question: string; answer: string; agentNote?: string | null }[];
    segments: { from: number; to: number; coherency: number | null; summary: string; notes: unknown[] }[];
    measured: Record<string, unknown>;
    ruleEvents: string[];
    bestMoment: { start: number; end: number; text: string } | null;
  };
  if (!input || typeof input.transcript !== "string") return res.status(400).json({ error: "transcript is required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const user = [
    `Session length: ${Math.round(input.durationSec)} s.`,
    input.context ? `<context>\n${String(input.context).slice(0, 4000)}\n</context>` : "",
    input.slides?.length ? `<slides>\n${input.slides.map((s) => `Slide ${s.index + 1}: ${s.text.slice(0, 800)}`).join("\n")}\n</slides>` : "",
    `<transcript>\n${input.transcript || "(empty)"}\n</transcript>`,
    `<qna>\n${input.qna?.map((q, i) => `Q${i} (${q.persona}): ${q.question}\nA: ${q.answer || "(no answer captured)"}${q.agentNote ? `\nPanelist note: ${q.agentNote}` : ""}`).join("\n\n") || "(no Q&A)"}\n</qna>`,
    `<segment_notes>\n${JSON.stringify(input.segments ?? [])}\n</segment_notes>`,
    `<measured_scores_and_stats>\n${JSON.stringify(input.measured ?? {})}\n</measured_scores_and_stats>`,
    `<rule_events>\n${input.ruleEvents?.join("\n") || "(none)"}\n</rule_events>`,
    input.bestMoment ? `<best_moment_candidate start="${input.bestMoment.start}" end="${input.bestMoment.end}">\n${input.bestMoment.text}\n</best_moment_candidate>` : "",
    "Merge the segment notes into the final judgement. If there was no Q&A, score qna and composure from what little evidence exists and say so.",
    "measured_scores_and_stats.gestures lists hand gestures with times: if one contradicts what was being said at that moment (for example a thumbs-up while describing a problem), include it as a body key moment.",
  ].join("\n\n");

  try {
    const stream = anthropicClient().beta.messages.stream(
      {
        model: FINAL_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        output_config: { effort: "medium", format: betaZodOutputFormat(FinalSchema) },
      },
      { timeout: 95_000 },
    );
    stream.on("text", (delta) => send("delta", delta));
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("The model declined this request");
    const out = message.parsed_output;
    if (!out) throw new Error(`No structured output (stop reason: ${message.stop_reason})`);
    const end = Math.max(1, input.durationSec);
    for (const d of Object.values(out.dimensions)) d.score = clamp(d.score, 0, 100);
    for (const q of out.qna_feedback) q.score = clamp(q.score, 0, 100);
    send("result", {
      ...out,
      coherency_score: clamp(out.coherency_score, 0, 100),
      priorities: out.priorities.slice(0, 3),
      key_moments: out.key_moments.slice(0, 8).map((n) => cleanNote(n, 0, end)),
    });
  } catch (err) {
    send("error", { error: errorMessage(err) });
  } finally {
    res.end();
  }
});
