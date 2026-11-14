# Guanyi: updates log

Workstream: **main avatar** (brief §4 Integrations: "Anam avatar wired to speak() for the decision-maker persona", plus the `<Avatar>` component and fallback from the team rules).

Read the other `updates/*.md` files before each change. All were empty at the time.

---

## 2026-11-14: Fix: live avatar never appeared in the app

- **Cause:** React StrictMode mounts the session screen twice in development. `MainAvatar.stop()` only cleared its state after an `await`, so the second mount's `warm()` reused the first connection, which `stop()` had just marked stale. That connection then closed itself and left no session (video tracks `ended`, status `idle`).
- **Fix:**
  - `stop()` now resets everything synchronously.
  - Each Anam session streams into its **own** `<video>`, which the driver appends to `#main-avatar-slot` and removes on stop. A stale session can no longer blank a newer one.
  - `avatarVideoId` is renamed to `avatarSlotId`. `<Avatar>` renders the slot.
- **Verified** in headless Chrome by clicking through the real UI with a fake camera: one video, live tracks, and the "Live" badge on the decision-maker's tile.

## 2026-11-14: Live main avatar (Anam)

### What it does
- The **decision-maker** speaks through **one live Anam session** for the whole practice session.
  - The decision-maker is the persona with `decisionMaker: true`, or the first persona on the panel.
  - The session opens during the countdown, idles while it listens to the pitch, and speaks only the text we send. Anam's own LLM is off (`llmId: CUSTOMER_CLIENT_V1`), so the orchestrator owns the brain.
- **The other panelists** speak with a voice, and their tile lights up while they speak. For now that voice is browser speech; Person 2's ElevenLabs `speak()` slots in here.
- **Free dev fallback:** with no Anam key, or if Anam fails or drops, the same calls use the portrait plus browser speech. Nothing else changes.
- **Latency:** every line logs floor open → first audio (brief target: under 1 s).
  - It goes to the console as `[avatar] <persona> via <provider>: floorOpen→firstAudio N ms` and to `MainAvatar.log`.
  - Each Q&A turn is also saved in the session (`QnaTurn.provider`, `QnaTurn.latencyMs`).
- **Matching:** the avatar and voice are matched per persona from the Anam account. Gender comes first, then the avatar whose description best matches `persona.look`. `ANAM_AVATAR_ID` and `ANAM_VOICE_ID` override both.

### Measured (headless Chrome against the real Anam API)
- Session connect: about 0.9 s.
- Floor open → first audio: 974 ms and 1708 ms across two runs. It isn't reliably under 1 s yet, and it was measured with `talk()`, not streaming.
- The StrictMode double mount leaves exactly one session (stale connects close themselves). The fallback and its abort both work.

### API for the other workstreams (`web/src/avatar/`)
```ts
import { MainAvatar, speakAs, decisionMaker } from '../avatar/mainAvatar'
import { Avatar } from '../avatar/Avatar'

const avatar = new MainAvatar()                     // one per practice session
avatar.warm(persona, { anam: status.anam })          // never throws; status → 'live' or 'fallback'
<Avatar avatar={avatar} persona={persona} portrait={url} />   // exactly one per MainAvatar; must be mounted before warm() (renders #main-avatar-slot)
const log = await speakAs(avatar, persona, seat, text, abortSignal)  // routes decision-maker → avatar, others → voice
avatar.interrupt(); await avatar.stop()
useAvatarState(avatar)  // { status, provider, personaId, speakingId, error }
```
- **Person 2 (agents):** call `speakAs()` from your `speak(agent, text)`. To use ElevenLabs voices for the other panelists, replace `MainAvatar.sayAsVoice()`. The decision-maker branch is done.
- **Person 3 (UI):** `<Avatar>` fills its parent. For the brief's layout, put it in a top-centre slot under the webcam. It shows a status badge (Connecting avatar / Live / Voice only) and pulses the portrait while speaking in the fallback.
- **Synthesia live** (the brief's backup) would be another `AvatarDriver` in `drivers.ts`. It needs a Python LiveKit agent, LiveKit keys, a Synthesia key with the Interactive Avatars permission, and a custom avatar (stock avatars aren't allowed). Not built.

### Files
- **New:** `server/src/avatar.ts`, mounted at `/api/avatar`:
  - `POST /api/avatar/anam-token` creates the session token.
  - `GET /api/avatar/anam-options` lists the account's avatars and voices.
- **New:** `web/src/avatar/drivers.ts`, `mainAvatar.ts` and `Avatar.tsx`.
- **Changed:**
  - `components/Session.tsx`: warms during the countdown, stops at finish or unmount, and asks Q&A questions through `speakAs`.
  - `components/Audience.tsx`: the decision-maker's seat renders `<Avatar>`, and the speaking highlight follows whoever is audible.
  - `lib/qna.ts`
  - `types.ts`: adds `Persona.decisionMaker` and `QnaTurn.provider` / `latencyMs`.
  - `personas.ts`: `PORTRAIT_STYLE` is now exported.
  - `index.css`, `server/src/env.ts`, `.env.example`, `README.md`

### Breaking / removed
- **Removed:** `POST /api/voice/anam-session` (Anam driven by the ElevenLabs agent, one new session per question).
- **Removed:** `ANAM_AVATAR_IDS`.
- **Q&A modes** changed from `'anam' | 'voice' | 'browser'` to `'spoken' | 'voice'`:
  - **spoken:** the question is said through `speakAs`. The answer comes from the live transcript and ends after 4 s of silence, the 90 s limit, or the **Next question** button.
  - **voice:** the ElevenLabs agent, unchanged. It's used only when Anam isn't configured.
- **`/api/status`:** `anam` is now just `Boolean(ANAM_API_KEY)` and no longer needs ElevenLabs.

### Env
- `ANAM_API_KEY` (required for the live avatar)
- `ANAM_AVATAR_ID` and `ANAM_VOICE_ID` (optional overrides)

### Known gaps / next
- The setup screen still shows the Synthesia or fal face for the decision-maker, which differs from their live Anam face. `anam-token` already returns the Anam `portrait` URL, which could replace it.
- Agent audio isn't yet mixed into the recording (brief: one mixed `AudioContext` track). The avatar's audio plays from the `<video>` element.
- Interruptions during the pitch and the floor manager are Person 2's work. `avatar.interrupt()` and the `AbortSignal` on `speakAs()` are ready for them.

---

## 2026-11-14: Synthesia faces (pre-rendered)

- **New:** `server/src/synthesia.ts`, mounted at `/api/media/synthesia`.
  - Each panelist gets one square Synthesia stock-avatar clip that introduces them.
  - The browser grabs a frame from the clip and saves it as `portrait-<key>`. Synthesia's own thumbnail has a play button drawn on it.
  - The panelist's old fal reaction clips are dropped, so **Animate reactions** rebuilds them from the new face.
  - Everything is cached in `server/data/generated`.
- **Setup screen:** a **Synthesia faces** button, a **▶ Intro** player, and a "Synthesia faces" status chip.
- **Changed files:**
  - `web/src/lib/media.ts`: stock avatar per persona, plus `personaGender()`.
  - `server/src/media.ts`: exports the manifest helpers; fal uploads now use the portrait's real image type.
  - `server/src/env.ts`, `server/src/index.ts`, `web/src/api.ts`, `components/Setup.tsx`, `index.css`, `.env.example`, `README.md`
- **Env:**
  - `SYNTHESIA_API_KEY`
  - `SYNTHESIA_TEST=true` gives free, watermarked test renders (30 a day). It's currently on in my `.env`.
