import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { createFalClient } from "@fal-ai/client";
import { DATA_DIR, env } from "./env.js";
import { errorMessage, fetchWithTimeout, safeId, withTimeout } from "./util.js";

/**
 * Generative media via fal.
 *  - images: audience backdrops and persona portraits (fal image model)
 *  - reactions: short image-to-video clips per persona (nod, smile, frown, glance, sceptical)
 *    that play during the solo pitch, because Anam cues only apply while an avatar is speaking.
 * Everything is downloaded to server/data/generated and indexed in manifest.json, so a generated
 * asset survives restarts and the demo works without network once assets exist.
 */
export const mediaRouter = Router();

const GENERATED_DIR = path.join(DATA_DIR, "generated");
const MANIFEST = path.join(GENERATED_DIR, "manifest.json");

export const REACTIONS = {
  nod: "The person gives one slow, small approving nod, then returns to a still, attentive listening pose.",
  smile: "The person breaks into a small, genuine smile for a moment, then returns to a calm listening expression.",
  frown: "The person's brow furrows slightly as if puzzled, then relaxes back to a neutral listening expression.",
  glance: "The person briefly glances down and to the side, as if losing interest, then looks back at the camera.",
  sceptical: "The person raises one eyebrow and tilts the head slightly in a sceptical look, then returns to neutral.",
} as const;
export type Reaction = keyof typeof REACTIONS;

type Manifest = Record<string, string>; // key -> public url (/generated/...)

let manifestCache: Manifest | null = null;
async function readManifest(): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = JSON.parse(await fs.readFile(MANIFEST, "utf8")) as Manifest;
  } catch {
    manifestCache = {};
  }
  return manifestCache;
}
let writeChain: Promise<void> = Promise.resolve();
async function writeManifestEntry(key: string, url: string) {
  const manifest = await readManifest();
  manifest[key] = url;
  // Serialise writes so parallel clip jobs never interleave on the same file.
  writeChain = writeChain.then(async () => {
    await fs.mkdir(GENERATED_DIR, { recursive: true });
    await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  });
  await writeChain;
}

function falClient() {
  if (!env.falKey) throw new Error("fal is not configured");
  return createFalClient({ credentials: env.falKey });
}

async function download(url: string, fileName: string): Promise<string> {
  const response = await fetchWithTimeout(url, {}, 60_000);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.writeFile(path.join(GENERATED_DIR, fileName), Buffer.from(await response.arrayBuffer()));
  return `/generated/${fileName}`;
}

async function generateImage(key: string, prompt: string, size: "landscape_16_9" | "square_hd"): Promise<string> {
  const fal = falClient();
  const result = await withTimeout(
    fal.subscribe(env.falImageModel, { input: { prompt, image_size: size, num_images: 1, output_format: "jpeg" } }),
    60_000,
    "fal image",
  );
  const data = result.data as { images?: { url: string }[] };
  const remote = data.images?.[0]?.url;
  if (!remote) throw new Error("fal returned no image");
  const url = await download(remote, `${key}.jpg`);
  await writeManifestEntry(key, url);
  return url;
}

async function generateReaction(personaKey: string, reaction: Reaction, portraitUrl: string): Promise<string> {
  const fal = falClient();
  // fal needs a reachable URL; our portraits live on this server, so upload the bytes to fal storage first.
  const bytes = await fs.readFile(path.join(GENERATED_DIR, path.basename(portraitUrl)));
  const imageUrl = await fal.storage.upload(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
  const result = await withTimeout(
    fal.subscribe(env.falVideoModel, {
      input: {
        prompt: `${REACTIONS[reaction]} Static camera, same framing, same lighting, subtle and natural, no speech.`,
        image_url: imageUrl,
        end_image_url: imageUrl, // ends on the same frame, so clips cut back to the still portrait seamlessly
        duration: 4,
        resolution: "480p",
        generate_audio: false,
      },
    }),
    300_000,
    "fal video",
  );
  const data = result.data as { video?: { url: string } };
  if (!data.video?.url) throw new Error("fal returned no video");
  const key = `reaction-${personaKey}-${reaction}`;
  const url = await download(data.video.url, `${key}.mp4`);
  await writeManifestEntry(key, url);
  return url;
}

/** All generated assets we know about. */
mediaRouter.get("/assets", async (_req, res) => {
  res.json(await readManifest());
});

/** Generate (or return cached) image. kind is used only to pick the aspect ratio. */
mediaRouter.post("/image", async (req, res) => {
  const { key, prompt, kind, force } = req.body as { key: string; prompt: string; kind: "backdrop" | "portrait"; force?: boolean };
  const id = safeId(key ?? "");
  if (!id || !prompt) return res.status(400).json({ error: "key and prompt are required" });
  const manifest = await readManifest();
  if (manifest[id] && !force) return res.json({ url: manifest[id], cached: true });
  try {
    const url = await generateImage(id, prompt, kind === "backdrop" ? "landscape_16_9" : "square_hd");
    res.json({ url, cached: false });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

/** Reaction clip jobs run in the background; the client polls. */
const reactionJobs = new Map<string, { status: "running" | "done" | "failed"; done: number; errors: string[] }>();

mediaRouter.post("/reactions", async (req, res) => {
  const { personaKey, portraitUrl } = req.body as { personaKey: string; portraitUrl: string };
  const id = safeId(personaKey ?? "");
  if (!id || !portraitUrl) return res.status(400).json({ error: "personaKey and portraitUrl are required" });
  if (!env.falKey) return res.status(503).json({ error: "fal is not configured" });
  const existing = reactionJobs.get(id);
  if (existing?.status === "running") return res.json(existing);

  const manifest = await readManifest();
  const missing = (Object.keys(REACTIONS) as Reaction[]).filter((r) => !manifest[`reaction-${id}-${r}`]);
  const job = { status: "running" as "running" | "done" | "failed", done: Object.keys(REACTIONS).length - missing.length, errors: [] as string[] };
  reactionJobs.set(id, job);
  res.json(job);

  await Promise.all(
    missing.map((reaction) =>
      generateReaction(id, reaction, portraitUrl)
        .then(() => void job.done++)
        .catch((err) => void job.errors.push(`${reaction}: ${errorMessage(err)}`)),
    ),
  );
  job.status = job.errors.length === missing.length && missing.length > 0 ? "failed" : "done";
});

mediaRouter.get("/reactions/:personaKey", (req, res) => {
  res.json(reactionJobs.get(safeId(req.params.personaKey)) ?? { status: "idle", done: 0, errors: [] });
});
