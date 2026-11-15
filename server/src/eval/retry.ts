import { Router } from "express";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { env } from "../env.js";
import { errorMessage, fetchWithTimeout, safeId } from "../util.js";
import { SESSIONS_DIR } from "./audio.js";
import { anthropicClient } from "./judge.js";

/**
 * "Try that answer again": the speaker re-answers their weakest question (or re-says their weakest passage) and sees
 * the change.
 *  - POST /api/eval/retry/say: the panelist asks the question in their own ElevenLabs voice (fast Flash model).
 *  - POST /api/eval/retry: Claude scores the original and the retry blind, in random order as "A" and "B" so it
 *    cannot favour the newer one, then the attempt (with the browser's measured delivery numbers) is saved to
 *    retries.json next to the session.
 *  - GET /api/eval/retry/:id lists the saved attempts.
 */
export const evalRetryRouter = Router();

const XI = "https://api.elevenlabs.io/v1";
const STOCK_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const RETRY_MODEL = process.env.EVAL_FINAL_MODEL?.trim() || "claude-sonnet-5-5";

const RUBRIC = `You are an experienced pitch coach. You compare two attempts by the same speaker at the same moment of a practice pitch: either an answer to a panel question, or a passage of the pitch said again. Transcripts are verbatim speech, so fillers and false starts are visible.

Score each attempt 0-100 for CLARITY AND SUBSTANCE, independently, against this rubric:
- Answers the question (for a question): the first sentence addresses what was asked. Dodging, or answering a different question, caps the score at 40.
- Leads with the point (for a passage): the main claim comes first, not after a long build-up.
- Specific: concrete facts, numbers with context, named customers or examples, rather than vague claims.
- Structured and concise: point, then support, then a tie back. No rambling, repetition or trailing off.
- Clean wording: few fillers ("um", "like", "you know"), few false starts.

Anchors (interpolate between them):
- 20: does not address the question, vague, rambling. Example: "Um, so, yeah, it's, like, a really big market and everyone kind of needs it, so I think we'll be fine."
- 60: relevant and partly specific, but the point is buried or the support is thin. Example: "We have some pilot clinics and they like it. It saves them time. We think pricing will be around a subscription."
- 100: direct, specific and tight. Example: "Nine clinics pay us 300 pounds a month. We found them through two practice-management resellers, and three more signed from referrals."

An empty or near-empty attempt scores at most 10. Do not reward length for its own sake. Never assume an attempt is better because of its label or position. Write notes and strengths addressed to the speaker as "you", in plain sentence case, under 20 words each.`;

const Side = z.object({
  score: z.number().describe("0-100 for this attempt"),
  note: z.string().describe("One sentence on this attempt."),
  strengths: z.array(z.string()).describe("0 to 3 things this attempt does better than the other one. Empty if none."),
  fix: z.string().describe("The single most useful change for this attempt's next try."),
});
const Pair = z.object({ a: Side, b: Side });

interface Metrics {
  [k: string]: number | null;
}
interface RetryBody {
  sessionId: string;
  target: { id: string; kind: "question" | "passage"; title: string; prompt: string; issue?: string };
  before: { text: string; metrics: Metrics };
  after: { text: string; metrics: Metrics };
  context?: string;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

evalRetryRouter.post("/retry/say", async (req, res) => {
  const { text, voiceId } = (req.body ?? {}) as { text?: string; voiceId?: string };
  if (!env.elevenLabsKey) return res.status(503).json({ error: "ElevenLabs is not configured" });
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });
  const voice = voiceId && /^[A-Za-z0-9]{10,40}$/.test(voiceId) ? voiceId : STOCK_VOICE;
  try {
    const r = await fetchWithTimeout(
      `${XI}/text-to-speech/${voice}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": env.elevenLabsKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 600), model_id: "eleven_flash_v2_5" }),
      },
      30_000,
    );
    if (!r.ok) return res.status(502).json({ error: `Text to speech ${r.status}: ${(await r.text()).slice(0, 200)}` });
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

evalRetryRouter.get("/retry/:id", async (req, res) => {
  res.json(await readJson<unknown[]>(path.join(SESSIONS_DIR, safeId(req.params.id), "retries.json"), []));
});

evalRetryRouter.post("/retry", async (req, res) => {
  const input = req.body as RetryBody;
  const id = safeId(String(input?.sessionId ?? ""));
  if (!id || !input.target?.id || !input.after?.text?.trim()) return res.status(400).json({ error: "sessionId, target and after.text are required" });

  let judgement: { before: { score: number; note: string }; after: { score: number; note: string }; better: string[]; next: string } | null = null;
  let judgeError: string | null = null;
  if (!env.anthropicKey) judgeError = "Claude is not configured";
  else {
    // Blind: the original is "A" or "B" at random.
    const flip = Math.random() < 0.5;
    const [a, b] = flip ? [input.after, input.before] : [input.before, input.after];
    const what = input.target.kind === "question" ? `<question>\n${input.target.prompt.slice(0, 800)}\n</question>` : "<task>\nThe speaker said this passage of their pitch.\n</task>";
    try {
      const response = await anthropicClient().beta.messages.parse(
        {
          model: RETRY_MODEL,
          max_tokens: 3000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: [
                input.context ? `<pitch_context>\n${input.context.slice(0, 1500)}\n</pitch_context>` : "",
                what,
                `<attempt_a>\n${a.text.trim().slice(0, 2500) || "(nothing was said)"}\n</attempt_a>`,
                `<attempt_b>\n${b.text.trim().slice(0, 2500) || "(nothing was said)"}\n</attempt_b>`,
                "Score both attempts independently against the rubric, then compare them.",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          output_config: { effort: "low", format: betaZodOutputFormat(Pair) },
        },
        { timeout: 45_000 },
      );
      if (response.stop_reason === "refusal") throw new Error("The model declined this request");
      const out = response.parsed_output;
      if (!out) throw new Error(`No structured output (stop reason: ${response.stop_reason})`);
      const [before, after] = flip ? [out.b, out.a] : [out.a, out.b];
      const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)));
      judgement = {
        before: { score: clamp(before.score), note: before.note },
        after: { score: clamp(after.score), note: after.note },
        better: after.strengths.slice(0, 3),
        next: after.fix,
      };
    } catch (err) {
      judgeError = errorMessage(err);
    }
  }

  const attempt = {
    at: new Date().toISOString(),
    targetId: String(input.target.id).slice(0, 20),
    title: String(input.target.title).slice(0, 120),
    prompt: String(input.target.prompt).slice(0, 800),
    before: { text: String(input.before?.text ?? "").slice(0, 4000), metrics: input.before?.metrics ?? {} },
    after: { text: String(input.after.text).slice(0, 4000), metrics: input.after.metrics ?? {} },
    judgement,
    judgeError,
  };
  try {
    const dir = path.join(SESSIONS_DIR, id);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "retries.json");
    const existing = await readJson<unknown[]>(file, []);
    await fs.writeFile(file, JSON.stringify([...existing, attempt]));
  } catch {
    // Saving is best effort; the attempt is still returned.
  }
  res.json(attempt);
});
