# Jihu: evaluation engine (Person 1)

## Files I own (please ask before editing)

- `web/src/eval/**`: all client-side evaluation code
- `server/src/eval/**`: evaluation API routes (`/api/eval/*`), including the Claude judge

## Log

### 2026-11-14: optional Anthropic workspace header

- Claude calls failed with `400 … API key is not scoped to a workspace … must include the anthropic-workspace-id header`.
- If `ANTHROPIC_WORKSPACE_ID` is set in `.env`, it is now sent as the `anthropic-workspace-id` header by both Anthropic clients:
  - `server/src/eval/judge.ts` (mine)
  - `server/src/llm.ts` (shared: the `/questions` route hit the same error; only the client constructor changed)
- Added to `.env.example`. With the variable unset, nothing changes.

### 2026-11-14: fix round 2: mouth gate too loose, Body 0, contradictory tip

- **The 17:44 session still scored Tone 100.**
  - The mouth gate (jaw range > 0.04 over 0.7s) passed on 50% of frames, from model jitter, head turns and face touches.
  - 101 frames with no face (turned away, hand over face) fell back to mic-only.
  - Together that made 32s of "speech".
- **Mouth gate (`signals/sampler.ts`):**
  - Over 1s, jaw range must be > `mouthMoveMin` (0.08) **and** jaw opening must be > `mouthOpenMin` (0.08) above the speaker's resting level (20th percentile over 10s).
  - If a face was seen in the last 10s, a missing face counts as "not speaking". Mic-only fallback applies only when no face has been seen recently (camera off).
  - Samples now store the raw `jawOpen`, so the gate can be tuned and re-applied offline.
- **Body 0:** face-touch flicker counted as many touches. Touches are now counted as episodes (3s gap), and the penalty is capped at 30. Re-scored, that session's body goes from 0 to 55.
- **"What to work on":** the fallback tips (no Claude) are now built from the measured category scores under 70, each with a matching tip and a jump to its worst event. Before, they came from the old delivery notes and could say "Good connection" for a weak score.
- Fixed the ".." in the content notice. The debug page shows "Jaw open (raw)".
- **Not yet tuned on a real face:** the mouth thresholds still need a calibration recording (silent, then talking).

### 2026-11-14: fix: silent sessions got high scores (room voices counted as the speaker)

- **Cause:** a 77-second session with no words spoken scored Tone 95, Tonality 100, Eye 79 and Gestures 90. During the pitch, before any panel line, the mic marked "speaking" in 325 of 538 frames. Background voices in the room were taken as the speaker. With no transcript there was nothing to cross-check, and eye, body and timing were scored even though the speaker never spoke.
- **Mouth gate (`signals/sampler.ts`, `signals/vision.ts`):** voice activity counts as the speaker only when their mouth is moving (`jawOpen` range over 0.7s > `T.voice.mouthMoveMin`). Pitch is kept only for the speaker's own voice. With no face visible it falls back to the mic, except while a panel voice is playing. New `SampleX` fields: `mouthMoving` and `micVoice` (raw mic activity).
- **Panel leakage (`assemble.ts`):** transcript lines heard during a panel line are dropped unless the speaker's mouth moved. This addresses Guanyi's note about panel audio being transcribed. I chose this over muting the transcriber, so talk-over can still be measured.
- **Speech gate:**
  - With under `T.minSpeechSec` (10s) of the speaker's own speech, all categories are unmeasured, timing is null, `scoreSeries` is empty, Claude isn't called, and the old per-signal bars show "Not scored".
  - New `EvaluationResult` fields: `insufficientSpeech` and `userSpeechSec`.
  - `timingScore` is now `number | null`; it's null without a transcript.
- **Eye contact** is scored while the speaker talks or is being addressed (panel turn + 2s), not while standing silent.
- **Report (`Report.tsx`):**
  - Unmeasured categories show "–" (not "Coherency 0").
  - The "not enough speech" notice says how much speech was heard.
  - The content notice gives the real reason ("Claude is not configured…"), not "Skipped".
- **Old sessions:** samples saved before this fix (with no `mouthMoving` field) don't count as evidence of speech when re-scored.
- **Debug page:** shows "Mic hears a voice", "Mouth moving" and "Speaking (you)".
- **Verified:**
  - A normal fake pitch still scores (overall 86).
  - A silent speaker in a loud room gets nothing scored, timing "–", and no series.
  - A leaked panel line is dropped while all real lines are kept.
  - The three real silent sessions now re-score as unmeasured.
  - Web, server and CLI typecheck, and the build passes.
- **Pulled** Guanyi's "live caption" (4d5a406) first. It doesn't touch my files.

### 2026-11-14: tracking debug page with MediaPipe visualisation

- **New page at `/#/eval-debug`:** the webcam with face, hand and body landmarks drawn on top, colour-coded by the evaluation's reading:
  - face outline green or red = gaze on or off target
  - hands amber = touching the face
  - forearms red = arms crossed
  - shoulder line amber = slouching

  Next to it are live readings: eye contact, body language, voice, RoomState, rolling 10-second scores, and rule events as they fire. There is a 5-second calibrate button and layer toggles. No keys are needed, and nothing is recorded.
- **New files:**
  - `web/src/eval/debug/TrackingOverlay.tsx`: a reusable canvas overlay for any `<video>` with a `VisionTracker`. It could go on the self-view or in the playback screen.
  - `web/src/eval/debug/TrackingDebug.tsx`: the page.
- **`web/src/eval/signals/vision.ts`:** each frame now keeps its raw landmarks (`raw`) for drawing.
- **Fix in `vision.ts`, which also affects the practice session in development:** under React StrictMode, a start, stop, start sequence ran two detection loops, and the first was never cleared. A generation counter now cancels starts that were superseded.
- **Shared file:** `web/src/App.tsx` gets one route (`#/eval-debug`). Nothing else changed.
- **Verified:** headless Chrome with a fake camera. The page renders, the camera starts, the canvas sizes to the video (1280×720), readings update, and there are no runtime errors. Not yet tried with a real face.

### 2026-11-14: merged Guanyi's "one avatar" (77f8a50) into `jihu/evaluation-engine`

- I read `updates/Guanyi.md` first.
- **Conflicts resolved:**
  - `Session.tsx`: kept both sides. During the countdown the avatar warms up and calibration runs.
  - `Audience.tsx`: `REACTION_LABEL` now comes from `lib/reactions`.
- **Spoken Q&A mode** (`speakAs`) never fires `onSpeaking`, so `Session.tsx` now wraps `ctx.say` to log each agent line as an `AgentTurn`. The turn starts at first audio (`latencyMs`), ends when the speech ends, and keeps the `interrupted` flag.
- **Voice-agent mode** still logs turns through `onSpeaking` and `onCaption`.
- **API change:** `EvalSession.agentSpeaking()` takes an optional `{ startAt, interrupted }` when it closes a turn.
- **Checks:** web, server and CLI typecheck, `vite build` passes, and the calibration tool runs.

### 2026-11-14: evaluation engine moved into `web/src/eval/`, scores now 0–100

**Moved (git mv, history kept)**

| Was | Now |
| --- | --- |
| `web/src/lib/metrics.ts` | `web/src/eval/metrics.ts` |
| `web/src/lib/evaluate.ts` | `web/src/eval/evaluate.ts` |
| `web/src/lib/liveEvents.ts` | `web/src/eval/liveEvents.ts` (audience-reaction engine only) |
| `web/src/lib/liveTranscript.ts` | `web/src/eval/transcript/liveTranscript.ts` |
| `web/src/lib/vision.ts` | `web/src/eval/signals/vision.ts` |
| `web/src/lib/audioFeatures.ts` | `web/src/eval/signals/audio.ts` |
| `/api/llm/evaluate` in `server/src/llm.ts` | `/api/eval/segment` + `/api/eval/final` in `server/src/eval/judge.ts` |

`chooseReaction` and `REACTION_LABEL` are panel behaviour, not evaluation, so they moved to a new file, `web/src/lib/reactions.ts`.

**New files in `web/src/eval/`**

- `contracts.ts`: the brief's `Sample`, `Phrase`, `RoomState`, `Ledger`, `AgentTurn` and `FeedbackEvent` types, copied verbatim, plus `EvaluationResult`. When `shared/types.ts` exists, I'll switch to re-exporting from it.
- `thresholds.ts`: every tunable number, in one place.
- `signals/`:
  - `vision.ts` now also uses face blendshapes (eyeLook, smile), the head-pose matrix (yaw and pitch in degrees) and the Pose model (arms crossed, slouch). It also detects face touches.
  - `audio.ts` adds a `speaking` flag that adapts to background noise.
  - `sampler.ts` merges vision and audio into one `Sample`, about 7 times a second.
  - `useSignals.ts` is the brief's hook.
- `calibration.ts`: baseline for eyes and posture, captured during the countdown.
- `transcript/`: `Phrase` built from each Scribe commit. Scribe now runs verbatim (`noVerbatim: false`) with a 0.5s silence threshold. Filler detection now tells filler "like" apart from real use.
- `roomState.ts`: `computeRoomState()`. `endOfThoughtProb` combines silence length, how the last sentence ended and falling pitch, with a slot for the LiveKit turn detector. `ramblingScore` combines monologue length, fillers, repetition and run-on sentences.
- `rules.ts`: the brief's live rules (look-away over 3s, arms crossed over 5s, 3+ fillers in 10s, flat pitch over 20s, monologue over 90s, face touch), plus slouching, pace, and good moments. Overlapping events in the same category are merged.
- `timing.ts`: longest monologue, talk ratio, and per answer the latency, length, talk-over time and bridge-back time.
- `scores.ts`: `scoreSeries` (rolling 10s, one value per second) and `finalScores`, all 0–100.
- `assemble.ts`: pure function that builds an `EvaluationResult`.
- `judge.ts`: background Claude segments (every 45s, or after each Q&A exchange) and the streamed final merge.
- `runtime.ts`: `EvalSession`, the single object the live screen uses.
- `fake.ts`: deterministic fake session, `replayLive()`, `fakeEvaluation()` (a complete fixture) and `playFake()` (a real-time stream).
- `cli/calibrate.ts`: re-scores saved sessions offline, for tuning thresholds.
- `index.ts`: public exports. Please import from `web/src/eval`.

**Shared files I edited**

- `web/src/components/Session.tsx`:
  - Uses `EvalSession` in place of the separate meter, vision tracker and transcriber.
  - Countdown is now 5s and doubles as calibration ("Look at the panel and stand naturally").
  - Calls `evalRt.markPitchEnded()` at the end of the pitch, and `agentSpeaking` / `agentCaption` / `exchangeEnded` during Q&A.
  - In `finish()`, sets `session.evaluation` and `session.report`.
- `web/src/components/Report.tsx`:
  - Scores display 0–100. Old saved 0–10 reports still display correctly, scaled by `report.scale`.
  - The caption under the score shows eye, body, tone, coherency and timing.
  - Renamed one shadowed variable.
- `web/src/components/Audience.tsx`, `Sparkline.tsx`, `web/src/App.tsx`: import paths only.
- `web/src/types.ts`:
  - `ContentEvaluation` and `DimensionScore` are now re-exported from `eval/contracts.ts`.
  - Added `SessionData.evaluation?` and `Report.scale?`.
  - `DeliveryScore.score` is now 0–100.
- `server/src/index.ts`: mounts `/api/eval`. `server/src/llm.ts`: the old evaluate route is removed (`/questions` is unchanged).
- `scripts/fetch-vision-assets.mjs`: also downloads `pose_landmarker_lite.task`.
- `web/tsconfig.app.json`: excludes `src/eval/cli`, which is Node-only and has its own tsconfig.
- Root `package.json`: added `eval:calibrate` and `eval:typecheck`.
- `.env.example`: added `EVAL_SEGMENT_MODEL` (default `claude-haiku-5-5`) and `EVAL_FINAL_MODEL` (default `claude-sonnet-5-5`).

**How to plug in**

- **Agents (Person 2):**
  - Subscribe through `new EvalSession({ ..., onRoomState })`, or read `evalRt.roomState`; it updates every 250ms.
  - Push your turns with `evalRt.addAgentTurn(turn)`, or use the `agentSpeaking(on, agent)` hooks.
  - The turn detector plugs in as `turnDetector: () => prob`.
  - Without a camera, mic or keys, `playFake({ onSample, onPhrase, onRoomState })` streams realistic data.
- **UI (Person 3):** `session.evaluation` contains:
  - `events` (`FeedbackEvent[]`, with `t` and `end` ready for the overlay)
  - `scoreSeries[cat][Math.floor(t)]`
  - `finalScores`, `unmeasured`
  - `timing`, `coaching.top3`
  - `samples`, `transcript`, `agentTurns`

  `fakeEvaluation()` gives a complete example without recording anything. `buildReport(..., { onDelta })` streams the final judge's raw text, for a "writing your tips" indicator.
- **Infra (Person 4):** the Claude routes are `POST /api/eval/segment` (JSON) and `POST /api/eval/final` (server-sent events: `delta`, then `result` or `error`). Both use the existing `ANTHROPIC_API_KEY`.

**Verified**

- The web app, server and CLI typecheck, and `vite build` passes.
- On fake data, the rules fire at the planted problems:
  - look-away at 40s
  - arms crossed at 60s
  - face touch at 75s
  - flat pitch at 76–96s
  - fillers
  - the 90s monologue
- After "happy to take any questions", `endOfThoughtProb` passes the polite-agent threshold about 1.5–2.5s later.
- With no API key, `/api/eval/*` returns clean errors and the report falls back to measured scores only.

**Not yet verified**

- A real Claude judge call. No `.env` existed, so this needs `ANTHROPIC_API_KEY`.
- A live session in Chrome with a camera.
- Calibration on real team recordings.

**Notes and limitations**

- The brief asks for "temperature 0", but current Claude models reject non-default temperature. The judge uses structured outputs and an anchored 1/3/5 rubric instead. The rubric is a cached system block.
- Head and eye thresholds are relative to the countdown calibration. If the speaker doesn't look at the panel during the countdown, eye contact is measured against the wrong target.
- Bridge-back is a keyword heuristic. Claude also comments on it in the final merge.
