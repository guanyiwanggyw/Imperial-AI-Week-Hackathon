import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";
import { download, GENERATED_DIR, readManifest, REACTIONS, updateManifest } from "./media.js";
import { errorMessage, fetchWithTimeout, safeId } from "./util.js";

/**
 * Synthesia faces for the panel.
 * Synthesia renders avatar videos in batch (a few minutes each), so it cannot stream a live face.
 * For each panelist we render one short square intro clip in which the avatar greets the presenter.
 *  - `intro-<key>`: the clip, played on the setup screen
 *  - `portrait-<key>`: a still from the clip, which becomes the panelist's face everywhere.
 *    Synthesia's own thumbnail has a play button drawn on it, so the browser grabs a frame
 *    from the mp4 and posts it to /:key/portrait. fal reaction clips are animated from this
 *    portrait, so any older ones are dropped.
 * Anam still provides the live talking face during Q&A.
 */
export const synthesiaRouter = Router();

const API = "https://api.synthesia.io/v2";
const POLL_MS = 10_000;
const MAX_WAIT_MS = 20 * 60_000;

type Job = { status: "running" | "done" | "failed"; stage: string; error?: string };
const jobs = new Map<string, Job>();

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(
    `${API}${url}`,
    { ...init, headers: { Authorization: env.synthesiaKey!, "Content-Type": "application/json", Accept: "application/json" } },
    30_000,
  );
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Synthesia ${response.status}: ${String(body.context ?? body.error ?? response.statusText)}`);
  return body as T;
}

interface Video {
  id: string;
  status: "in_progress" | "complete" | "error" | "rejected" | "deleted" | "approved";
  download?: string;
}

async function render(key: string, job: Job, input: { script: string; avatar: string; background: string; title: string }) {
  const created = await api<Video>("/videos", {
    method: "POST",
    body: JSON.stringify({
      test: env.synthesiaTest,
      visibility: "private",
      title: input.title,
      aspectRatio: "1:1",
      input: [
        {
          avatar: input.avatar,
          background: input.background,
          scriptText: input.script,
          avatarSettings: { style: "rectangular", horizontalAlign: "center" },
        },
      ],
    }),
  });

  job.stage = "Rendering";
  const started = Date.now();
  let video = created;
  while (video.status !== "complete") {
    if (["error", "rejected", "deleted"].includes(video.status)) throw new Error(`Synthesia video ${video.status}`);
    if (Date.now() - started > MAX_WAIT_MS) throw new Error("Synthesia render timed out");
    await new Promise((r) => setTimeout(r, POLL_MS));
    video = await api<Video>(`/videos/${encodeURIComponent(created.id)}`);
  }

  job.stage = "Downloading";
  if (!video.download) throw new Error("Synthesia returned no download link");
  const intro = await download(video.download, `synthesia-${key}.mp4`);
  await updateManifest({ [`intro-${key}`]: intro });
}

/** Start a render in the background; the client polls. Cached unless force is set. */
synthesiaRouter.post("/", async (req, res) => {
  const { personaKey, script, avatar, background, title, force } = req.body as {
    personaKey: string;
    script: string;
    avatar: string;
    background?: string;
    title?: string;
    force?: boolean;
  };
  const key = safeId(personaKey ?? "");
  if (!key || !script || !avatar) return res.status(400).json({ error: "personaKey, script and avatar are required" });
  if (!env.synthesiaKey) return res.status(503).json({ error: "Synthesia is not configured" });
  const existing = jobs.get(key);
  if (existing?.status === "running") return res.json(existing);
  const manifest = await readManifest();
  if (manifest[`intro-${key}`] && !force) return res.json({ status: "done", stage: "Cached" } satisfies Job);

  const job: Job = { status: "running", stage: "Submitting" };
  jobs.set(key, job);
  res.json(job);
  try {
    await render(key, job, { script, avatar, background: background ?? "white_meeting_room", title: title ?? `Panelist ${key}` });
    job.status = "done";
    job.stage = "Done";
  } catch (err) {
    job.status = "failed";
    job.error = errorMessage(err);
    console.warn(`[synthesia] ${key}: ${job.error}`);
  }
});

/** The browser posts a still frame of the intro clip; it becomes the panelist's portrait. */
synthesiaRouter.post("/:personaKey/portrait", async (req, res) => {
  const key = safeId(req.params.personaKey);
  const { image } = req.body as { image?: string };
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(image ?? "");
  if (!key || !match) return res.status(400).json({ error: "image must be a JPEG data URL" });
  const fileName = `synthesia-${key}.jpg`;
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.writeFile(path.join(GENERATED_DIR, fileName), Buffer.from(match[1], "base64"));
  const url = `/generated/${fileName}`;
  // Reaction clips were animated from the previous portrait; they would show a different face.
  const entries: Record<string, string | null> = { [`portrait-${key}`]: url };
  for (const r of Object.keys(REACTIONS)) entries[`reaction-${key}-${r}`] = null;
  await updateManifest(entries);
  res.json({ url });
});

synthesiaRouter.get("/:personaKey", (req, res) => {
  res.json(jobs.get(safeId(req.params.personaKey)) ?? { status: "idle", stage: "" });
});
