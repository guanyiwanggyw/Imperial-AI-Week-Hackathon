import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "./env.js";
import { errorMessage } from "./util.js";

/**
 * Background drafts for the interactive panel (build brief: "Background drafts ... one batched call
 * (Groq or Haiku). The LLM is never on the critical path").
 *
 * POST /api/agents/drafts → for every agent, the next line it would say in each situation:
 *   question     a new in-character question about something specific the speaker said
 *   follow_up    a follow-up on the speaker's latest answer (to this agent's own last question)
 *   comment      a short human reaction, not a question
 *   interjection a polite cut-in while the speaker is still talking (for interrupters)
 * The browser refreshes these after each transcript commit and speaks them instantly when the
 * floor manager gives an agent the floor.
 */
export const agentsRouter = Router();

function client() {
  if (!env.anthropicKey) throw new Error("Anthropic is not configured");
  // Keys that are not scoped to a workspace must name one (same as llm.ts / eval/judge.ts).
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: env.anthropicKey,
    timeout: 15_000,
    maxRetries: 0, // a late draft is useless; the client keeps its previous or fallback lines
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
}

const line = (what: string) =>
  z.string().describe(`${what} Spoken aloud like a real person in a meeting: contractions, plain words, under 22 words, no stage directions.`);

const DraftsSchema = z.object({
  drafts: z.array(
    z.object({
      persona_id: z.string(),
      question: line("A question that picks up something specific from the speaker's latest words (quote or paraphrase it), or a gap they left."),
      follow_up: line('A follow-up that first reacts to the speaker\'s latest answer ("Okay, three clinics.") and then presses on it.'),
      comment: line("A short reaction to exactly what was just said, using their words: agreement, doubt or interest. Not a question."),
      interjection: line('A polite cut-in that names what they just said: "Sorry to jump in, you said X, but...?"'),
      reply: line(
        "If the speaker asked this panelist or the panel something, a direct, honest, in-character answer to it. Otherwise a natural reaction to their latest words.",
      ),
    }),
  ),
});

interface AgentIn {
  id: string;
  name: string;
  role: string;
  personality: string;
  focus: string[];
  strictness: number;
}

agentsRouter.post("/drafts", async (req, res) => {
  const { personas, transcript, conversation, latest, context } = req.body as {
    personas: AgentIn[];
    /** Recent speaker transcript, timestamped */
    transcript: string;
    /** Recent turns: who said what (agent names or "Speaker") */
    conversation: { who: string; text: string }[];
    /** What the speaker said since the last panel line: every line should respond to this. */
    latest?: string;
    context?: string;
  };
  if (!Array.isArray(personas) || !personas.length) return res.status(400).json({ error: "personas are required" });

  const system = [
    "You voice a live panel listening to someone pitch. The panel interacts like real people in a meeting.",
    "For every panelist, draft the next line they would say in each situation (question, follow_up, comment, interjection, reply).",
    "Stay in character: personality, focus areas and strictness (1 = easy to impress, 5 = very hard).",
    "Respond to what the speaker actually said, especially their latest words: quote or paraphrase them, react before you ask, and never ask something they just answered. Never invent facts about their business.",
    "Sound like real people talking, not interviewers reading a list: contractions, plain words, an occasional short reaction (\"Okay.\", \"Hm, right.\", \"Oh, interesting.\"), no corporate filler and no \"Great question\".",
    "Panelists are aware of each other: never repeat what another panelist asked, and sometimes build on one by name (\"Building on Priya's point, ...\").",
    "If the speaker asked a question or addressed a panelist by name, that panelist's reply must answer it directly and in character.",
    "Keep every line under 22 words, one sentence or two short ones.",
  ].join("\n");
  const user = [
    `<panel>\n${JSON.stringify(personas.map(({ id, name, role, personality, focus, strictness }) => ({ id, name, role, personality, focus, strictness })))}\n</panel>`,
    `<conversation>\n${(conversation ?? []).slice(-14).map((c) => `${c.who}: ${c.text}`).join("\n") || "(nobody has spoken yet)"}\n</conversation>`,
    `<latest_from_speaker>\n${latest?.trim() || "(nothing new since the last panel line)"}\n</latest_from_speaker>`,
    `<transcript>\n${(transcript || "(the speaker has said very little so far)").slice(-6000)}\n</transcript>`,
    context ? `<context>\n${context.slice(0, 3000)}\n</context>` : "",
    `Return one entry per panelist, using these persona_id values: ${personas.map((p) => p.id).join(", ")}.`,
  ].join("\n\n");

  try {
    const response = await client().beta.messages.parse({
      model: env.agentsModel,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
      // Latency-sensitive drafting: low effort.
      output_config: { effort: "low", format: betaZodOutputFormat(DraftsSchema) },
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined this request");
    if (!response.parsed_output) throw new Error(`No structured output (stop reason: ${response.stop_reason})`);
    res.json(response.parsed_output);
  } catch (err) {
    res.status(err instanceof Error && err.message === "Anthropic is not configured" ? 503 : 502).json({ error: errorMessage(err) });
  }
});
