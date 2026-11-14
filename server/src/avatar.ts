import { Router } from "express";
import { env } from "./env.js";
import { errorMessage, fetchWithTimeout } from "./util.js";

/**
 * Main avatar (Anam). One live session per practice session, driven by text we supply:
 * the persona runs with llmId CUSTOMER_CLIENT_V1, so Anam's own LLM is off and the avatar
 * only says what the browser sends with client.talk(text). The orchestrator owns the brain.
 *
 * Avatar and voice come from ANAM_AVATAR_ID / ANAM_VOICE_ID, or are matched to the persona
 * (gender, then appearance) from the avatars and voices on the account.
 */
export const avatarRouter = Router();

const ANAM = "https://api.anam.ai/v1";

interface Listed {
  id: string;
  displayName?: string;
  description?: string;
  activeVersion?: string;
  /** "realistic" | "illustrated" | "animated_3d" */
  renderStyle?: string;
  portraitImageUrl?: string;
  imageUrl?: string;
  gender?: string;
  languages?: string[];
}

async function anam<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(
    `${ANAM}${path}`,
    { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.anamKey}` } },
    10_000,
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`Anam ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** All pages of an Anam list endpoint. */
async function listAll(path: string): Promise<Listed[]> {
  const out: Listed[] = [];
  for (let page = 1; page <= 5; page++) {
    const body = await anam<Listed[] | { data?: Listed[]; meta?: { lastPage?: number } }>(`${path}?perPage=100&page=${page}`);
    if (Array.isArray(body)) return body;
    out.push(...(body.data ?? []));
    if (!body.meta?.lastPage || page >= body.meta.lastPage) break;
  }
  return out;
}

let catalog: Promise<{ avatars: Listed[]; voices: Listed[] }> | null = null;
function loadCatalog() {
  catalog ??= Promise.all([listAll("/avatars"), listAll("/voices")])
    .then(([avatars, voices]) => ({ avatars, voices }))
    .catch((err) => {
      catalog = null; // retry on the next request
      throw err;
    });
  return catalog;
}

type Gender = "female" | "male";
const FEMALE = /\b(woman|girl|female|lady)\b/i;
const MALE = /\b(man|guy|male|gentleman)\b/i;
const avatarGender = (a: Listed): Gender | null => (FEMALE.test(a.description ?? "") ? "female" : MALE.test(a.description ?? "") ? "male" : null);
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;

interface AgentInput {
  name: string;
  gender?: Gender;
  /** Appearance text; used to pick the closest-looking avatar */
  look?: string;
  /** The agent's own Anam ids (Persona.anamAvatarId / anamVoiceId). These always win. */
  avatarId?: string;
  voiceId?: string;
}

/** Agents are realistic human beings: Anam's illustrated and 3D-animated avatars are never used. */
const isRealistic = (a: Listed | undefined) => a?.renderStyle === "realistic";

/**
 * Picks an avatar and voice for an agent. The agent's own ids win; then ANAM_AVATAR_ID /
 * ANAM_VOICE_ID; then a match: same gender, then the avatar whose description shares the most
 * words with the agent's appearance. Only realistic avatars are used: an own or env id that points
 * at an illustrated or animated avatar is ignored. Ids in `taken` are avoided so a panel never
 * shares a face. Stable per agent name.
 */
async function pickFor(agent: AgentInput, taken: Set<string> = new Set()) {
  const { avatars, voices } = await loadCatalog();
  const { name, gender } = agent;
  let avatarId = [agent.avatarId, env.anamAvatarId].find((id) => {
    if (!id) return false;
    if (isRealistic(avatars.find((a) => a.id === id))) return true;
    console.warn(`[avatar] ${name}: avatar ${id} is not a realistic human (or not on this account); matching one instead`);
    return false;
  });
  if (!avatarId) {
    const realistic = avatars.filter((a) => isRealistic(a) && a.activeVersion === "cara-4");
    const base = realistic.length ? realistic : avatars.filter(isRealistic);
    const sameGender = base.filter((a) => !gender || avatarGender(a) === gender);
    const pool = (sameGender.length ? sameGender : base).filter((a) => !taken.has(a.id));
    const wanted = words(agent.look ?? "");
    const score = (a: Listed) => [...words(a.description ?? "")].filter((w) => wanted.has(w)).length;
    const tie = (a: Listed) => hash(name + a.id) % 997;
    avatarId = [...(pool.length ? pool : base)].sort((a, b) => score(b) - score(a) || tie(a) - tie(b))[0]?.id;
  }
  let voiceId = agent.voiceId || env.anamVoiceId;
  if (!voiceId) {
    const english = voices.filter((v) => !v.languages || v.languages.includes("en"));
    const sameGender = english.filter((v) => !gender || String(v.gender).toLowerCase() === gender);
    const pool = sameGender.length ? sameGender : english.length ? english : voices;
    voiceId = pool[hash(name) % Math.max(pool.length, 1)]?.id;
  }
  if (!avatarId || !voiceId) throw new Error("No Anam avatar or voice found on this account");
  const avatar = avatars.find((a) => a.id === avatarId);
  const voice = voices.find((v) => v.id === voiceId);
  return {
    avatarId,
    voiceId,
    avatarName: avatar?.displayName,
    voiceName: voice?.displayName,
    portrait: avatar?.portraitImageUrl ?? avatar?.imageUrl,
    /** Whether the id came from the agent itself rather than the automatic match */
    fixed: Boolean(agent.avatarId) && avatarId === agent.avatarId,
  };
}

/**
 * The Anam avatar and voice for each agent on a panel, in seat order, without repeating a face.
 * Body: { agents: AgentInput[] }. Used by the setup screen to show every agent's avatar id.
 */
avatarRouter.post("/anam-match", async (req, res) => {
  if (!env.anamKey) return res.status(503).json({ error: "Anam is not configured" });
  const agents = ((req.body as { agents?: AgentInput[] }).agents ?? []).slice(0, 12);
  try {
    // Agents with their own ids claim them first, so matched agents avoid those faces.
    const taken = new Set(agents.map((a) => a.avatarId).filter((id): id is string => Boolean(id)));
    const out = [];
    for (const agent of agents) {
      const pick = await pickFor(agent, taken);
      taken.add(pick.avatarId);
      out.push(pick);
    }
    res.json({ agents: out });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

/** Realistic avatars and voices on the account, for picking an agent's ids. */
avatarRouter.get("/anam-options", async (_req, res) => {
  if (!env.anamKey) return res.status(503).json({ error: "Anam is not configured" });
  try {
    const { avatars, voices } = await loadCatalog();
    res.json({
      avatars: avatars.filter(isRealistic).map((a) => ({ id: a.id, name: a.displayName, model: a.activeVersion, description: a.description, image: a.portraitImageUrl })),
      voices: voices.map((v) => ({ id: v.id, name: v.displayName, gender: v.gender, languages: v.languages })),
    });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});

interface TokenRequest {
  name?: string;
  gender?: Gender;
  /** Appearance text; used to pick the closest-looking avatar */
  look?: string;
  avatarId?: string;
  voiceId?: string;
  idleStyle?: string;
  expressivity?: number;
}

/** Session token for one talk-driven Anam session. The browser connects with it directly. */
avatarRouter.post("/anam-token", async (req, res) => {
  if (!env.anamKey) return res.status(503).json({ error: "Anam is not configured" });
  const body = req.body as TokenRequest;
  try {
    const name = body.name || "Panelist";
    const chosen = await pickFor({ name, gender: body.gender, look: body.look, avatarId: body.avatarId, voiceId: body.voiceId });
    console.log(`[avatar] ${name}: avatar ${chosen.avatarName ?? chosen.avatarId} (${chosen.avatarId}), voice ${chosen.voiceName ?? chosen.voiceId}`);
    const base = {
      name,
      avatarId: chosen.avatarId,
      voiceId: chosen.voiceId,
      llmId: "CUSTOMER_CLIENT_V1",
      maxSessionLengthSeconds: 1800,
    };
    // Director Notes (idle listening style) are Cara 4 only; drop them if Anam rejects the config.
    const attempts: Record<string, unknown>[] = body.idleStyle
      ? [{ ...base, directorNotes: { customIdlingStylePrompt: body.idleStyle, expressivity: body.expressivity ?? 0.5 } }, base]
      : [base];
    let lastError = "";
    for (const personaConfig of attempts) {
      try {
        const { sessionToken } = await anam<{ sessionToken: string }>("/auth/session-token", {
          method: "POST",
          body: JSON.stringify({ personaConfig }),
        });
        return res.json({ sessionToken, degraded: personaConfig !== attempts[0], avatarName: chosen.avatarName, portrait: chosen.portrait });
      } catch (err) {
        lastError = errorMessage(err);
        console.warn(`[avatar] session token attempt failed: ${lastError}`);
      }
    }
    res.status(502).json({ error: lastError });
  } catch (err) {
    res.status(502).json({ error: errorMessage(err) });
  }
});
