# Jihu: evaluation engine (Person 1)

## Files I own (please ask before editing)

- `web/src/eval/**`: all client-side evaluation code
- `server/src/eval/**`: evaluation API routes (`/api/eval/*`), including the Claude judge

## Log

### 2026-11-15: 5-second steps, a penalty for hidden body or hands, graph as default

- **5-second steps:** "Delivery over time" (graph, strips, table) now uses 5s windows instead of 10 or 15 (`Report.tsx`).
  - Tone of voice needed 40 voiced samples per window, about 6s, so a 5s window could never be measured. `pitchSpread` and `expressiveness` (`eval/metrics.ts`) take an optional minimum, and the chart uses `T.minVoicedWindow` = 15 (about 2s of voice). The overall tone score keeps `T.minVoicedSamples`.
  - The pace verdict now uses the whole pitch (`paceAll`), not the mean of 5s windows, which was noisy (194 vs 228 wpm on the same session).
  - The rolling `scoreSeries` (the scores beside the recording) stays at 10s. Tone can't be judged in 5s.
- **Penalty when the camera can't see the body or hands** (`eval/scores.ts`, `T.body.visibility`):
  - Before, hidden hands or shoulders only made those parts unmeasured, which could even raise the body score.
  - New `visibilityPenalty()`, subtracted in `bodyScore()`:
    - Hands out of view: up to 20 points, ramping from 40% to 90% of speaking time (or of all frames with a face, when there's little speech).
    - Shoulders out of view: up to 15 points, ramping from 30% to 80%.
    - A single stretch of 15s or more without them: plus 5 each.
    - The total is capped at 30. It applies to the final body score and the rolling series.
  - **New live rules** (`eval/rules.ts`) so the report explains the deduction:
    - "Hands out of view for Xs. Keep them in frame so the panel sees your gestures." Fires after 15s with the face in view and no hands; becomes a problem after 30s.
    - "Shoulders out of view for Xs. Sit or stand back so the camera sees your upper body." Fires after 10s.
  - **Offline check on the 15 saved sessions:**
    - Hands hidden 81–100% of the time: minus 20 to 25.
    - Hands visible most of the time: no penalty.
    - The shoulders were always visible, so there was no shoulder penalty.
- **Graph is the default view** in "Delivery over time". The order is Graph, Strips, Table. The remembered choice moved to a new key, `dt-view-v2`, so earlier picks don't hide the default.
- **Verified:** web and eval CLI typecheck; `vite build`; headless screenshot of a real session with Graph default, 12 points for 56s, and no errors.

### 2026-11-15: "Delivery over time" redesigned as status strips

**Heads-up @Guanyi: I rewrote the drawing in your `web/src/components/DeliveryTimeline.tsx` (requested by me). The props, `TimelineRow`, the table view, tooltip, crosshair, playhead and click-to-seek all still work.**

- **Why:** each row had its own y-scale to decode, the red and black dots had no legend, and text overlapped (the "Not measured" message on the band, the filler bars over the word "fine").
- **Now:**
  - Each signal is a strip with one cell per 10s (or 15s) window. The cell is coloured on target, a bit off, off target, or hatched for not measured, and its value is written inside ("232 · fast", "94%", "2 fillers", "still"). Narrow cells show just the number; the tooltip has the full value.
  - Pauses are green circles (deliberate) and red triangles (hesitant), so the shape tells them apart as well as the colour.
  - A legend at the top names every state.
  - **Moments to look at:** up to 4 clickable chips for the worst off-target stretches, merged across consecutive windows (for example "Speaking too fast 0:00–0:30", "Looking away 0:50–0:56", "3 hesitant pauses"). Each jumps the recording there.
  - The tooltip shows a status swatch per signal; the table adds "on target / a bit off / off target" per cell.
- **Graph view kept (follow-up):** a **Strips | Graph | Table** switch, defaulting to Strips. The choice is remembered per browser in `localStorage`, wrapped in try/catch.
  - Graph shows the line or bar charts on their own y-scales, with the target range as a shaded band (explained in the legend rather than labelled in the plot).
  - Each point or bar is coloured by the same status as the strips.
  - "Not measured" rows are a hatched block, so the message no longer overlaps the band.
  - Pauses use the same circle and triangle shapes.
  - The moments chips, crosshair, tooltip, playhead and click-to-seek work in both views. Screenshots checked in light and dark, with no overflow at 390px.
- **New optional `TimelineRow` fields:**
  - `status(v)`: good, warn or bad for one window. Defaults to the band.
  - `cell(v)`: short cell text.
  - `drift(v)`: chip phrase.
- **Per-window rules, set in `Report.tsx` `deliveryRows`:**
  - Eye contact: 60% or more is on target; 45–60% is a bit off.
  - Gestures: natural is on target; still, or busy up to 0.9, is a bit off.
  - Tone: 0.45 or more is on target; 0.3–0.45 is a bit off.
  - Pace: 130–165 wpm is on target; 110–185 is a bit off.
  - Fillers: 0 is on target; up to 1 per 10s is a bit off.
- **`index.css`:** removed the unused line, dot, bar and band `.dt-*` rules; added cell, legend, moment and pause-key styles using the mint, amber and coral soft tokens. Light and dark both checked.
- **Verified:** typecheck, eval CLI typecheck and `vite build` pass. Headless Chrome screenshots of two real sessions in light and dark: the chips merge correctly and the tooltip works. No overflow at 390px. No errors.

### 2026-11-15: "Try that answer again" (practice loop on the report)

On the report you pick a weak answer (or your weakest pitch passage), the panelist asks the question again out loud, you answer on camera, and the report shows the original and the retry side by side, measured the same way.

- **New `web/src/eval/retry/retry.ts`:**
  - `retryTargets()` picks up to 3 Q&A answers, weakest first (no answer, then the lowest Claude `qna_feedback` score), plus the weakest pitch passage (the same `pickPassage` as "do it better").
  - `measure()` scores any time window with the report's own functions (`eyeScore`, `bodyScore`, `toneScore`, `coherencyProxy`, `wpmIn`, fillers), so before and after are like for like.
  - `attemptOverall()` uses the report's overall weights without timing.
  - `compareRows()` and `improvement()` drive the table. Pace counts as better when it moves towards 130–160 wpm; fillers are compared per minute.
- **New `web/src/eval/retry/capture.ts`:**
  - `RetryCapture` uses the same VisionTracker, AudioMeter, SignalSampler and LiveTranscript as a session, with a 3s calibration during the countdown and a local recording of the attempt.
  - `askAloud()` speaks the question in the panelist's ElevenLabs voice, falling back to the browser's voice.
- **New `web/src/eval/playback/TryAgain.tsx`:**
  - The report card has target pills, the question, your original answer and what to fix.
  - The result shows overall before → after with the change, a before/after/change table (clarity, eye contact, body language, voice, pace, filler words, length), "what got better", "next time", a replay of the attempt and both transcripts.
  - The recording overlay runs: camera → 3, 2, 1 → the panelist asks (with a **Skip to my answer** button) → your turn → stops on its own after a 5s pause once 8 or more words are said (or at 90s, or on **Done**) → scoring.
  - Clear errors for camera or mic blocked, the transcriber failing, and fewer than 6 words heard.
- **New `server/src/eval/retry.ts`**, mounted in `server/src/eval/routes.ts`:
  - `POST /api/eval/retry/say`: ElevenLabs `eleven_flash_v2_5` text to speech for the question.
  - `POST /api/eval/retry`: Claude (`EVAL_FINAL_MODEL`, default Sonnet 5.5) scores both attempts **blind**. The original and the retry are randomly labelled A and B, so the model can't favour the newer one. It uses an anchored 20/60/100 rubric (answers the question, leads with the point, specific, concise, clean wording). The attempt is saved to `server/data/sessions/<id>/retries.json`.
  - `GET /api/eval/retry/:id` lists saved attempts.
  - Without an Anthropic key, the attempt is still saved and the filler-and-pause measure stands in for clarity.
- **`liveTranscript.ts`:** new `ready` flag, set when the mic audio starts streaming. The overlay says "Your turn" only after it's set.
- **Shared files (small edits):**
  - `web/src/components/Report.tsx`: renders `<TryAgain>` after "See yourself do it better", and adds a "Try your weakest answer again" button under "What to work on" that scrolls to it.
  - `web/src/index.css`: `.ta-*` styles. Light and dark come from the existing tokens. Single column under 720px; animations are off under reduced motion. Only the live self-view is mirrored; the replay is not (mirroring the element flipped its controls).
- **Privacy:** the retry video stays in the browser tab. Only the transcript and the measured numbers are sent (to Claude for the judgement, and saved with the session).
- **Verified:**
  - Web, server and eval CLI typecheck; `vite build` passes.
  - Real `/retry/say` returns audio/mpeg.
  - A real Claude judgement on a sample pair (4.3s): vague answer 14, specific answer 93, blind order mapped back correctly. The test data was deleted.
  - Headless Chrome on a real session with a mocked attempt: card, table and colours are right, with no overflow at 390px.
  - With a fake camera and mic, the overlay goes countdown → asking → skip → your turn → Done → "We only heard 0 words". No errors.
  - Not yet tested: a real spoken retry with a real face (needs a person in front of the camera).

### 2026-11-15: landing page (first version, requested by me)

**Heads-up, team: the site now opens on a landing page. Setup moved to `#/practice`; report and other routes are unchanged.**

- **New `web/src/components/Landing.tsx`:**
  - The hero image (`web/public/landing/hero.jpg`, a 2400px, 346 KB copy of the Topaz-upscaled `image.jpeg`) is fixed behind a grey overlay that darkens towards the headline.
  - On top: transparent nav (How it works, Past sessions, Start practising), "AI pitch practice" kicker, "Pitch Perfect", mission line, primary and ghost buttons, privacy note, and a bobbing "Learn more" cue.
  - Scrolling brings up a sheet (white in light mode, the theme surface in dark) with rounded top corners that slides over the fixed image. It contains: Why we built it; How it works (3 steps); What you get (6 features with a cyan → violet → magenta top accent); Who it's for; About us + Built with; a gradient final call to action; footer.
- **`App.tsx`:**
  - New `landing` view, shown when the site opens with no hash.
  - "Start practising" goes to `#/practice` (setup). A new `#/practice` route keeps setup on refresh.
  - "Past sessions" goes to `#/sessions`.
- **`index.css`:** `.ld-*` styles. The vivid accents are only on the landing page, not on the scoring pages. Responsive at 900px; reduced motion stops the bobbing arrow and button lift.
- **Verified in headless Chrome:**
  - The background is `position: fixed` and the image loads.
  - Hero, mid-scroll (sheet over image) and footer screenshots, in light and dark.
  - "Start practising" opens setup. No errors.
- **Follow-up:**
  - The logo is now a button. In `TopNav` (`Chrome.tsx`) it goes to `#/`, the landing page; it's disabled in the live session (`wide`) so it can't end a session. On the landing page it scrolls to the top.
  - `App.tsx` routes `#/` and the empty hash to the landing page, so Back from `#/practice` returns there.
  - "Ready when you are" uses a pastel gradient (soft indigo, lavender, pink, aqua) drifting horizontally over 14s (alternating), with dark indigo text and button. It's off under reduced motion.
  - Verified: the logo from setup, past sessions and a report lands on the landing page; Back works; the gradient position moves. No errors.
- **Landing revision:**
  - "Built with" chips moved to one small line in the footer.
  - "A live AI panel" and "See yourself do it better" are now their own spotlight sections. Each has text, ticks and a product mock: the panel tiles with a speaking glow and a caption, and the before/after with fillers struck through. They sit on alternating sides.
  - The generic feature cards (gradient top bars) are replaced by "What we measure": eye contact, body language, voice and clarity, each with an example score, a feedback-coloured bar, how it's measured, and a real-format note ("0:42 · Looked away for 3.4s"). Labelled as examples.
  - The steps lift and zoom on hover or focus (scale 1.04, raised 8px, indigo border, shadow) while the others fade to 70%.
  - "Ready when you are" spans the full width of the sheet.
  - The mock classes are `ld-tile` and `ld-face`, because `.tile .face` belongs to the live session screen.
  - Verified in headless Chrome: hover transform, final CTA 1440/1440px wide, section screenshots. No errors.
  - The panel mock (`PanelMock` in `Landing.tsx`) rotates the speaking panelist every 3s. Each asks a persona-typical question that types out in about 1s with a caret.
  - Tiles are buttons: a click jumps to that panelist and holds for 6s, and hover pauses the rotation. The speaking tile lifts with a glow and a small equaliser. Animations are off under reduced motion.
  - Verified: Priya → Marcus → Elena → Priya at about 3s each; the click hold; hover pauses and leaving resumes. No errors.

### 2026-11-15: Past sessions page (brief §3 "History: past sessions, a scores-over-attempts chart, open any session")

**Heads-up, Derek / Person 3 (UI) and Guanyi (`sessions.ts`, `Setup.tsx`): new page, small edits listed below.**

- **New page `web/src/components/History.tsx` at `/#/sessions`:**
  - Score chips (Overall, Eye contact, Body language, Voice, Clarity, Timing) and a panel filter.
  - Stat tiles: Latest with change vs previous, Best, Average, Sessions with the not-scored count.
  - A single-series progress chart: 2px indigo line, 8px dots ringed in the surface colour, recessive 0–100 grid, hover crosshair and tooltip. Click a dot to open its report. The axis shows times when every session is from one day.
  - A session table: date, title, panel, format, length, questions, overall with verdict, the five category scores, and "Open report".
  - Empty and error states. Responsive at 960px and 600px.
  - Older 0–10 reports are scaled to 0–100.
- **Nav (`Chrome.tsx`):** `TopNav` gets `active: 'past'`. "Past sessions" in Setup and Report now opens this page (Setup used to scroll to its short list).
- **`App.tsx`:** new `history` view and `#/sessions` hash route.
- **`server/src/sessions.ts`:** `GET /api/sessions` also returns `scale`, `notScored`, `panel`, `format`, `duration`, `questions` and `scores` (final scores, timing and unmeasured from the evaluation). Existing fields are unchanged.
- **Verified:**
  - The chart colour passes the dataviz palette validator in both themes.
  - Headless Chrome: the nav tab opens the page, 20 sessions are listed and 13 plotted, the stats are correct, hover shows the tooltip, switching the metric redraws, and "Open report" opens the right report.
  - Light and dark screenshots checked. No errors.
- **Follow-up:**
  - The trend line draws from the left (`pathLength` + dash-offset animation, about 0.15s per session, 0.8–2.4s in total). Each dot pops in as the line reaches it. It replays on metric or panel change and is off under reduced motion.
  - The selected pill has an indigo border, a 14% indigo fill (`color-mix`) and indigo text.
  - The category columns are a five-column grid in both the header and the rows. They had been one text string, so they didn't line up with the header. Verified header and value centres match to 0px.
  - The trend animates only the first time each metric + panel view is opened on a visit. Revisited views show the finished chart instantly (`.hs-chart.static`). The chart marks its view as seen only once it has appeared, and it decides at mount, so hover can't cut the animation. Verified: first Overall, Eye and Body animate; returning to Overall and Eye is static.

### 2026-11-14: report top restructured as an executive summary (requested by me)

**Heads-up, Derek / Person 3: this replaces section 1 of your `Report.tsx`. The rest of the page is unchanged. The new pieces are in my `web/src/eval/playback/ScoreOverview.tsx`, and styles are in `index.css` under `.rp-exec`, `.rp-hero`, `.rp-kpis` and `.rp-details`.**

- **Score hero:** the overall score (64px, /100) with a verdict chip (Excellent 85+, Strong 70+, Developing 50+, otherwise Needs work) and the one-line summary beside it (Claude's summary, else the evaluation's coaching summary).
- **KPI tiles:** Eye contact, Body language, Voice, Clarity, Timing. Each has a large number, a thin bar in its feedback colour, and a status (On track 70+, Improve 50+, Focus here). Unmeasured categories show a dash and "Not measured". These replace the small "Eye 98 · Body 77 …" caption.
- **"Detailed scores":** a disclosure with the existing Content and Delivery bars, collapsed by default (open for old sessions without an evaluation).
- **Not-scored sessions:** a muted dash and a "Not scored" chip. The explanation appears once, in the summary.
- **Responsive:** tiles go 5 → 3 → 2 columns, and the hero stacks under 900px.
- **Verified:** headless Chrome screenshots in light and dark, on a scored session and on a not-scored session. No errors, and braces balance.
- **Follow-up:**
  - "Detailed scores" now starts expanded (state in `Report.tsx`, so the user's toggle survives re-renders during playback).
  - Bars fill up when the report opens: a CSS `rp-grow` scaleX animation, tiles staggered 80ms apart, then the detailed bars row by row. It's off under `prefers-reduced-motion`.
  - Verified in headless Chrome: scaleX goes 0 → 1, details open on load, and closing it survives re-renders.

### 2026-11-14: colour scheme: indigo brand, cool neutrals, feedback colours reserved (requested by me)

**Heads-up, Derek / Person 3: this changes your design tokens in `index.css`. Layout is untouched. Revert or tune as you like.**

- **Why:** the coral brand colour doubled as the "problem" red, so coral buttons and question markers read like warnings. The brand is now **indigo**, and green, amber and red only ever mean good, warning and problem.
- **Tokens (`index.css` `:root` and the dark / `.session` block):**
  - New `--brand`, `--brand-strong`, `--brand-hover` and `--brand-soft` (light `#5b4fe5`, dark `#8b7dff`).
  - `--rp-blue`, `--accent` and `--primary` now point at the brand, so primary buttons are indigo.
  - `--coral` is now the problem red (`#d9483e` / `#e5534b`). `--mint` is good. `--amber` is warning.
  - Neutrals move from warm pink-grey to cool grey: light background `#f6f6f9`, dark `#131218`, surfaces `#1c1a22` and `#25232c`.
- **Brand roles switched from coral to `--brand`:** focus rings, selected-panel dot, question card and question events, logo peak, active tab underline, score header bars, panel caption names. The speaking-tile highlight is indigo instead of green, because speaking isn't "good".
- **Hard-coded warm greys** in the overall card, player controls, seats and badges were swapped for cool equivalents.
- **Assets:** the favicon bar is indigo; the recording dot stays red (the new red).
- **Verified:** braces balance. Headless Chrome screenshots of the report and setup in light and dark, with no errors.

### 2026-11-14: stricter Pauses, Eye contact and Gestures

- **Report order (`Report.tsx`):** "Delivery over time" now sits above "See yourself do it better".
- **Fixed a CSS break I caused** in `index.css`: removing the redo styles left an unclosed `@media (max-width: 720px) {` that swallowed every report rule after it on desktop. That line is back to the committed `.rp-legend` rule.

- **The do-it-better clip returned audio only** because `FAL_KEY` was missing from `.env`, so the lip-sync step was skipped. The voice clone worked and was deleted afterwards. The feature stays: add `FAL_KEY` and restart the server.
- **Pauses (`evaluate.ts`):**
  - Filled pauses ("um", "uh", "er") now count as hesitations alongside silent mid-sentence ones: minus 10 per hesitation per minute, up to 70.
  - Long stalls (over 3s): minus 8 each.
  - Deliberate pauses must land 2–8 a minute: under 1 a minute minus 30, under 2 minus 12, over 10 (choppy) minus 15.
  - Full marks only with no hesitations and deliberate pauses in that range (otherwise capped at 90).
- **Eye contact (`scores.ts`, `thresholds.ts`):**
  - On target narrowed to ±10° left/right and ±12° up/down (was 12°/14°).
  - Score = 20 + (share − 0.5)/0.45 × 80: 50% scores 20, 95% scores 100 (was 30% to 20, 90% to 100).
  - Longest look-away beyond 2s costs 5/s, up to 25 (was beyond 3s). Darting glances over 10 a minute cost 10. Each look-away event costs 4, up to 25 (was 2, up to 20).
- **Gestures (`scores.ts` `bodyBreakdown`):**
  - Ideal band is 35–65% of speaking time (was 30–70%), with a steeper curve outside it.
  - Frantic movement costs ×150, up to 40.
  - The same repeated motion (hand-speed variation under 0.35) costs 10. No open palms or pointing costs 10.
  - Hands visible less than half the time while talking caps it at 80.
- **Re-score of session `20261114231615-a5wo`:** Pauses 100 → 30 (6 um/uh in about 30s), Eye contact 98 → 85, Gestures 100 → 80. The fake pitch's eye and gestures drop the same way, and the silent gate is unchanged.

### 2026-11-14: voice isolator, Anam addContext, gesture vs words, "see yourself do it better"

**Heads-up, Guanyi / Person 2:** small edits in your `drivers.ts`, `panelAvatars.ts`, `orchestrator.ts`, `server/src/agents.ts` and `Session.tsx`, listed below. **Derek / Person 3:** a new section in `Report.tsx` plus CSS.

- **Feedback source hidden:** report tags and on-video notes show only the topic (Eye contact, Body language, …), not "Claude".
- **ElevenLabs Voice Isolator (`server/src/eval/audio.ts`, `POST /api/eval/transcribe`):**
  - After the session, the audio goes through Audio Isolation (room noise and background chatter removed), then Scribe v2 with `diarize: true`.
  - `evaluate.ts` `ownSpeakerWords()` keeps the speaker whose words line up with the user's mouth movement. Panel voices and other people have other speaker ids.
  - `session.words` now holds only the speaker's own words (`liveWords` keeps everything), so every report chart uses them.
  - The isolated voice is saved as `voice.mp3` for the voice clone. If isolation fails, the raw audio is transcribed.
  - `Session.tsx` calls this route instead of `/api/voice/transcribe` (one call changed; timeout 280s). `Word` gets an optional `speaker`.
  - My server routes are combined in `server/src/eval/routes.ts`, and `index.ts` imports from there.
- **Anam `addContext()` + delivery-aware agents:**
  - Anam's own LLM is off in our setup (`CUSTOMER_CLIENT_V1`), so `addContext` alone changes nothing visible. It's wired both ways:
    - `AnamDriver.addContext()` and `PanelAvatars.addContext()`. `Session.tsx` sends each new delivery warning to every live avatar ("[What the panel can see right now] Arms crossed for 5.2s"), at most once per kind every 30s.
    - `EvalSession.deliveryNotes()` (recent eye, body, voice and timing warnings, plus rambling and gaze from RoomState) goes to the orchestrator as `delivery`. `server/src/agents.ts` adds a `<speaker_delivery>` block, and a strict panelist may occasionally react in character ("You keep looking down at your notes"), at most one line.
- **Gesture vs words (`web/src/eval/gestures.ts`):**
  - Hand shapes come from the 21 hand landmarks, independent of rotation: thumbs up or down, pointing, open palm, fist. New `SampleX.gesture`.
  - After the session, each thumbs up or down held 0.4s+ is checked against the sentiment of the words within ±2.5s (pitch lexicon with negation). A contradiction gives a body warning ("Thumbs-up while describing something negative (…). Mixed message."); a match gives a good event. Warnings count towards the body score.
  - Claude also gets the gesture timeline (segments and final) and is asked to flag contradictions the lexicon misses.
- **"See yourself do it better" (`server/src/eval/redo.ts` `POST /api/eval/redo` SSE + `GET /api/eval/redo/:id`; `web/src/eval/playback/DoItBetter.tsx`):** the report picks the weakest passage of the speaker's own words (around Claude's top priority, else the worst voice, clarity or timing warning). Then:
  1. Claude rewrites it.
  2. With a consent checkbox, ElevenLabs instant voice cloning runs on `voice.mp3`, and the clone is deleted straight after. Otherwise a stock voice is used.
  3. Eleven v3 speaks the improved passage.
  4. fal `minimax/h3-max/lip-sync/image-to-video` (480P, about $0.05/s) lip-syncs it onto a frame of the recording where the face looks at the panel.
  - Results are saved as `redo-n.mp4/.mp3/redo.json` and reload with the report. The audio is shown if lip sync fails.
  - New env var `EVAL_LIPSYNC_MODEL`.
- **Verified:**
  - Gesture classifier unit test (all five shapes) and congruence test (contradiction, match, negation).
  - Route validation and error paths.
  - The report renders the redo section on a test copy of a session with the right passage, and an explanation card on a session with too little speech.
  - Topic-only tags. Web, server and CLI typecheck, the build passes, and the silent gate is unchanged.
- **Not run yet:** a real end-to-end redo, transcribe or addContext call. Those send the user's voice and face to ElevenLabs and fal and spend credits, so they should be triggered by the user.

### 2026-11-14: the report shows the evaluation (brief §3 feedback player)

**Heads-up, Derek / Person 3: wiring in your `Report.tsx` and `index.css`. The logic lives in my `web/src/eval/playback/FeedbackPanels.tsx`.**

- **Session events list:** now the evaluation's feedback events (rule and Claude, left border coloured by severity, with a category or "Claude · …" tag) plus milestones (questions, slide changes, pitch end), in time order. Older sessions without an evaluation keep the legacy list. Follow-along highlighting still works.
- **Live notes on the video:** feedback active at the playhead (a ranged event, or 3s for a point event) is shown over the recording, worst first, at most two. It's in playback only, as the brief says.
- **"Scores at this moment":** eye, body, voice and clarity bars from `scoreSeries[floor(t)]` that move while playing or scrubbing, with the final score marked on each track. Hidden when unmeasured or when there wasn't enough speech.
- **Timeline markers:** feedback markers coloured by severity (problem, warning, good) replace the legacy filler markers when an evaluation exists, and the legend updates to match.
- **The clarity series now uses the same blend as the final score:** Claude's segment or overall coherency, blended with the filler check, or unmeasured without Claude. Before, the bar read 100 (fillers only) while the final was 8.
- **Claude note text** is cleaned of stray brackets and quotes, on the server (`judge.ts`) and when displaying older sessions.
- **Verified in headless Chrome on a real session (`20261114215333-kli4`):**
  - 12 feedback items and 12 markers.
  - The notes at 0:01 show the rule event and the Claude note.
  - The bars move with seeking (eye 100 → 73 → 100).
  - Screenshot checked. No errors.

### 2026-11-14: report events follow the recording; random panel lineups (UI and personas, requested by me)

**Heads-up, Derek / Person 3 and Guanyi / Person 2: these touch your files. Please review.**

- **Session events follow the recording (`Report.tsx`, `index.css`):**
  - The event the recording is at (the latest at or before the playhead) is highlighted, and the others are dimmed to 45%.
  - The list scrolls itself, not the page, to keep the current event in view. Auto-scroll pauses for 3s after you scroll the list by hand.
  - Before the first event, nothing is dimmed. Events are now sorted by time.
  - Changes: an effect plus refs in `Report.tsx`; `.rp-events` gets `position: relative` and `.following` / `.current` rules.
- **Random panel lineups (`personas.ts`, `types.ts`, `Setup.tsx`):**
  - Each built-in panel type has a pool: investors 10, peers 9, interview 10 (the original members plus 7 new personas each). A lineup of the original size (3 / 2 / 3) is drawn every time setup opens.
  - `drawPanel()` always includes a strict member (4+) when the pool has one, and seats the strictest first, since the first persona leads.
  - New "Shuffle panel" button on "Meet your panel".
  - New investors: Daniel Osei, Hannah Brooks, Ravi Menon, Catherine Dubois, Jonah Feld, Mei Tanaka, Tunde Adeyemi.
  - New peers: Leo Martins, Zara Ahmed, Kenji Watanabe, Priyanka Rao, Ben Carter, Amara Nwosu, Felix Schmidt.
  - New interviewers: Grace Liu, Omar Haddad, Sofia Rossi, David Kim, Nadia Petrova, Marcos Silva, Eleanor Wright.
  - New personas have no `anamAvatarId`, so the server matches a realistic Anam face by gender and look, as for custom agents. fal and Synthesia portraits show initials until generated.
  - `Panel` gets optional `pool` and `size`. Setup's Synthesia sync covers the whole pool.
- **Verified:**
  - 2,000 draws per panel: no invalid lineups, and members appear evenly.
  - Headless Chrome: Shuffle changes the lineup with the strictest first. On a real recording, seeking highlights the right event, scrolls it into view and dims the rest. No errors.

### 2026-11-14: fix: Pace 100 and Tonality 100 after barely speaking (interactive session)

- **What happened in session `20261114200812-48vb`:**
  - The transcript had 155 words, but most were the panel's lines (transcribed through the speakers, often committed a second late) and other people in the room. The speaker actually talked for about 5s.
  - The six report bars used the old formulas on all those words: Pace 100.
  - Tonality judged 18 voiced frames (about 2.5s): 100.
- **Mouth gate tuned on that session's raw jaw data:** the speaker's phrases reached a jaw range of 0.05–0.24, while silence and panel audio stayed under 0.045. `mouthMoveMin` is now 0.05 and `mouthOpenMin` 0.04 (0.08 was rejecting half the real speech).
- **Speaker attribution (`assemble.ts`, `attributeToSpeaker`, replaces `dropPanelLeakage`):** a phrase is dropped if:
  - its words repeat a panel line spoken in the last few seconds (echo), or
  - the face was visible and the jaw barely moved, or
  - it starts during, or within 1s after, a panel line without clear jaw movement.
- **Minimum evidence (`thresholds.ts`):** pitch variety needs 40 voiced samples (about 6s; it was 15). Pace, fillers and pauses need 25 of the speaker's own words.
- **Pace (`rules.ts`):**
  - `wpmIn` now counts short pauses (under 2s) between phrases. Raw phrase time alone gave 219 wpm for normal speech.
  - New `sustainedWpm`: pace only from runs of at least 8s of continuous talking, and at least 15s in total. Short bursts don't count.
- **The six report bars (`evaluate.ts`, `deliveryBars`) now use only the speaker's attributed words:**
  - Pace: sustained speech.
  - Pauses: ignore gaps while the panel talks and gaps over 6s.
  - Eye contact = the evaluation's eye score. Gestures = `bodyBreakdown.gestures`.
  - Tonality: gated pitch, at least 6s of voice.
  - So the bars can no longer contradict the category scores.
- **Coherency is unmeasured without Claude.** Fillers alone can't judge structure, and they have their own bar.
- **Accurate transcript detection** now compares content, not object identity (identity broke after a reload).
- **Verified:** re-scoring that session offline (with the new gate applied to its stored jaw readings):
  - the echoed panel line is dropped and 9 of 12 phrases are kept
  - Pace and Tonality "–", Eye 52, Body 70, Timing 76, Overall 66
  - the newer near-silent session is "Not scored"
  - the fake pitch still scores
  - Web, server and CLI typecheck, and the build passes

### 2026-11-14: real eye gaze and six-part body language (research-based)

- **Eye gaze (`signals/vision.ts`, `signals/sampler.ts`, `calibration.ts`):**
  - Eye-in-head angle comes from where each iris sits between the eye corners and lids: `asin(2.5 × offset / eye width)`. The vertical angle is blended 50/50 with the eyeLookUp/Down blendshapes, and the last reading is held during blinks.
  - Head angles are signed in image terms. The transform matrix's sign is aligned automatically against a nose-offset estimate.
  - On target = combined gaze (head + eyes) within ±12° left/right and ±14° up/down of calibration, with the head itself within 35°/30°. Turning your head while your eyes stay on the panel now counts. Looking at notes with the head still no longer counts.
  - New `SampleX` fields: `gazeYaw`, `gazePitch`, `eyeYaw`, `eyePitch`. Calibration records `gazeYaw0`, `gazePitch0` and `facing0`.
  - A gaze arrow is drawn on the debug page and in playback: a dot when on target, a longer arrow the further away the eyes point.
- **Body language (`scores.ts`):** `bodyBreakdown()` has six parts, following the Tübingen presentation rubric (posture, gestures, facial expression) and coaches' criteria (self-touch, purposeful movement). Each is 0–100 or null. Weights are in `T.body.weights`.
  - posture 25%: slouch, shoulder tilt, torso facing the panel
  - openness 15%: arms not crossed, hands not hidden (only judged when the waist is in frame)
  - gestures 25%: share of speaking time gesturing in the natural speed band (30–70% ideal), minus frantic movement. Null in a head-and-shoulders shot.
  - self-touch 15%: face touches per minute, fidgeting (hands together and moving)
  - movement 10%: side-to-side sway in shoulder widths
  - expression 10%: smiling share and eyebrow movement
  - Each body warning also costs 3 points, up to 20, so short problems don't average away.
  - New fields: `shoulderTilt`, `shoulderW`, `facing`, `armSpan`, `handsTogether`, `handsHidden`, `brow`. `EvaluationResult.bodyBreakdown` holds the parts.
- **New live rules (`rules.ts`):** shoulders tilted (8s), body turned away (5s), hands out of sight (8s), fidgeting (4s), swaying, hands still while talking (30s), and "natural, purposeful gestures" (good).
- **Event merging** is now by kind (category + opening words), not category alone. Before, arms crossed swallowed a nearby "turned away".
- **Claude's segment summaries** now include facing share, gesturing share and fidget frames.
- **Debug page:** gaze (combined, eyes only, head only), posture readings, and the six body sub-scores live.
- **Verified:**
  - Iris geometry unit test (±30° symmetric, either corner order).
  - Every planted fake problem fires its own event: fidget 30s, turned away 50s, arms 60s, touch 75s, sway 83s.
  - Silent gate unchanged. Web, server and CLI typecheck, and the build passes.
- **Not yet verified:** on a real face and body. All new thresholds are first guesses.

### 2026-11-14: face and body tracking drawn over the recording (playback only)

- **During the session:** the sampler records a compact landmark track about 7 times a second (`EvaluationResult.landmarks`).
  - It contains 136 face points (outline, eyes, brows, lips, irises), both hands, and 9 upper-body pose points.
  - Points are stored as integers 0–999. Worst case is about 600 KB per minute.
  - It is never drawn live.
- **On the report screen:** the recording plays with the tracking drawn on top, in sync while playing, paused or scrubbing, and correctly placed in the letterboxed player. Toggles: Face, Hands, Body. Colours match the debug page:
  - face green = eye contact, red = looking away
  - hands amber = touching face
  - forearms red = arms crossed
  - shoulder line amber = slouching

  Sessions recorded before this change have no track, so no overlay or toggles appear.
- **New files:**
  - `web/src/eval/landmarks.ts`: track format, encode and decode, nearest frame.
  - `web/src/eval/debug/draw.ts`: shared drawing for the live debug overlay and playback.
  - `web/src/eval/playback/LandmarkPlayback.tsx`: the playback canvas.
- **Changed:**
  - `contracts.ts` (`LandmarkTrack`, `EvaluationResult.landmarks?`)
  - `signals/sampler.ts`, `runtime.ts`, `evaluate.ts`, `assemble.ts`
  - `debug/TrackingOverlay.tsx`, now using `draw.ts`
- **Shared file:** `web/src/components/Report.tsx`. The video is wrapped in a positioned div with the overlay, and a "Tracking overlay" toggle row sits under the legend. Nothing else changed.
- **Verified:**
  - The round trip is accurate to 0.05% of the frame.
  - In headless Chrome with a real recording and a synthetic moving figure, the drawing is at the expected position at 10s and 120s (0.327 vs 0.327, 0.626 vs 0.627), inside the letterboxed picture, toggles clear it, and there are no errors.

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
