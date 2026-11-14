import { Router } from "express";
import multer from "multer";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { env } from "./env.js";
import { errorMessage, fetchWithTimeout, withTimeout } from "./util.js";

export const voiceRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

/** Single-use token so the browser can stream to ElevenLabs Scribe realtime without seeing our key. */
voiceRouter.get("/scribe-token", async (_req, res) => {
  if (!env.elevenLabsKey) return res.status(503).json({ error: "ElevenLabs is not configured" });
  try {
    const client = new ElevenLabsClient({ apiKey: env.elevenLabsKey });
    const { token } = await withTimeout(client.tokens.singleUse.create("realtime_scribe"), 8000, "Scribe token");
    res.json({ token });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

/**
 * Accurate transcript of the session audio after it ends (ElevenLabs batch speech to text, word timestamps).
 * The live transcript is approximate; the report is built from this one.
 */
voiceRouter.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!env.elevenLabsKey) return res.status(503).json({ error: "ElevenLabs is not configured" });
  if (!req.file) return res.status(400).json({ error: "No audio uploaded" });
  try {
    const form = new FormData();
    form.append("model_id", "scribe_v2");
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    form.append("file", new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), "session.webm");
    const response = await fetchWithTimeout(
      "https://api.elevenlabs.io/v1/speech-to-text",
      { method: "POST", headers: { "xi-api-key": env.elevenLabsKey }, body: form },
      120_000,
    );
    if (!response.ok) return res.status(502).json({ error: `ElevenLabs ${response.status}: ${await response.text()}` });
    const data = (await response.json()) as { words?: { text: string; start: number | null; end: number | null; type: string }[] };
    const words = (data.words ?? [])
      .filter((w) => w.type === "word" && w.start !== null && w.end !== null)
      .map((w) => ({ text: w.text, start: w.start as number, end: w.end as number }));
    res.json({ words });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

/** Signed URL for a voice-only ElevenLabs conversation (used when Anam is not configured). */
voiceRouter.get("/signed-url", async (_req, res) => {
  if (!env.elevenLabsKey || !env.elevenLabsAgentId) return res.status(503).json({ error: "The ElevenLabs agent is not configured" });
  try {
    const response = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(env.elevenLabsAgentId)}`,
      { headers: { "xi-api-key": env.elevenLabsKey } },
      8000,
    );
    if (!response.ok) return res.status(502).json({ error: `ElevenLabs ${response.status}: ${await response.text()}` });
    const { signed_url: signedUrl } = (await response.json()) as { signed_url: string };
    res.json({ signedUrl });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});
