// Every tunable number in the evaluation, in one place. Calibration ("training") means editing this
// file after running `npm run eval:calibrate` on good and bad team recordings.

export const T = {
  sampleHz: 7,

  gaze: {
    /**
     * On target when the combined gaze (head angle + eye-in-head angle from the irises), relative to calibration,
     * is within these limits. Turning the head while the eyes stay on the panel still counts.
     */
    maxGazeYawDeg: 10,
    maxGazePitchDeg: 12,
    /** …and the head itself is not turned further than this (beyond it the iris estimate is unreliable). */
    maxHeadYawDeg: 35,
    maxHeadPitchDeg: 30,
    /** Eye-in-head angle = asin(k × iris offset / eye width). k ≈ eye width / eyeball radius ≈ 30 mm / 12 mm. */
    irisGain: 2.5,
    /** Weight of the eyeLookUp/Down blendshapes in the vertical eye angle (the lids make iris-only pitch noisy). */
    blendPitchWeight: 0.5,
    blendPitchDeg: 35,
    /** Eyes closed beyond this: keep the previous gaze reading instead of guessing. */
    blinkClosed: 0.5,
  },

  body: {
    /** Slouch 0–1: how far head height above the shoulders dropped versus the baseline. */
    slouchBad: 0.3,
    /** Shoulder line angle (degrees from horizontal): fine below `tiltOk`, a warning above `tiltBad`. */
    tiltOk: 4,
    tiltBad: 10,
    /** Torso facing: shoulder width relative to eye span, versus baseline. Below this the body is turned away. */
    facingMin: 0.75,
    /** Side-to-side sway: std of the shoulder midpoint over 4 s windows, in shoulder widths. */
    swayOk: 0.04,
    swayBad: 0.15,
    /** Wrists closer than this (shoulder widths) = hands together (wringing, clasping). */
    handsTogether: 0.35,
    /** Share of speaking time spent gesturing (hand speed in the natural band) that counts as ideal. */
    gestureShareGood: [0.35, 0.65] as [number, number],
    /** Body sub-score weights (renormalised over the ones that could be measured). */
    weights: { posture: 0.25, openness: 0.15, gestures: 0.25, selfTouch: 0.15, movement: 0.1, expression: 0.1 },
    /** Hand speed (shoulder widths per second) bands for "natural" gesturing. */
    handSpeedStill: 0.05,
    handSpeedBusy: 1.2,
    /** Fingertip inside the face box, expanded by this fraction of its size. */
    faceTouchMargin: 0.1,
    /**
     * Points off the body score when the camera can't see the upper body or the hands. Each share ramps from no
     * penalty at the first value to the full penalty at the second; a single stretch of `longRunSec` or more adds
     * `longRunPenalty`. Total capped at `maxPenalty`.
     */
    visibility: {
      handsOutShare: [0.4, 0.9] as [number, number],
      handsOutMax: 20,
      bodyOutShare: [0.3, 0.8] as [number, number],
      bodyOutMax: 15,
      longRunSec: 15,
      longRunPenalty: 5,
      maxPenalty: 30,
    },
  },

  /** Below this much of the speaker's own speech (seconds) nothing is scored. */
  minSpeechSec: 10,
  /** Pitch variety needs at least this many voiced samples of the speaker (~6 s at 7 Hz). */
  minVoicedSamples: 40,
  /** The same for one 5 s step of the delivery chart (~2 s of voice). */
  minVoicedWindow: 15,
  /** Pace, fillers and pauses need at least this many of the speaker's own words. */
  minWords: 25,

  /** Who said a transcript phrase. */
  attribution: {
    /** Jaw movement (max 1 s range) within the phrase at or above this: the speaker said it. */
    userJawRange: 0.05,
    /** Below this, with the face visible: someone else said it (room, panel through the speakers). */
    otherJawRange: 0.035,
    /** A phrase starting within this long after a panel line may be that line transcribed late. */
    agentTailSec: 1,
    /** Share of a phrase's words found in a recent panel line that marks it as an echo of that line. */
    echoOverlap: 0.6,
  },

  voice: {
    /** RMS needed to count as speech, at minimum. The live threshold adapts to the noise floor. */
    minSpeechRms: 0.015,
    noiseMultiplier: 3,
    /** Seconds of quiet before `speaking` turns off (hangover). */
    speakingHangSec: 0.3,
    /**
     * Mouth gate. Over the last second, jawOpen must vary by more than `mouthMoveMin` AND open more than `mouthOpenMin`
     * above the speaker's resting level (20th percentile over 10 s). Model jitter and head turns stay under both.
     */
    // Tuned on a real session: the speaker's phrases reached 0.05–0.24, silence and panel audio stayed under 0.045.
    mouthMoveMin: 0.05,
    mouthOpenMin: 0.04,
    /** If a face was seen this recently, a missing face means "can't tell" (turned away, hand over mouth): not speaking. */
    faceRecentSec: 10,
    /** Pitch spread (semitones, trimmed std) below this over 20 s counts as monotone. */
    monotoneSemitones: 1.5,
    expressiveSemitones: 3.5,
    paceGood: [130, 160] as [number, number],
    paceFast: 185,
    paceSlow: 105,
  },

  fillers: {
    /** Target: under this many per minute. */
    perMinuteGood: 3,
  },

  room: {
    /** A silence longer than this ends a monologue. */
    monologueBreakSec: 4,
    /** Silence (s) at which endOfThoughtProb's silence term reaches 0.5. */
    silenceMidSec: 0.8,
    ramblingStartSec: 60,
    ramblingFullSec: 150,
  },

  rules: {
    lookAwaySec: 3,
    lookAwayBadSec: 6,
    armsCrossedSec: 5,
    slouchSec: 8,
    tiltSec: 8,
    turnedAwaySec: 5,
    handsHiddenSec: 8,
    /** Face in view but no hands (in frame or in the pose) for this long. */
    noHandsSec: 15,
    /** Face in view but no shoulders for this long. */
    noBodySec: 10,
    fidgetSec: 4,
    stillHandsSec: 30,
    fillersIn10s: 3,
    monotoneWindowSec: 20,
    monologueSec: 90,
    /** Overlapping events of the same category closer than this are merged. */
    minGapSec: 5,
  },

  timing: {
    monologueMaxSec: 90,
    answerSec: [15, 45] as [number, number],
    latencySec: [0.5, 2] as [number, number],
    yieldSec: 2,
  },

  /** Weights of the overall score (sum to 1). */
  overallWeights: { eye: 0.15, body: 0.15, tone: 0.2, coherency: 0.35, timing: 0.15 },
  /** Coherency = this share from Claude's content judgement + the rest from the live proxy. */
  claudeCoherencyShare: 0.65,
}
