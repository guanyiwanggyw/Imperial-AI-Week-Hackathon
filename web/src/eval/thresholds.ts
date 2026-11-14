// Every tunable number in the evaluation, in one place. Calibration ("training") means editing this
// file after running `npm run eval:calibrate` on good and bad team recordings.

export const T = {
  sampleHz: 7,

  gaze: {
    /** On target when |yaw| and |pitch| (relative to calibration) are under this many degrees. */
    maxYawDeg: 15,
    maxPitchDeg: 15,
    /** …and no eyeLook* blendshape rose more than this above its calibrated resting value. */
    maxEyeLookRise: 0.35,
  },

  body: {
    /** Slouch 0–1: how far head height above the shoulders dropped versus the baseline. */
    slouchBad: 0.3,
    /** Hand speed (shoulder widths per second) bands for "natural" gesturing. */
    handSpeedStill: 0.05,
    handSpeedBusy: 1.2,
    /** Fingertip inside the face box, expanded by this fraction of its size. */
    faceTouchMargin: 0.1,
  },

  voice: {
    /** RMS needed to count as speech, at minimum. The live threshold adapts to the noise floor. */
    minSpeechRms: 0.015,
    noiseMultiplier: 3,
    /** Seconds of quiet before `speaking` turns off (hangover). */
    speakingHangSec: 0.3,
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
