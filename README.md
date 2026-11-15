# Pitch Perfect

Rehearse in front of an AI panel that listens, watches and pushes back, then see exactly how you came across, moment by moment.

Built at the Imperial College AI Hackathon (Voice, Vision and Generative Media track).

## Why we built it

Before writing any code, we talked to other participants at the hackathon and to several of the judging and mentor panels. The same pain point came up again and again: there is no good place to practise communicating in different situations, whether that's a seed pitch to sceptical investors, a job interview or a talk to peers. People rehearse alone, to a wall or a mirror. There's no reaction while you speak, no awkward follow-up question, and no honest account of how you came across. Coaching is expensive, and friends are too kind.

Pitch Perfect gives you the room: a panel that reacts, questions you and remembers what you said, and a report that shows you why.

## What it does

1. **Landing.** Explains the product, then takes you to setup or your past sessions.
2. **Setup.** Pick a panel (sceptical investors, friendly peers, an interview panel or a custom one); each session draws a fresh line-up from that panel's pool. Upload slides as a PDF, set the pitch length and number of questions, and optionally paste context such as judging criteria or a job description.
3. **Live session.** Every panelist is a live, talking avatar with its own face, voice and agenda.
   - **Pitch, then questions:** the panel listens while you pitch, then asks follow-ups grounded in what you actually said.
   - **Interactive:** no timer. The panel joins in when you pause, follows up on your answers, and the less patient members may cut in if you ramble.
4. **Report.**
   - An executive summary: an overall score out of 100 with a verdict, and one tile each for eye contact, body language, voice, clarity and timing.
   - Your best moment and the top three things to work on.
   - The recording, with face, hand and body tracking drawn on top. Timestamped feedback follows the video as it plays.
   - "Delivery over time" as a graph, strips or a table, in 5-second steps, with clickable "moments to look at".
   - Content feedback per rubric dimension, and feedback on every answer.
5. **See yourself do it better.**
   - Claude rewrites your weakest passage.
   - ElevenLabs speaks it in a clone of your voice, only with your explicit consent; the clone is deleted straight after.
   - fal lip-syncs it onto a frame of you, so you can watch yourself deliver it better.
6. **Try that answer again.** The panelist asks your weakest question again and you re-answer on camera. Both attempts are scored the same way, with Claude judging them blind in random order, and you see the before-and-after for every measure.
7. **Past sessions.** Every session is saved with its recording. A progress chart tracks your overall score and each category across sessions.

## How it works

```
Browser (React + Vite + TypeScript)                       Server (Node + Express)
──────────────────────────────────────────────────        ───────────────────────────────────────────────
MediaPipe Face/Hand/Pose Landmarker ── gaze, posture,     /api/voice/scribe-token   ElevenLabs single-use token
  gestures, self-touch, mouth movement (7 Hz samples)     /api/eval/transcribe      Audio Isolation → Scribe v2 batch
Web Audio ── loudness, pitch (tonality)                                             (word timestamps, speaker labels)
ElevenLabs Scribe v2 realtime ── live transcript          /api/eval/segment         Claude Haiku: notes per chunk
MediaRecorder ── camera+mic recording                     /api/eval/final           Claude Sonnet: streamed report (SSE)
PDF.js ── slide images and text                           /api/eval/redo            Claude rewrite → voice clone → v3 TTS
                                                                                    → fal lip-sync (SSE progress)
Evaluation engine (web/src/eval)                          /api/eval/retry           Claude blind A/B judgement
  samples → RoomState (every 250 ms) → rule events        /api/eval/retry/say       ElevenLabs Flash TTS (panelist voice)
  → background Claude segments → final scores 0–100       /api/agents/drafts        Claude Haiku: interactive lines
          │                                               /api/llm/*                Claude: questions, structured output
          ├── RoomState drives the interactive panel      /api/avatar/anam-token    Anam session per panelist
          ├── delivery notes → Anam addContext            /api/media/*              fal portraits, rooms, reaction clips
          └── report, playback overlay, retry, redo       /api/sessions             session JSON + recording on disk
```

### Evaluation engine

All of the evaluation code lives in [web/src/eval](web/src/eval) (browser) and [server/src/eval](server/src/eval) (API routes). Every threshold is in one file, [thresholds.ts](web/src/eval/thresholds.ts).

**Signals, measured in the browser.** About seven times a second, MediaPipe gives us face, hand and pose landmarks plus face blendshapes.
- **Gaze** combines head rotation (from the face transformation matrix) with where the irises sit within the eyes. Both are measured relative to a calibration taken during the 5-second countdown, while you look at the panel. The gaze angle is

  $$\theta_{\text{gaze}} = \theta_{\text{head}} + \arcsin\left(2.5\,\delta_{\text{iris}}\right) - \theta_{0}$$

  where $\delta_{\text{iris}}$ is the iris offset from the eye centre and $\theta_0$ is the calibrated "looking at the panel" angle.
- **Body language** has six parts: posture (slouch, shoulder tilt, torso facing), openness (arms crossed, hands hidden), gestures while speaking, self-touch and fidgeting, sway, and facial expression.
- **Visibility penalty.** If your hands or shoulders are out of view for long stretches, the body score loses up to 30 points. Without this, hiding them would just leave those parts unscored.
- **Gesture and word clashes.** A thumbs-up while describing a problem is flagged as a gesture that contradicts what you are saying.

**Whose voice is it?** The mic hears the panel through the speakers as well as you. Voice only counts as yours when your mouth is moving, using the jaw-open blendshape relative to your own resting level. After the session, the audio is cleaned with ElevenLabs Audio Isolation and transcribed with speaker labels, and we keep the speaker whose words line up with your mouth movement. A silent session can't score highly from room noise.

**Scores.** Every category is scored 0–100.
- **Overall** is a weighted mean over whatever could be measured:

  $$S = \frac{\sum_{c} w_c\,s_c}{\sum_{c} w_c}, \qquad w = \{\text{clarity } 0.35,\ \text{voice } 0.20,\ \text{eye } 0.15,\ \text{body } 0.15,\ \text{timing } 0.15\}$$

- **Eye contact** is strict. With $p$ the share of frames looking at the panel:

  $$s_{\text{eye}} = 20 + 80\cdot\frac{p - 0.5}{0.45} - \text{(longest look-away penalty)} - \text{(darting penalty)}$$

  clamped to 0–100.
- **Pace** is measured only over sustained runs of your own speech. **Fillers** are counted verbatim; the transcriber keeps "um" and "uh".
- **Clarity** blends Claude's judgement (65%) with a filler-and-hesitation measure (35%).
- **Minimum speech:** below 10 seconds of your own speech, nothing is scored, and the report says why.

**Claude as the judge.**
- **During the session:** after each Q&A exchange (or every 45 seconds), a small, fast model (Claude Haiku) reviews that chunk in the background and returns timestamped notes and a clarity score.
- **At the end:** one streamed call to Claude Sonnet merges the segments into the summary, the top three priorities, key moments and the content rubric. The report starts rendering while it streams.
- **How it's called:** both calls use structured outputs validated with zod, an anchored 20/60/100 rubric as a cached system prompt, and server-side model fallbacks.

**Calibration.** We tuned the rules against recordings of five strong and five weak speakers, adjusting each threshold until the scores matched the gap between them. `npm run eval:calibrate` re-scores saved sessions offline.

### The panel

**Live avatars.** Every agent on the panel is a live Anam avatar with its own face and voice.
- One session per agent opens in parallel during the countdown. Each idles while it listens, then says exactly the text we send (`talk`). Anam's own LLM is off (`CUSTOMER_CLIENT_V1`), so our orchestrator owns the brain.
- What the camera sees ("looked away for 4 seconds", "arms crossed") is passed to the avatars silently with `addContext`, so the panel can react to your delivery as well as your words.
- An agent whose session fails falls back to its portrait and browser speech, so the demo never stalls.
- Code: [web/src/avatar](web/src/avatar), [server/src/avatar.ts](server/src/avatar.ts).

**Interactive sessions.** An orchestrator ([web/src/agents](web/src/agents)) checks every 300 ms whether anyone should speak, using the evaluation engine's live `RoomState`: silence, end-of-thought probability, monologue length and rambling.
- **When they speak:** polite agents speak when you pause. Interrupters cut in when you exceed their patience or make an unsupported claim.
- **Panel etiquette:** one voice at a time, at most one interruption every 45 seconds, and agents build on each other.
- **Fast lines:** lines are drafted by Claude Haiku in the background, so replies stay fast.

**Voice agent.** Without Anam, one ElevenLabs Conversational AI agent can play every panelist.
- **Personas:** each persona is injected through dynamic variables, with a voice override per persona.
- **Client tools:** `get_transcript`, `get_slide`, `get_metrics_summary`, `log_answer_assessment` and `end_qna` run in the browser.

**Faces and reactions.**
- **Portraits:** fal generates each panelist's portrait and the room. With a Synthesia key, panelists can use Synthesia stock avatars and short intro clips instead.
- **Silent reactions:** during the silent pitch, portraits play short fal image-to-video reaction clips (nod, smile, sceptical look).

### Model choices

The biggest model isn't always the best one. Anything on the critical path of a live conversation uses a small, fast model:
- Claude Haiku drafts the interactive lines and judges segments in the background.
- ElevenLabs Flash speaks retry questions.
- Scribe realtime does the live transcript.

The larger Claude Sonnet runs only where quality matters more than latency: the final report, the rewrite and the blind retry judgement. Every model is configurable in `.env` (`AGENTS_MODEL`, `EVAL_SEGMENT_MODEL`, `EVAL_FINAL_MODEL`, `ANTHROPIC_MODEL`).

### Privacy

- **Video stays local:** it's analysed in your browser with MediaPipe and is never uploaded for analysis. Recordings are stored only on your own server, for playback.
- **What leaves the browser:** audio goes to ElevenLabs for transcription, and transcripts go to Claude.
- **Opt-in only:** your voice is cloned only if you tick the consent box, and the clone is deleted right after use. "Try that answer again" keeps its recording in the browser tab.
- **Keys:** keys live only in `.env`, and every `/api` response is scrubbed of secret values.

## Running it

Requirements: Node 20 or later and Chrome.

```bash
npm run setup                 # installs server and web, downloads MediaPipe models for offline use
cp .env.example .env          # add your keys (each one is optional; missing ones use a fallback)
npm run create-agent          # optional: creates the ElevenLabs voice agent; paste ELEVENLABS_AGENT_ID into .env
npm run dev:server            # terminal 1, http://localhost:8787
npm run dev:web               # terminal 2, open http://localhost:5173
```

Other scripts:
- `npm run typecheck` and `npm run eval:typecheck`: typecheck the server, web app and evaluation CLI.
- `npm run eval:calibrate`: re-score saved sessions with the current thresholds.
- `npm run build` then `npm start`: serve the production build from the server.

What works without which key:

| Missing key | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Built-in questions; the report scores measured delivery only (clarity is not scored) |
| `ELEVENLABS_API_KEY` | No transcript, so pace, fillers and pauses can't be measured; no voice clone or retry voice |
| `ELEVENLABS_AGENT_ID` | Questions read by the avatars or the browser instead of the voice agent |
| `ANAM_API_KEY` | Portraits and browser voice instead of live avatars |
| `FAL_KEY` | Initials instead of portraits, plain backdrop, CSS reactions; "do it better" gives audio only |
| `SYNTHESIA_API_KEY` | fal portraits instead of Synthesia faces, no intro clips |
| `ANTHROPIC_WORKSPACE_ID` | Only needed if your key isn't scoped to a workspace |

**Demo backup.** Every session is saved with its recording and opens at `/#/report/<id>`, so a good earlier run can be shown if the network fails.

## Project structure

```
web/src/
  components/      Landing, Setup, Session, Report, History (past sessions), DeliveryTimeline, Chrome
  eval/            evaluation engine: signals, calibration, transcript, rules, scores, judge client,
                   playback overlay, feedback panels, "do it better", "try that answer again"
  agents/          interactive panel orchestrator and floor manager
  avatar/          Anam drivers, speakAs, panel avatars
  lib/             media, Q&A, recorder, PDF
server/src/
  eval/            judge (segment, final), transcribe (isolation + diarization), redo, retry
  agents.ts llm.ts avatar.ts voice.ts media.ts synthesia.ts sessions.ts
updates/           each teammate's change log
```

## How it qualifies for each prize

- **Best ElevenLabs project.** We use ElevenLabs nearly end to end:
  - Scribe v2 realtime for the live transcript that drives the panel.
  - Scribe v2 batch with speaker labels, after Audio Isolation, so only the speaker's own words are scored.
  - Instant voice cloning, with consent and deleted after use, plus Eleven v3 to speak "the better version" in your own voice.
  - Flash for the panelist asking a retry question.
  - A Conversational AI agent with per-persona voices and five client tools that fact-check the speaker mid-conversation.
- **Best use of Anam.** The whole panel is live Anam avatars from the countdown to the end, one session per agent, each with its own face and voice.
  - We drive them with `talk` from our own orchestrator, logging the latency of every line.
  - We feed them what the camera sees with `addContext`, so the panel reacts to body language as well as words.
- **Best use of fal.**
  - fal generates every panelist's portrait and the room for each panel type.
  - It animates silent reaction clips.
  - It lip-syncs "the better version" onto the speaker's own face, so they see themselves do it better.
- **Best-designed AI product.**
  - One primary action per screen and an honest, explainable report: every score shows its parts, and every note is tied to a moment you can click.
  - Feedback works as a loop: see it, see it done better, then try again and see the improvement.
  - Light and dark mode, reduced-motion support, and clear empty and error states throughout.

## APIs, models and libraries

- **Anthropic:** Claude Haiku 5.5 (live segments, interactive drafts), Claude Sonnet 5.5 (final report, rewrite, retry judge), Claude Opus 5.5 (questions, by default). Structured outputs, prompt caching, server-side fallbacks. `@anthropic-ai/sdk`, zod.
- **ElevenLabs:**
  - Speech to text: Scribe v2 realtime and Scribe v2 batch (with diarization).
  - Audio: Audio Isolation, Instant Voice Cloning.
  - Text to speech: Eleven v3, Flash v2.5.
  - Conversational AI.
  - SDKs: `@elevenlabs/client`, `@elevenlabs/elevenlabs-js`.
- **Anam:** talk-driven avatar streaming (`CUSTOMER_CLIENT_V1`), `addContext`, Director Notes. `@anam-ai/js-sdk`.
- **fal:**
  - Images: `fal-ai/flux/schnell`.
  - Reaction clips: `bytedance/seedance-2.0/fast/image-to-video`.
  - Lip-sync: `minimax/h3-max/lip-sync/image-to-video`.
  - SDK: `@fal-ai/client`.
- **Synthesia:** stock avatars and intro clips.
- **Google MediaPipe Tasks Vision:** Face Landmarker (with blendshapes and transformation matrix), Hand Landmarker, Pose Landmarker. `@mediapipe/tasks-vision`.
- **Mozilla PDF.js:** `pdfjs-dist`.
- **Other:** React, Vite, TypeScript, Express, multer, dotenv, tsx.
- **Datasets:** none.

All project code was written during the hackathon.
