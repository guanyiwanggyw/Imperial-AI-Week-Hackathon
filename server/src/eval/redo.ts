import { Router } from "express";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createFalClient } from "@fal-ai/client";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { env } from "../env.js";
import { errorMessage, fetchWithTimeout, safeId } from "../util.js";
import { SESSIONS_DIR } from "./audio.js";
import { anthropicClient } from "./judge.js";

/**
 * "See yourself do it better" (POST /api/eval/redo, server-sent events: `step`, then `result` or `error`).
 *  1. Claude rewrites the speaker's weakest passage: same meaning, clearer, no fillers, punctuation for pacing.
 *  2. ElevenLabs instant voice cloning makes a voice from the session's isolated audio (with the speaker's consent).
 *     The cloned voice is deleted straight after. Without consent, audio or ElevenLabs cloning, a stock voice is used.
 *  3. Eleven v3 speaks the improved passage in that voice.
 *  4. fal lip-syncs the audio onto a frame of the speaker's recording (MiniMax H3 Max lip sync), so they see
 *     themselves deliver it better.
 * Results are saved next to the session (redo-<n>.mp4/.mp3, redo.json) and listed by GET /api/eval/redo/:id.
 */
export const evalRedoRouter = Router();

const XI = "https://api.elevenlabs.io/v1";
const STOCK_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // ElevenLabs premade "George", used when cloning is not possible
const LIPSYNC_MODEL = process.env.EVAL_LIPSYNC_MODEL?.trim() || "minimax/h3-max/lip-sync/image-to-video";
const REWRITE_MODEL = process.env.EVAL_FINAL_MODEL?.trim() || "claude-sonnet-5-5";

const Rewrite = z.object({
  improved: z.string().describe("The improved passage, 25 to 45 words, in the speaker's own voice and meaning. Plain text."),
  spoken: z
    .string()
    .describe("The same passage formatted for speech: punctuation for pacing (commas, full stops, an ellipsis for a deliberate pause), no stage directions."),
  why: z.string().describe("One or two sentences on what changed and why it lands better."),
});

interface RedoResult {
  at: string;
  start: number;
  end: number;
  original: string;
  issue: string;
  improved: string;
  why: string;
  cloned: boolean;
  audioUrl: string;
  videoUrl: string | null;
  note: string | null;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function cloneVoice(dir: string, id: string): Promise<string | null> {
  if (!env.elevenLabsKey) return null;
  for (const name of ["voice.mp3", "voice.webm"]) {
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(dir, name));
    } catch {
      continue;
    }
    const form = new FormData();
    form.append("name", `Pitch practice ${id}`);
    form.append("description", "Temporary clone for a practice feedback clip; deleted after use.");
    form.append("remove_background_noise", name === "voice.mp3" ? "false" : "true");
    form.append("files", new Blob([new Uint8Array(data)], { type: name.endsWith(".mp3") ? "audio/mpeg" : "audio/webm" }), name);
    const res = await fetchWithTimeout(`${XI}/voices/add`, { method: "POST", headers: { "xi-api-key": env.elevenLabsKey }, body: form }, 60_000);
    if (!res.ok) throw new Error(`Voice cloning ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const out = (await res.json()) as { voice_id: string; requires_verification?: boolean };
    if (out.requires_verification) {
      await deleteVoice(out.voice_id);
      return null;
    }
    return out.voice_id;
  }
  return null;
}

async function deleteVoice(voiceId: string) {
  if (!env.elevenLabsKey) return;
  await fetchWithTimeout(`${XI}/voices/${voiceId}`, { method: "DELETE", headers: { "xi-api-key": env.elevenLabsKey } }, 15_000).catch(() => undefined);
}

async function speak(voiceId: string, text: string): Promise<Buffer> {
  const res = await fetchWithTimeout(
    `${XI}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    { method: "POST", headers: { "xi-api-key": env.elevenLabsKey!, "Content-Type": "application/json" }, body: JSON.stringify({ text, model_id: "eleven_v3" }) },
    90_000,
  );
  if (!res.ok) throw new Error(`Text to speech ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

evalRedoRouter.get("/redo/:id", async (req, res) => {
  res.json(await readJson<RedoResult[]>(path.join(SESSIONS_DIR, safeId(req.params.id), "redo.json"), []));
});

evalRedoRouter.post("/redo", async (req, res) => {
  const input = req.body as { sessionId: string; start: number; end: number; original: string; issue: string; context?: string; frame: string; consent: boolean };
  const id = safeId(String(input?.sessionId ?? ""));
  if (!id || !input.original?.trim() || !input.frame?.startsWith("data:image/")) return res.status(400).json({ error: "sessionId, original and frame are required" });
  if (!env.elevenLabsKey) return res.status(503).json({ error: "ElevenLabs is not configured" });
  const dir = path.join(SESSIONS_DIR, id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let voiceId: string | null = null;
  try {
    send("step", "Writing a stronger version of what you said");
    const response = await anthropicClient().beta.messages.parse(
      {
        model: REWRITE_MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system:
          "You are a pitch coach. Rewrite a passage the speaker said so it lands better when spoken aloud: keep their meaning, facts and voice (never invent numbers or claims), remove fillers and false starts, lead with the point, and keep sentences short. It will be spoken by a clone of their own voice, so write only words they would say: never add placeholders, brackets or notes to fill in. If a fact is missing, leave it out.",
        messages: [
          {
            role: "user",
            content: [
              `<what_they_said>\n${input.original.slice(0, 1500)}\n</what_they_said>`,
              `<what_to_improve>\n${(input.issue || "clarity and delivery").slice(0, 400)}\n</what_to_improve>`,
              input.context ? `<context>\n${input.context.slice(0, 1500)}\n</context>` : "",
            ].join("\n\n"),
          },
        ],
        output_config: { effort: "low", format: betaZodOutputFormat(Rewrite) },
      },
      { timeout: 60_000 },
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Could not write the improved version");
    // Never speak a placeholder such as "[insert figure]", even if the model adds one.
    const unbracket = (t: string) => t.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    const rewrite = { ...response.parsed_output, improved: unbracket(response.parsed_output.improved), spoken: unbracket(response.parsed_output.spoken) };

    let cloned = false;
    if (input.consent) {
      send("step", "Cloning your voice from this session");
      try {
        voiceId = await cloneVoice(dir, id);
        cloned = Boolean(voiceId);
      } catch (err) {
        console.warn("[eval] voice clone failed, using a stock voice:", errorMessage(err));
      }
    }

    send("step", cloned ? "Speaking it in your voice" : "Speaking it (stock voice)");
    const audio = await speak(voiceId ?? STOCK_VOICE, rewrite.spoken);
    if (voiceId) {
      await deleteVoice(voiceId);
      voiceId = null;
    }

    const existing = await readJson<RedoResult[]>(path.join(dir, "redo.json"), []);
    const n = existing.length + 1;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `redo-${n}.mp3`), audio);
    const result: RedoResult = {
      at: new Date().toISOString(),
      start: input.start,
      end: input.end,
      original: input.original,
      issue: input.issue,
      improved: rewrite.improved,
      why: rewrite.why,
      cloned,
      audioUrl: `/media/sessions/${id}/redo-${n}.mp3`,
      videoUrl: null,
      note: null,
    };

    if (env.falKey) {
      send("step", "Lip-syncing it onto your face (about a minute)");
      try {
        const fal = createFalClient({ credentials: env.falKey });
        const [, meta, b64] = input.frame.match(/^data:(image\/[a-z]+);base64,(.+)$/) ?? [];
        const imageUrl = await fal.storage.upload(new Blob([new Uint8Array(Buffer.from(b64, "base64"))], { type: meta || "image/jpeg" }));
        const audioUrl = await fal.storage.upload(new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }));
        const out = (await fal.subscribe(LIPSYNC_MODEL, { input: { image_url: imageUrl, audio_url: audioUrl, resolution: "480P" } })) as { data: { video?: { url: string } } };
        const url = out.data.video?.url;
        if (!url) throw new Error("No video returned");
        const video = await fetchWithTimeout(url, {}, 120_000);
        await fs.writeFile(path.join(dir, `redo-${n}.mp4`), Buffer.from(await video.arrayBuffer()));
        result.videoUrl = `/media/sessions/${id}/redo-${n}.mp4`;
      } catch (err) {
        result.note = `The lip-synced video could not be made (${errorMessage(err).slice(0, 120)}), so here is the audio.`;
      }
    } else {
      result.note = "fal is not configured (add FAL_KEY to .env and restart the server), so here is the audio only.";
    }

    await fs.writeFile(path.join(dir, "redo.json"), JSON.stringify([...existing, result]));
    send("result", result);
  } catch (err) {
    send("error", { error: errorMessage(err) });
  } finally {
    if (voiceId) await deleteVoice(voiceId);
    res.end();
  }
});
