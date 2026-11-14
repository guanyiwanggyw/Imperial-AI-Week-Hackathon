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

/**
 * Picks an avatar and voice for a persona: env overrides first, then same gender, then the avatar
 * whose description shares the most words with the persona's appearance. Stable per persona name.
 */
async function pickFor(name: string, gender: Gender | undefined, look: string) {
  const { avatars, voices } = await loadCatalog();
  let avatarId = env.anamAvatarId;
  if (!avatarId) {
    const cara4 = avatars.filter((a) => a.activeVersion === "cara-4");
    const base = cara4.length ? cara4 : avatars;
    const sameGender = base.filter((a) => !gender || avatarGender(a) === gender);
    const pool = sameGender.length ? sameGender : base;
    const wanted = words(look);
    const score = (a: Listed) => [...words(a.description ?? "")].filter((w) => wanted.has(w)).length;
    const tie = (a: Listed) => hash(name + a.id) % 997;
    avatarId = [...pool].sort((a, b) => score(b) - score(a) || tie(a) - tie(b))[0]?.id;
  }
  let voiceId = env.anamVoiceId;
  if (!voiceId) {
    const english = voices.filter((v) => !v.languages || v.languages.includes("en"));
    const sameGender = english.filter((v) => !gender || String(v.gender).toLowerCase() === gender);
    const pool = sameGender.length ? sameGender : english.length ? english : voices;
    voiceId = pool[hash(name) % Math.max(pool.length, 1)]?.id;
  }
  if (!avatarId || !voiceId) throw new Error("No Anam avatar or voice found on this account");
  const avatar = avatars.find((a) => a.id === avatarId);
  const voice = voices.find((v) => v.id === voiceId);
  console.log(`[avatar] ${name}: avatar ${avatar?.displayName ?? avatarId}, voice ${voice?.displayName ?? voiceId}`);
  return { avatarId, voiceId, avatarName: avatar?.displayName, portrait: avatar?.portraitImageUrl ?? avatar?.imageUrl };
}

/** Avatars and voices on the account, for picking ANAM_AVATAR_ID / ANAM_VOICE_ID. */
avatarRouter.get("/anam-options", async (_req, res) => {
  if (!env.anamKey) return res.status(503).json({ error: "Anam is not configured" });
  try {
    const { avatars, voices } = await loadCatalog();
    res.json({
      avatars: avatars.map((a) => ({ id: a.id, name: a.displayName, model: a.activeVersion, description: a.description, image: a.portraitImageUrl })),
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
    const chosen = await pickFor(name, body.gender, body.look ?? "");
    const base = {
      name,
      avatarId: body.avatarId || chosen.avatarId,
      voiceId: body.voiceId || chosen.voiceId,
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
