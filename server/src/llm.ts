import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "./env.js";
import { errorMessage } from "./util.js";

/**
 * /questions: opening questions per panelist, grounded in transcript, slides and context.
 * Uses structured outputs validated with zod, so callers always get a well-formed object
 * or an error (the client then shows its fallback).
 * The evaluation (content judge) moved to src/eval/judge.ts, mounted at /api/eval.
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
