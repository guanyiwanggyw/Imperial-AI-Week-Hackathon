// Records the whole session in the browser: one camera+mic file for playback,
// and a small audio-only file for the accurate transcript.

function pickType(candidates: string[]) {
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

class Track {
  private chunks: Blob[] = []
  private recorder: MediaRecorder
  constructor(stream: MediaStream, mimeType: string, bitsPerSecond?: number) {
    this.recorder = new MediaRecorder(stream, { mimeType: mimeType || undefined, bitsPerSecond })
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
  }
  start() {
    this.recorder.start(1000)
  }
  pause() {
    if (this.recorder.state === 'recording') this.recorder.pause()
  }
  resume() {
    if (this.recorder.state === 'paused') this.recorder.resume()
  }
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (this.recorder.state === 'inactive') return resolve(new Blob(this.chunks, { type: this.recorder.mimeType }))
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType }))
      this.recorder.stop()
    })
  }
}

export class SessionRecorder {
  private av: Track
  private audio: Track

  constructor(stream: MediaStream) {
    this.av = new Track(stream, pickType(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']), 1_500_000)
    const audioOnly = new MediaStream(stream.getAudioTracks())
    this.audio = new Track(audioOnly, pickType(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']))
  }

  start() {
    this.av.start()
    this.audio.start()
  }
  pause() {
    this.av.pause()
    this.audio.pause()
  }
  resume() {
    this.av.resume()
    this.audio.resume()
  }
  async stop() {
    const [video, audio] = await Promise.all([this.av.stop(), this.audio.stop()])
    return { video, audio }
  }
}
