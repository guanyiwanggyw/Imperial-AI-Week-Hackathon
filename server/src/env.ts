import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");
export const DATA_DIR = path.resolve(here, "..", "data");

config({ path: path.join(ROOT, ".env"), quiet: true });

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  port: Number(read("PORT") ?? 8787),
  anthropicKey: read("ANTHROPIC_API_KEY"),
  anthropicModel: read("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
  elevenLabsKey: read("ELEVENLABS_API_KEY"),
  elevenLabsAgentId: read("ELEVENLABS_AGENT_ID"),
  anamKey: read("ANAM_API_KEY"),
  anamAvatarId: read("ANAM_AVATAR_ID"),
  /** Optional: one Cara 4 avatar per panel seat, comma separated. Falls back to ANAM_AVATAR_ID. */
  anamAvatarIds: (read("ANAM_AVATAR_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  falKey: read("FAL_KEY"),
  falImageModel: read("FAL_IMAGE_MODEL") ?? "fal-ai/flux/schnell",
  falVideoModel: read("FAL_VIDEO_MODEL") ?? "bytedance/seedance-2.0/fast/image-to-video",
};

/** Which integrations are configured. The client uses this to pick live or fallback paths. */
export function integrationStatus() {
  return {
    anthropic: Boolean(env.anthropicKey),
    elevenlabs: Boolean(env.elevenLabsKey),
    elevenlabsAgent: Boolean(env.elevenLabsKey && env.elevenLabsAgentId),
    anam: Boolean(env.anamKey && (env.anamAvatarId || env.anamAvatarIds.length) && env.elevenLabsKey && env.elevenLabsAgentId),
    fal: Boolean(env.falKey),
  };
}
