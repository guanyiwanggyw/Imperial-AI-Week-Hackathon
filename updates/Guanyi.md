# Guanyi: updates log

Workstreams:
- **Main avatar** (brief §4 Integrations: "Anam avatar wired to speak() for the decision-maker persona", plus the `<Avatar>` component and fallback from the team rules).
- **Live captions** (the transcript strip on the live screen, and the brief's "live captions of agent lines").

I read the other `updates/*.md` files before each change.

---

## 2026-11-14: Agents respond to what you say; "Delivery over time" chart redesigned

I read all of `updates/*.md` first and was up to date with `origin/main` (`927e9b3`). Jihu's new entry (tracking overlay on the recording) touches only Jihu's files and the video wrapper in `Report.tsx`; my chart change is in a different section of that file. Alfaa's and Derek's files are empty.

### Agents: human-like and responsive (`web/src/agents/`)
- **Built-in lines respond to your latest turn** (`fallbackLines.ts`, used now because `.env` has no `ANTHROPIC_API_KEY`):
  - `analyse()` finds the statement most worth responding to (never your own question), its topic and any figure.
    - Topics are checked most specific first: competition, money, problem, customers, plan, team, product.
    - Figures keep their scale and unit: "two hundred thousand pounds", "two hours a day".
  - `mirror()` echoes it back in the second person, with fillers and the "so", "well", "okay" they leave behind removed: "We already have three paying clinics" → "you already have three paying clinics".
  - The agent then probes it by topic. Real examples from the check:
    - "Mm. You said you charge each clinic four hundred pounds a month. How did you land on that price?"
    - "Three paying clinics. How did you find them?"
    - "Two hours a day. Yeah, that's a real pain, I can see it."
    - "Everyone says that about the incumbents." (strict agent)
  - It sounds like a person: contractions, short reactions ("Mm.", "Right.", "Okay, nice."), warm or cool wording by strictness, and no line repeated.
- **Addressing the panel:**
  - Name an agent ("Marcus, what do you think about that price?") and that agent answers next.
  - Ask the whole panel ("…any thoughts?") and the agent who has spoken least answers.
  - New line kind `reply`. Replies engage with your figure: "Four hundred pounds a month feels reasonable to me. I'd want to know they'll keep paying it."
- **Turn-taking:** after an agent replies or comments, nobody else asks for 5 s, so you can respond. Before, Elena asked 2 s after Marcus answered you.
- **Claude path (when a key is added):**
  - The drafting prompt now leads with `<latest_from_speaker>`. Every line must respond to it (quote or paraphrase, react before asking, never re-ask what was just answered), in a human register (no "Great question"), with a `reply` that answers direct questions.
  - Drafts carry how much transcript they saw. A reactive line (follow-up, comment, reply, or a question after an answer) never uses a draft that missed your latest words: it refreshes that one agent's draft first, waiting at most 1.8 s (about a human beat), then falls back to the built-in responsive line. Before, drafts could be one answer behind.
- **Verified:**
  - Line checks on six realistic turns, plus the reply and floor cases (named → that agent replies; still talking → nobody; within 5 s of a reply → nobody).
  - A live headless-Chrome session with Anam and Scribe: Marcus answered when named, Priya picked up "three paying clinics in London", and first audio took 446–637 ms.
  - The fixes after that run (price-aware reply, the 5 s reaction gap, figures as whole words, no mirrored questions) were re-checked offline.
  - Claude drafts are still untested (no key).

### "Delivery over time" chart (`web/src/components/DeliveryTimeline.tsx`, replaces `Sparkline.tsx`)
Users couldn't read the old chart: no time axis or scale, lines spilling past the plot into the value column, an unlabelled band, blank rows with no explanation, and bare numbers. Redesigned following the dataviz guidance: small multiples on one shared time axis, a single series per row (so no legend), solid hairline grid, 2px lines and 8px dots ringed in the surface colour.
- **Each row:**
  - A plain "what good looks like" line, e.g. "Look at the panel at least 60% of the time".
  - A labelled y-scale, and a labelled target band ("target 60%+", "target 130–165").
  - Readings outside the target show in amber.
  - A **verdict with an icon and a word**, never colour alone, computed from the same values the chart draws: "✓ 61% · on target", "! 232 wpm · too fast", "✓ 3 deliberate · none hesitant".
- **Shared x-axis** in m:ss with slide labels, plus "time in the pitch".
- **Hover:** one crosshair across all rows, and one tooltip listing every signal at that moment.
- **Playhead and click:** a line marks where the recording is; clicking any row jumps the recording there.
- **Empty rows explain themselves**, e.g. "Not measured: no clear voice pitch was heard".
- **"Show as table":** the same values per 10 s window, with an Overall row.
- **Fixed the overflow:** points sit at the middle of the part of each window inside the pitch, and the SVG is drawn at its measured pixel width (no `preserveAspectRatio="none"`, which also stretched text).
- **Verified:** headless Chrome on a saved session. No element overflows. A crosshair at 55% across the plot reads 0:12 (an offset bug was fixed). The table shows all windows. Screenshots checked.

### Files
- **Agents:**
  - `web/src/agents/fallbackLines.ts` (rewritten), `floorManager.ts` (`reply` kind; `addressedId` / `askedPanel`; reaction gap), `orchestrator.ts` (rewritten: latest turn, addressing, fresh drafts)
  - `server/src/agents.ts` (prompt, `latest`, `reply`)
- **Chart:**
  - New: `web/src/components/DeliveryTimeline.tsx`
  - Deleted (`git rm`): `web/src/components/Sparkline.tsx`; only `Report.tsx` used it.
  - `web/src/components/Report.tsx`: only section 4 is replaced, plus a new `deliveryRows()` helper at the bottom of the file. Two unused locals (`fmt1`, `byKey`) are removed.
  - `web/src/index.css`: the `.timeline` rules are replaced by `.dt-*` rules.

---

## 2026-11-14: Interactive sessions: agents that interrupt, follow up and comment

I read all of `updates/*.md` first, and local `main` was up to date with `origin/main` (`c9de124`). Jihu's latest entries were already covered. Alfaa's and Derek's files are empty, so the agents/orchestrator lane (brief §2, Person 2) had no owner or code. **If one of you is Person 2, this is your lane:** everything is in `web/src/agents/` and built against the brief's `RoomState`, `AgentTurn` and `speak()` contracts. Change whatever you like.

### What it does
- **Setup → Timing → Session:** "Pitch, then questions" (the existing timed flow, unchanged) or **"Interactive"**: no pitch timer and no fixed Q&A. In interactive mode the timer counts up with no limit, and the main button is "Finish and see report".
- **The orchestrator** ticks every 300 ms and asks the floor manager whether anyone should speak. Inputs: Jihu's live `RoomState` (`evalRt.roomState`), the transcript phrases, and "claim without evidence" events from the live event engine.

### Floor manager rules (`web/src/agents/floorManager.ts`, pure)
- **Panel awareness:**
  - One voice at a time.
  - Nobody takes the floor within 2 s of another agent's line.
  - At most one interruption every 45 s across the whole panel.
  - Nobody talks over an unanswered question. The asker nudges once ("Take your time") after about 9 s; after that, the panel waits.
- **Polite turns (brief rule):**
  - When invited ("happy to take any questions…"), agents ask straight away.
  - Mid-pitch, a breath (silence over 1.2 s and `endOfThoughtProb` over 0.7) occasionally draws a short **comment**: 5% per tick, at most one per 40 s. A clearly longer pause (over 2.4 s) draws a **question**.
- **Interruptions:** only agents with `canInterrupt`, and only for a reason:
  - the monologue runs past their `patienceSec`;
  - `ramblingScore` is over 0.7;
  - an unsupported claim was made in the last 4 s, if the agent is evidence-minded.

  Never within 20 s of the last agent line; the least patient interrupter goes first.
- **After an answer:**
  - The asker **follows up** while it has follow-ups left (chance 45% ± 10% per strictness point).
  - Otherwise someone else **comments** (30%) or **asks next**.
  - Agents who have spoken least go first, and the same agent doesn't speak twice in a row unless following up.
- **Barge-in:** if you talk over an agent (your mouth moving with voice for over 0.5 s, from Jihu's mouth gate, so the panel's own audio doesn't count), the agent stops. **Stubborn** agents (strictness 5) finish their line.

### Agent traits (`web/src/agents/traits.ts`)
- New optional `Persona` fields: `canInterrupt`, `patienceSec`, `followUps`.
- Defaults come from strictness:

  | Strictness | Patience | Can interrupt | Follow-ups |
  | --- | --- | --- | --- |
  | 1 | 240 s | no | 1 |
  | 2 | 180 s | no | 1 |
  | 3 | 150 s | no | 1 |
  | 4 | 110 s | yes | 2 |
  | 5 | 75 s | yes, and stubborn | 2 |

  For example, Priya can cut in after 75 s and finishes her lines, while Marcus never interrupts.

### What they say
- **Claude drafts (brief "Speed" §1):**
  - `POST /api/agents/drafts` (new `server/src/agents.ts`) makes one batched structured-output call that returns each agent's next `question`, `follow_up`, `comment` and `interjection`. Each is under 20 words, grounded in the transcript, never repeats another agent, and sometimes builds on one by name.
  - Model `AGENTS_MODEL`, default `claude-haiku-5-5` (the brief's "Claude Haiku"), effort `low`, 15 s timeout, no retries.
  - Refreshed after each new transcript commit (at most every 2.5 s), and never on the critical path: when an agent gets the floor, its current draft is spoken immediately.
- **Fallback lines (`fallbackLines.ts`):** used without `ANTHROPIC_API_KEY` (the current `.env` has none) or before the first draft arrives. They follow the agent's focus, pick up figures you used ("You said 200,000. Compared with what?"), switch between warm and cool comments by strictness, and are never repeated.
- **Speech:** every line goes through `sayLogged()` → `speakAs()` (the agent's own live Anam avatar) and is logged as an `AgentTurn` (Jihu's `agentSpeaking`). A new question calls `evalRt.exchangeEnded()` for the background judge. Captions and the card under the panel reveal the line as it is spoken.

### Verified
- **Floor manager unit check:** 16 scripted `RoomState` scenarios, all as intended:
  - Nobody speaks while an agent speaks, or 1 s after one.
  - No interruption at 30 s; Priya interrupts at 80 s, on rambling, and on a fresh claim.
  - No second interruption within 45 s.
  - Mid-pitch breath: usually nothing, sometimes a comment. A 3 s pause gets a question, and an invite gets one at 1 s.
  - An unanswered question gets a wait, then one nudge.
  - After an answer: a follow-up, or the next agent's question. Nothing while you're still mid-sentence.
- **End to end:** headless Chrome, real Scribe, all three investors live on Anam, and a synthesized speaker with pauses, an invite and answers as the fake mic. Sequence:
  - Marcus asked after the invite.
  - He followed up on the answer.
  - He nudged once on silence.
  - Priya asked at a pause.
  - Elena pressed on the speaker's "200,000".

  First audio took 528–692 ms per line. Captions, the live card and the open-ended timer all worked.
- **Typecheck and lint:** clean (web and server).
- **Not verified:**
  - Barge-in and interruptions end to end. Barge-in needs a real face (the fake camera has none, and the mic-only fallback has no mouth signal); interruptions need a monologue of 75 s or more. Both are covered by the unit check only.
  - Claude drafts against the live API (no key). The route typechecks and the client falls back when it returns 503.

### Files
- **New:**
  - `web/src/agents/orchestrator.ts`, `floorManager.ts`, `traits.ts` and `fallbackLines.ts`
  - `server/src/agents.ts` (mounted at `/api/agents` in `server/src/index.ts`)
- **Changed:**
  - `web/src/components/Session.tsx`: `interactive` flag; orchestrator start and stop; shared `sayLogged()`, now also used by spoken Q&A; live-line card; timer and controls.
  - `web/src/components/Setup.tsx`: Session format option.
  - `web/src/types.ts`: `SessionConfig.format?`; `Persona.canInterrupt?`, `patienceSec?` and `followUps?`.
  - `server/src/env.ts` (`AGENTS_MODEL`), `.env.example`, `README.md`

---

## 2026-11-14: Realistic human avatars only; no keys or ids in the UI

I read all of `updates/*.md` first and pulled `c7c32a1`. Jihu's new entries (workspace header, mouth-gated speech, panel-leak filtering, tracking debug page) don't touch my files. Thanks for handling the panel-audio note in `assemble.ts`. Alfaa's and Derek's files are empty.

### Realistic avatars
- Anam's catalogue has 120 avatars with three `renderStyle`s: 80 `realistic`, 27 `illustrated` and 13 `animated_3d`. Four of our agents were on illustrated or 3D avatars:
  - Priya: Chloe, illustrated
  - Elena: Marie, 3D
  - Sam: Kevin, illustrated
  - Tom: Alister, 3D
- **Server (`server/src/avatar.ts`):**
  - Matching only uses `renderStyle === "realistic"` (Cara 4) avatars.
  - An agent's own id, or `ANAM_AVATAR_ID`, that points at a non-realistic avatar (or one not on the account) is ignored with a warning, and a realistic one is matched instead.
  - `GET /api/avatar/anam-options` lists realistic avatars only.
- **New ids in `web/src/personas.ts`:** picked by hand against each agent's description, because word matching missed age. All are realistic and all are different:

| Agent | Avatar | `anamAvatarId` |
| --- | --- | --- |
| Priya Shah | Kiara (mature, pinstripe blazer, city office) | `42675ef1-2342-45d8-9603-9bd92ed45699` |
| Marcus Webb | Gabriel (salt-and-pepper hair and beard) | `917ff800-24e8-41a0-9621-4adea170d9f5` |
| Elena Kovac | Elena (glasses, blazer) | `5e96a4a4-4a1d-4ead-a5c9-122627d91655` |
| Sam Okafor | Kevin, realistic variant (dark green pullover) | `ccf00c0e-7302-455b-ace2-057e0cf58127` |
| Maya Lindqvist | Astrid (unchanged) | `bdaaedfa-00f2-417a-8239-8bb89adec682` |
| James Holloway | Marcus (unchanged) | `c8601ae3-9686-4f1f-8e32-7499b470f6b5` |
| Aisha Rahman | Antonia (unchanged) | `a7eb25e8-8c31-460d-a397-8cd8010c76d1` |
| Tom Becker | Leo (textured hair, beard, dark t-shirt) | `d73415e3-d624-45a6-a461-0df1580e73d6` |

  Voices are unchanged. Custom agents now match realistic avatars too (in the test, Olivia and Micah).

### No keys or ids in the UI
- **`AnamTag`** shows only the avatar's face, name and voice name. The ids, the click-to-copy and the id tooltip are removed.
- **Custom panel:** the "Anam avatar id" text field is removed. Custom agents are matched automatically. Ids still live in code (`personas.ts`) and in this log, never on screen.
- **New `server/src/redact.ts`**, mounted on `/api` in `server/src/index.ts` (one line):
  - Every API response is scrubbed of the values of `.env` variables named …KEY, …SECRET, …TOKEN or …PASSWORD; they're replaced with `[redacted]`.
  - The routes never send keys on purpose. This catches upstream error messages that the UI displays (media errors, transcript errors, avatar badge tooltips).
  - Per-request tokens the browser needs (Anam session token, Scribe single-use token) aren't in `.env` and pass through unchanged.
  - **Note for Jihu:** this covers `res.json` / `res.send`, not `res.write`, so the SSE stream in `/api/eval/final` is not scrubbed. It only carries Claude text.

### Verified
- **Middleware:** a fake key inside an upstream error was returned as `[redacted]`.
- **`vite build` output** (11 files): no `.env` secret values (`ANAM_API_KEY`, `ELEVENLABS_API_KEY`, `SYNTHESIA_API_KEY`). The client never reads keys; Vite only exposes `VITE_*` variables, and there are none.
- **Live API responses** (status, sessions, media assets, anam-options, anam-match, scribe-token): no secret values.
- **Real UI** (headless Chrome):
  - The setup screen on all four panels, and the live session, contain no UUIDs and no key-like text in visible text, tooltips or inputs.
  - All three investors went live, as photorealistic people (screenshot checked).

### Files
- `server/src/avatar.ts`, `server/src/redact.ts` (new), `server/src/index.ts` (mounts the redaction)
- `web/src/personas.ts`, `web/src/avatar/AnamTag.tsx`, `web/src/components/Setup.tsx`, `web/src/index.css`, `README.md`

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
