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
  /** Fast model for the interactive panel's background drafts (brief: "Groq or Claude Haiku"). */
  agentsModel: read("AGENTS_MODEL") ?? "claude-haiku-5-5",
  elevenLabsKey: read("ELEVENLABS_API_KEY"),
  elevenLabsAgentId: read("ELEVENLABS_AGENT_ID"),
  anamKey: read("ANAM_API_KEY"),
  /** Main avatar and its voice. Optional: the first avatar and English voice on the account are used otherwise. */
  anamAvatarId: read("ANAM_AVATAR_ID"),
  anamVoiceId: read("ANAM_VOICE_ID"),
  falKey: read("FAL_KEY"),
  falImageModel: read("FAL_IMAGE_MODEL") ?? "fal-ai/flux/schnell",
  falVideoModel: read("FAL_VIDEO_MODEL") ?? "bytedance/seedance-2.0/fast/image-to-video",
  synthesiaKey: read("SYNTHESIA_API_KEY"),
  /** Test renders are free but watermarked (30 per day). */
  synthesiaTest: read("SYNTHESIA_TEST") === "true",
};

/** Which integrations are configured. The client uses this to pick live or fallback paths. */
export function integrationStatus() {
  return {
    anthropic: Boolean(env.anthropicKey),
    elevenlabs: Boolean(env.elevenLabsKey),
    elevenlabsAgent: Boolean(env.elevenLabsKey && env.elevenLabsAgentId),
    anam: Boolean(env.anamKey),
    fal: Boolean(env.falKey),
    synthesia: Boolean(env.synthesiaKey),
  };
}
