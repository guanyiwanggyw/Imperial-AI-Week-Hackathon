# Guanyi: updates log

Workstreams:
- **Main avatar** (brief §4 Integrations: "Anam avatar wired to speak() for the decision-maker persona", plus the `<Avatar>` component and fallback from the team rules).
- **Live captions** (the transcript strip on the live screen, and the brief's "live captions of agent lines").

I read the other `updates/*.md` files before each change.

---

## 2026-11-14: Every agent is a live Anam avatar

I read `updates/*.md` first. Nothing had changed since my last entry.

### What it does
- **One Anam session per agent.** This replaces the single decision-maker session from the brief.
  - All sessions open in parallel during the countdown.
  - Each idles in its own tile while listening to the pitch.
  - Each speaks its own Q&A lines through its own avatar and voice (the ids from the previous entry).
- **Fallback is per agent:** if one agent's session fails to start or drops, only that agent falls back to its portrait and the browser voice. Its badge says "Voice only", and the others stay live.
- **Reaction clips** only show on seats that aren't live, since live avatars have their own idle motion.
- **Cost:** each live agent is billed as its own Anam session, so a 3-agent panel uses 3× the minutes.

### Verified (headless Chrome, real UI, real Anam)
- **Account limit:** three concurrent sessions work on this account. They connected in 0.8–2.4 s and spoke with 587–648 ms latency.
- **Full session (investors panel):** all three seats were live with video tracks streaming during the pitch. In Q&A, Priya asked via Anam (625 ms to first audio), then Marcus via Anam (715 ms). Each server log line shows that agent's own avatar id.

### API change (breaking, inside `web/src/avatar` only)
- **Renamed:** `mainAvatar.ts` → `panelAvatars.ts` (git mv), and `MainAvatar` → `PanelAvatars`.
  ```ts
  const avatars = new PanelAvatars()
  avatars.warm(panel.personas, { anam })      // all agents
  <Avatar avatars={avatars} persona={p} />    // one per agent
  await speakAs(avatars, persona, seat, text, signal)
  avatars.seat(personaId)                     // { status, provider, error }
  ```
- **State:** `useAvatarState(avatars)` returns `{ seats: Record<id, SeatState>, speakingId, lines }`. The old top-level `status` / `provider` / `personaId` are gone.
- **Slots:** `avatarSlotId` is now a function, `avatarSlotId(personaId)`.
- **`Audience`:** takes `avatars`. `mainId` is gone, and every seat renders `<Avatar>`.
- **`decisionMaker()`:** still exported (who leads, for Person 2's orchestration), but no longer decides who is live.

### Files
- `web/src/avatar/panelAvatars.ts` (renamed and rewritten), `Avatar.tsx`
- `web/src/components/Audience.tsx`, `Session.tsx` (`avatar` → `avatars`; warms all agents), `LiveCaptions.tsx` (import path)
- `web/src/lib/qna.ts` (import path and comments), `README.md`

---

## 2026-11-14: An Anam avatar id for every agent

I read `updates/*.md` first. Nothing had changed since my last entry.

### What it does
- **Every built-in agent has its own Anam avatar and voice** in `web/src/personas.ts` (`anamAvatarId`, `anamVoiceId`). Edit them there to change a face. All eight are different:

| Agent | Panel | Anam avatar | `anamAvatarId` | Voice |
| --- | --- | --- | --- | --- |
| Priya Shah | investors | Chloe | `7b60ba32-5003-45a3-b4c6-af3d0cd36a40` | Ashleigh |
| Marcus Webb | investors | Pablo | `8dd64886-ce4b-47d5-b837-619660854768` | Conrad |
| Elena Kovac | investors | Marie | `81a4d24a-6217-4f3b-87c5-ef8d9eb0031b` | Anika |
| Sam Okafor | peers | Kevin | `3819079b-72ed-47d8-b9f3-5ed8be7e8a86` | Aryaveer |
| Maya Lindqvist | peers | Astrid | `bdaaedfa-00f2-417a-8239-8bb89adec682` | Skylar |
| James Holloway | interview | Marcus | `c8601ae3-9686-4f1f-8e32-7499b470f6b5` | Eastend Steve |
| Aisha Rahman | interview | Antonia | `a7eb25e8-8c31-460d-a397-8cd8010c76d1` | Elise |
| Tom Becker | interview | Alister | `85ca4111-d638-4cdc-91b4-513afedcdd20` | Darian |

- **Custom agents:** the custom panel has an "Anam avatar id" field per agent. If it's empty, the server matches one by gender, then appearance, and never repeats a face already used on the panel.
- **The setup screen shows every agent's Anam avatar:** thumbnail, name and id. Click the tag to copy the id.
- **Setup and the live session always agree:** on Start, the ids shown are written into the personas, and the session uses exactly those. Verified: Priya went live as Chloe `7b60ba32…`.
- **Precedence:** the agent's own id, then `ANAM_AVATAR_ID` / `ANAM_VOICE_ID` from `.env`, then the automatic match. Leave the `.env` ones empty, or every agent without its own id gets the same face.

### API
- `POST /api/avatar/anam-match`
  - Body: `{ agents: [{ name, gender?, look?, avatarId?, voiceId? }] }`
  - Returns: `{ agents: [{ avatarId, avatarName, voiceId, voiceName, portrait, fixed }] }`, in seat order.
- `POST /api/avatar/anam-token` now accepts `avatarId` / `voiceId` from the persona and logs the id it uses.

### Files
- **New:**
  - `web/src/avatar/anamMatch.ts`: `matchAnamAvatars()`, `withAnamIds()` and `appearance()`.
  - `web/src/avatar/AnamTag.tsx`
- **Changed:**
  - `server/src/avatar.ts`: `pickFor()` takes the agent's own ids and a set of ids already taken.
  - `web/src/avatar/drivers.ts`: sends the persona's ids.
  - `web/src/types.ts`: `Persona.anamAvatarId?` / `anamVoiceId?`.
  - `web/src/personas.ts`: ids for the 8 agents.
  - `web/src/components/Setup.tsx`: tags, the custom id field, and ids passed to the session.
  - `web/src/index.css`, `README.md`

---

## 2026-11-14: Live captions on the practice screen

I read `updates/Jihu.md` first. **I didn't edit `web/src/eval/**`** (Jihu's). The captions only *read* the transcriber's public fields (`evalRt.transcript.phrases`, `.partial`, `.error`) and import `Phrase` from `web/src/eval`, as Jihu asks.

### What it does
- **One captions strip under the slides** replaces the old "last 40 words" transcript line. It shows the conversation in time order:
  - **You:** your committed Scribe phrases, with the words still being recognised shown lighter. Phrases are joined into one row while you keep talking. A pause over 2.5 s, or a panel line, starts a new row.
  - **Panel lines**, labelled with the persona's name, revealed **word by word as they're spoken**, with a blinking caret while speaking and "…" if interrupted.
- **Sync with the audio.** Each voice reports how far it has got:
  - Anam streams the text it is speaking (`MESSAGE_STREAM_EVENT_RECEIVED`).
  - The browser voice fires word `boundary` events.
  - Otherwise words appear at 2.6 words/s from the first audio.
  - Captions never run ahead of the line, and show the full text once it's done.
- **Question card (Q&A):** in spoken mode it shows the current line as it's spoken, with the rest faint. Voice-agent mode is unchanged (full message).
- **Ordering:** your rows are placed by when the phrase *ended*, so words you were still saying when a panel line started show after it instead of jumping above it on commit.

### Verified (headless Chrome, real Scribe + real Anam, synthesized test pitch as the fake mic)
- Your captions stream live and commit with fillers kept ("small clinics, um, cut the time…").
- Priya's line (live Anam) and Marcus's line (browser voice) reveal in step with the audio. Floor open → first audio was 627–708 ms on Anam and 278–439 ms on the browser voice.
- No rows jump after the ordering fix.

### API (for UI / Person 3)
```tsx
<LiveCaptions personas={...} phrases={evalRt.transcript.phrases} partial={evalRt.transcript.partial}
  lines={[...useAvatarState(avatar).lines, ...voiceAgentLines]} error={evalRt.transcript.error} rows={4} />
```
- `MainAvatar` state now has `lines: CaptionLine[]`, with `{ id, personaId, text, spoken, t, end, done, interrupted }`. Times are on the session clock via `avatar.setClock(clock.now)`.
- `AvatarDriver.say(text, signal?, onProgress?)`: the new third argument receives the text spoken so far. Person 2: implement it in an ElevenLabs driver and its captions sync too.

### Files
- **New:** `web/src/components/LiveCaptions.tsx`
- **Changed:**
  - `web/src/avatar/drivers.ts`: progress callbacks.
  - `web/src/avatar/mainAvatar.ts`: caption lines and their reveal.
  - `web/src/components/Session.tsx`: renders `<LiveCaptions>`. In voice-agent mode, agent lines are collected as caption lines; the question card shows the spoken line. `lastWords` is removed.
  - `web/src/index.css`: `.captions` styles added; the unused `.transcript` styles removed.

### For Jihu (not changed; your files)
- The transcriber kept transcribing while the panel spoke. In the test, the looping fake mic produced "You" rows during panel lines. `LiveTranscript.setMuted()` exists but nothing seems to call it during agent speech. With real speakers, echo cancellation should catch the avatar's audio, but it's worth checking whether you want the mic muted, or kept on so you can measure talk-over.

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
