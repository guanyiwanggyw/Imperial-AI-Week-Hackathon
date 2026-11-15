import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./env.js";
import { safeId } from "./util.js";

/** Sessions are a folder each: session.json plus recording.webm. Served under /media/sessions/<id>/. */
export const sessionsRouter = Router();
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

sessionsRouter.post("/", upload.single("recording"), async (req, res) => {
  const session = JSON.parse(String(req.body.session ?? "{}")) as { id?: string };
  const id = safeId(session.id ?? "");
  if (!id) return res.status(400).json({ error: "session.id is required" });
  const dir = path.join(SESSIONS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  if (req.file) await fs.writeFile(path.join(dir, "recording.webm"), req.file.buffer);
  await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(session));
  res.json({ id, recordingUrl: req.file ? `/media/sessions/${id}/recording.webm` : null });
});

/** Update just the JSON (for example after the report is computed). */
sessionsRouter.put("/:id", async (req, res) => {
  const id = safeId(req.params.id);
  const dir = path.join(SESSIONS_DIR, id);
  try {
    await fs.access(dir);
  } catch {
    return res.status(404).json({ error: "Session not found" });
  }
  await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(req.body));
  res.json({ id });
});

sessionsRouter.get("/", async (_req, res) => {
  let ids: string[] = [];
  try {
    ids = await fs.readdir(SESSIONS_DIR);
  } catch {
    return res.json([]);
  }
  const list = await Promise.all(
    ids.map(async (id) => {
      try {
        const s = JSON.parse(await fs.readFile(path.join(SESSIONS_DIR, id, "session.json"), "utf8"));
        const ev = s.evaluation;
        return {
          id,
          startedAt: s.startedAt,
          title: s.title,
          overall: s.report?.overall ?? null,
          // Summary fields for the Past sessions page (older reports are 0–10 and have no scale).
          scale: s.report?.scale ?? 10,
          notScored: Boolean(s.report?.insufficientSpeech),
          panel: s.config?.panel?.name ?? null,
          format: s.config?.format ?? "timed",
          duration: s.duration ?? null,
          questions: Array.isArray(s.qna) ? s.qna.length : 0,
          scores: ev ? { ...ev.finalScores, timing: ev.timingScore ?? null, unmeasured: ev.unmeasured ?? [] } : null,
        };
      } catch {
        return null;
      }
    }),
  );
  res.json(list.filter(Boolean).sort((a, b) => String(b!.startedAt).localeCompare(String(a!.startedAt))));
});

sessionsRouter.get("/:id", async (req, res) => {
  try {
    const raw = await fs.readFile(path.join(SESSIONS_DIR, safeId(req.params.id), "session.json"), "utf8");
    res.type("application/json").send(raw);
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});
