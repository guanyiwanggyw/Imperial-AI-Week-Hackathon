import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, env } from "../env.js";
import { errorMessage, fetchWithTimeout, safeId } from "../util.js";

/**
 * POST /api/eval/transcribe: the accurate post-session transcript for the evaluation.
 *  1. ElevenLabs Audio Isolation strips room noise and background chatter from the session audio.
 *  2. Scribe v2 transcribes the cleaned audio with word timestamps and speaker diarization, so the evaluation can keep
 *     only the speaker's own words (the panel's voices and other people get their own speaker ids).
 * The isolated voice is saved next to the session (voice.mp3) for the "do it better" voice clone.
 * If isolation fails, the original audio is transcribed instead.
 */
export const evalAudioRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

const XI = "https://api.elevenlabs.io/v1";

export async function isolateVoice(audio: Buffer, mime: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!env.elevenLabsKey) return null;
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(audio)], { type: mime || "audio/webm" }), "session.webm");
  const res = await fetchWithTimeout(`${XI}/audio-isolation`, { method: "POST", headers: { "xi-api-key": env.elevenLabsKey }, body: form }, 120_000);
  if (!res.ok) throw new Error(`Audio isolation ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") || "audio/mpeg" };
}

evalAudioRouter.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!env.elevenLabsKey) return res.status(503).json({ error: "ElevenLabs is not configured" });
  if (!req.file) return res.status(400).json({ error: "No audio uploaded" });
  const id = safeId(String(req.body.sessionId ?? ""));
  let audio = { data: req.file.buffer, mime: req.file.mimetype };
  let isolated = false;
  try {
    const clean = await isolateVoice(req.file.buffer, req.file.mimetype);
    if (clean && clean.data.length > 1000) {
      audio = clean;
      isolated = true;
      if (id) {
        const dir = path.join(SESSIONS_DIR, id);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "voice.mp3"), clean.data);
      }
    }
  } catch (err) {
    console.warn("[eval] voice isolation failed, transcribing the original audio:", errorMessage(err));
  }
  if (!isolated && id) {
    // Keep the raw audio for the voice clone anyway.
    const dir = path.join(SESSIONS_DIR, id);
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    await fs.writeFile(path.join(dir, "voice.webm"), req.file.buffer).catch(() => undefined);
  }
  try {
    const form = new FormData();
    form.append("model_id", "scribe_v2");
    form.append("timestamps_granularity", "word");
    form.append("diarize", "true");
    form.append("tag_audio_events", "false");
    form.append("file", new Blob([new Uint8Array(audio.data)], { type: audio.mime }), isolated ? "voice.mp3" : "session.webm");
    const response = await fetchWithTimeout(`${XI}/speech-to-text`, { method: "POST", headers: { "xi-api-key": env.elevenLabsKey }, body: form }, 150_000);
    if (!response.ok) return res.status(502).json({ error: `ElevenLabs ${response.status}: ${await response.text()}` });
    const data = (await response.json()) as { words?: { text: string; start: number | null; end: number | null; type: string; speaker_id?: string | null }[] };
    const words = (data.words ?? [])
      .filter((w) => w.type === "word" && w.start !== null && w.end !== null)
      .map((w) => ({ text: w.text, start: w.start as number, end: w.end as number, ...(w.speaker_id ? { speaker: w.speaker_id } : {}) }));
    res.json({ words, isolated });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});
