# Jihu: evaluation engine (Person 1)

## Files I own (please ask before editing)

- `web/src/eval/**`: all client-side evaluation code
- `server/src/eval/**`: evaluation API routes (`/api/eval/*`), including the Claude judge

## Log

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
