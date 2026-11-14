// Live transcript with ElevenLabs Scribe realtime. The browser gets a single-use token from our server.
import { CommitStrategy, RealtimeEvents, Scribe, type RealtimeConnection } from '@elevenlabs/client'
import { getJson } from '../api'
import type { Word } from '../types'

export class LiveTranscript {
  words: Word[] = []
  partial = ''
  error: string | null = null
  private conn: RealtimeConnection | null = null
  private audioStartedAt = 0
  private lastCommitAt = 0

  private onUpdate: () => void
  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate
  }

  async start(now: () => number, deviceId?: string) {
    const { token } = await getJson<{ token: string }>('/api/voice/scribe-token', 8000)
    const conn = Scribe.connect({
      token,
      modelId: 'scribe_v2_realtime',
      commitStrategy: CommitStrategy.VAD,
      vadSilenceThresholdSecs: 0.8,
      includeTimestamps: true,
      languageCode: 'en',
      microphone: { deviceId, echoCancellation: true, noiseSuppression: true },
    })
    this.conn = conn
    this.audioStartedAt = now()
    conn.on(RealtimeEvents.AUDIO_STARTED, () => {
      this.audioStartedAt = now()
    })
    conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
      this.partial = data.text
      this.onUpdate()
    })
    conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (data) => {
      const timed = (data.words ?? []).filter((w) => w.type === 'word' && w.start !== undefined && w.end !== undefined)
      if (timed.length) {
        this.words.push(...timed.map((w) => ({ text: w.text, start: this.audioStartedAt + w.start!, end: this.audioStartedAt + w.end! })))
      } else if (data.text.trim()) {
        // No timestamps: spread the words evenly since the last commit.
        const tokens = data.text.trim().split(/\s+/)
        const end = now()
        const start = Math.max(this.lastCommitAt, end - tokens.length * 0.4)
        const step = (end - start) / tokens.length
        tokens.forEach((text, i) => this.words.push({ text, start: start + i * step, end: start + (i + 1) * step }))
      }
      this.lastCommitAt = now()
      this.partial = ''
      this.onUpdate()
    })
    conn.on(RealtimeEvents.ERROR, (err) => {
      this.error = 'error' in err ? String(err.error) : 'Live transcript error'
      this.onUpdate()
    })
  }

  /** Mutes the transcriber while the panel speaks, so their questions are not counted as the pitch. */
  setMuted(muted: boolean) {
    try {
      if (muted) this.conn?.mute()
      else this.conn?.unmute()
    } catch {
      // not fatal
    }
  }

  stop() {
    try {
      this.conn?.commit()
    } catch {
      // already closed
    }
    window.setTimeout(() => this.conn?.close(), 600)
  }
}
