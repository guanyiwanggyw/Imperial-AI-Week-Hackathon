import { useEffect, useState } from 'react'
import { getJson, getStatus, type Status } from './api'
import { Report } from './components/Report'
import { Session } from './components/Session'
import { Setup } from './components/Setup'
import { loadVision } from './eval/signals/vision'
import type { SessionConfig, SessionData } from './types'

type View =
  | { name: 'setup' }
  | { name: 'session'; config: SessionConfig }
  | { name: 'report'; session: SessionData; localRecording: string | null }
  | { name: 'loading' }
  | { name: 'missing' }

const reportHash = (id: string) => `#/report/${id}`

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [view, setView] = useState<View>({ name: 'setup' })
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  useEffect(() => {
    void getStatus().then(setStatus)
    // Warm up the vision models while the user is on the setup screen.
    loadVision().catch(() => undefined)
  }, [])

  // Reports have their own URL so a past session can be opened directly (useful as a demo backup).
  useEffect(() => {
    const open = () => {
      const match = location.hash.match(/^#\/report\/([\w-]+)/)
      if (!match) return
      setView({ name: 'loading' })
      getJson<SessionData>(`/api/sessions/${match[1]}`, 10000).then(
        (session) => setView({ name: 'report', session, localRecording: null }),
        () => setView({ name: 'missing' }),
      )
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  async function requestMedia() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      setStream(s)
      setStreamError(null)
    } catch (err) {
      setStreamError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera or microphone access was blocked. Allow it in the browser address bar, then try again.'
          : 'No camera or microphone was found.',
      )
    }
  }

  useEffect(() => {
    // Ask straight away if permission was already granted, so returning users see their preview.
    void navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') void requestMedia()
      })
      .catch(() => undefined)
  }, [])

  if (!status) return null

  if (view.name === 'session' && stream) {
    return (
      <Session
        config={view.config}
        stream={stream}
        status={status}
        onCancel={() => setView({ name: 'setup' })}
        onDone={(session, localRecording) => {
          history.replaceState(null, '', reportHash(session.id))
          setView({ name: 'report', session, localRecording })
        }}
      />
    )
  }

  if (view.name === 'report') {
    return (
      <Report
        session={view.session}
        localRecording={view.localRecording}
        onNew={() => {
          history.replaceState(null, '', location.pathname)
          setView({ name: 'setup' })
        }}
      />
    )
  }

  if (view.name === 'loading') {
    return (
      <div className="page row" style={{ justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    )
  }

  return (
    <>
      {view.name === 'missing' && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="notice">That session could not be found. It may have been recorded on another machine.</div>
        </div>
      )}
      <Setup
        status={status}
        stream={stream}
        streamError={streamError}
        onRequestMedia={requestMedia}
        onStart={(config) => setView({ name: 'session', config })}
        onOpenSession={(id) => (location.hash = reportHash(id))}
      />
    </>
  )
}
