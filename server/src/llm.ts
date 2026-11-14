import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "./env.js";
import { errorMessage } from "./util.js";

/**
 * Two Claude calls:
 *  - /questions: opening questions per panelist, grounded in transcript, slides and context.
 *  - /evaluate: the content layer of the evaluation (rubric with justifications tied to moments).
 * Both use structured outputs validated with zod, so callers always get a well-formed object
 * or an error (the client then shows its fallback).
 */
export const llmRouter = Router();

function client() {
  if (!env.anthropicKey) throw new Error("Anthropic is not configured");
  return new Anthropic({ apiKey: env.anthropicKey, timeout: 100_000, maxRetries: 1 });
}

async function structured<T extends z.ZodType>(schema: T, system: string, user: string, effort: "low" | "medium", timeoutMs: number) {
  const response = await client().beta.messages.parse(
    {
      model: env.anthropicModel,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
    },
    { timeout: timeoutMs },
  );
  if (response.stop_reason === "refusal") throw new Error("The model declined this request");
  if (!response.parsed_output) throw new Error(`No structured output (stop reason: ${response.stop_reason})`);
  return response.parsed_output as z.infer<T>;
}

// ---------- questions ----------

const QuestionsSchema = z.object({
  questions: z.array(
    z.object({
      persona_id: z.string(),
      question: z.string().describe("One spoken question, under 35 words, natural and direct."),
      references: z.string().describe("Which slide number or claim this question is about."),
    }),
  ),
});

llmRouter.post("/questions", async (req, res) => {
  const { personas, count, transcript, slides, context } = req.body as {
    personas: { id: string; name: string; role: string; personality: string; focus: string[]; strictness: number }[];
    count: number;
    transcript: string;
    slides: { index: number; text: string }[];
    context: string;
  };
  if (!Array.isArray(personas) || !personas.length || !Array.isArray(slides)) {
    return res.status(400).json({ error: "personas and slides are required" });
  }
  const system =
    "You write the opening questions a pitch audience asks after a short pitch. Each question must reference something specific the speaker said or showed (a claim, number, slide or gap). Distribute questions across panelists in the order given, round-robin, and match each panelist's personality and focus areas. Questions must not overlap. Strictness is 1 (easy to impress) to 5 (very hard).";
  const user = [
    `Write exactly ${count} questions.`,
    `<panel>\n${JSON.stringify(personas, null, 1)}\n</panel>`,
    `<transcript>\n${transcript || "(the speaker said very little)"}\n</transcript>`,
    `<slides>\n${slides.map((s) => `Slide ${s.index + 1}: ${s.text.slice(0, 800)}`).join("\n") || "(no slides)"}\n</slides>`,
    context ? `<context>\n${context.slice(0, 4000)}\n</context>` : "",
  ].join("\n\n");
  try {
    res.json(await structured(QuestionsSchema, system, user, "low", 30_000));
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

// ---------- evaluation ----------

const Dimension = z.object({
  score: z.number().describe("0 to 10"),
  justification: z.string().describe("Two sentences at most, specific to this pitch."),
  evidence_time_sec: z.number().nullable().describe("Seconds from session start of the moment that best supports the score, or null."),
});

const EvaluationSchema = z.object({
  summary: z.string().describe("Two sentences: the overall verdict and the single biggest reason."),
  dimensions: z.object({
    overall_pitch: Dimension.describe("Problem, solution, ask, and the order they come in."),
    clarity: Dimension,
    depth: Dimension.describe("Market, risks, alternatives, evidence."),
    qna: Dimension.describe("Directness, consistency, holding up to follow-ups."),
    composure: Dimension.describe("Composure under questioning."),
  }),
  qna_feedback: z.array(
    z.object({ question_index: z.number(), score: z.number().describe("0 to 10"), feedback: z.string().describe("One or two sentences.") }),
  ),
  priorities: z
    .array(z.object({ title: z.string().describe("Five words or fewer."), detail: z.string(), evidence_time_sec: z.number().nullable() }))
    .describe("One to three priorities, most important first."),
  best_moment_note: z.string().describe("Why the best moment worked, one or two sentences."),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

llmRouter.post("/evaluate", async (req, res) => {
  const input = req.body as {
    context: string;
    durationSec: number;
    slides: { index: number; text: string }[];
    transcript: string;
    delivery: Record<string, unknown>;
    qna: { persona: string; question: string; answer: string; agentScore?: number | null; agentNote?: string | null }[];
    bestMoment: { start: number; end: number; text: string } | null;
  };
  if (!input || !Array.isArray(input.slides) || !Array.isArray(input.qna)) {
    return res.status(400).json({ error: "slides and qna are required" });
  }
  const system = [
    "You are an experienced pitch coach scoring a practice session. Score the content layer only: delivery metrics are measured separately and are given to you as context, not for you to re-score.",
    "Be honest and specific. Point each justification at a moment using evidence_time_sec (seconds from session start, taken from the transcript timestamps).",
    "Scores: 0-3 weak, 4-6 adequate, 7-8 strong, 9-10 exceptional. If there was no Q&A, score qna and composure from what little evidence exists and say so.",
    "Write in plain sentence case, no exclamation marks.",
  ].join("\n");
  const user = [
    `Session length: ${Math.round(input.durationSec)} s.`,
    input.context ? `<context>\n${input.context.slice(0, 4000)}\n</context>` : "",
    `<slides>\n${input.slides.map((s) => `Slide ${s.index + 1}: ${s.text.slice(0, 800)}`).join("\n") || "(no slides)"}\n</slides>`,
    `<pitch_transcript>\n${input.transcript || "(empty)"}\n</pitch_transcript>`,
    `<delivery_metrics>\n${JSON.stringify(input.delivery)}\n</delivery_metrics>`,
    `<qna>\n${input.qna.map((q, i) => `Q${i} (${q.persona}): ${q.question}\nA: ${q.answer || "(no answer captured)"}${q.agentNote ? `\nPanelist note: ${q.agentNote}` : ""}`).join("\n\n") || "(no Q&A)"}\n</qna>`,
    input.bestMoment ? `<best_moment_candidate start="${input.bestMoment.start}" end="${input.bestMoment.end}">\n${input.bestMoment.text}\n</best_moment_candidate>` : "",
  ].join("\n\n");
  try {
    const result = await structured(EvaluationSchema, system, user, "medium", 95_000);
    for (const d of Object.values(result.dimensions)) d.score = clamp(d.score, 0, 10);
    for (const q of result.qna_feedback) q.score = clamp(q.score, 0, 10);
    result.priorities = result.priorities.slice(0, 3);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});
