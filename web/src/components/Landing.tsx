// Landing page: the hero image stays fixed behind a grey overlay with the product name and mission; scrolling
// brings up a plain sheet (white in light mode) over it with more about the product and the team.
import { useEffect, useState } from 'react'

interface Props {
  onStart: () => void
  onPast: () => void
}

const STEPS = [
  { n: '1', title: 'Set up your panel', body: 'Pick sceptical investors, friendly peers or an interview panel, add your slides and any context. Every session draws a fresh line-up.' },
  { n: '2', title: 'Pitch and take questions', body: 'The panel listens live, reacts, and asks follow-ups grounded in what you actually said, out loud, as talking avatars.' },
  { n: '3', title: 'Review every moment', body: 'Replay your recording with timestamped feedback, scores that move with the video, and the three things to work on next.' },
]

/** What the report measures, shown the way the report shows it: a score and a real example note. */
const MEASURES = [
  { label: 'Eye contact', score: 84, how: 'Head angle plus where your irises point, calibrated to your panel.', note: '0:42', msg: 'Looked away for 3.4s' },
  { label: 'Body language', score: 66, how: 'Posture, gestures, fidgeting, and gestures that contradict your words.', note: '1:15', msg: 'Thumbs-up while describing a problem' },
  { label: 'Voice', score: 72, how: 'Pitch variety, pauses, pace over sustained speech, filler words.', note: '0:58', msg: '5 filler words in 10s' },
  { label: 'Clarity', score: 58, how: 'Structure, and whether each answer addressed the question asked.', note: '2:10', msg: 'Answer never gave the price' },
]

const AUDIENCES = [
  { title: 'Founders', body: 'Rehearse the seed pitch with investors who probe your numbers, traction and why you win.' },
  { title: 'Students and job seekers', body: 'Practise interviews with a panel that tests structure, judgement and how you handle follow-ups.' },
  { title: 'Speakers', body: 'Get honest feedback on delivery before the talk, not after it.' },
]

const band = (v: number) => (v >= 70 ? 'good' : v >= 50 ? 'warn' : 'bad')

/** The demo panel: each panelist asks the kind of question their persona would. */
const PANEL = [
  { initials: 'PS', name: 'Priya Shah', short: 'Priya', role: 'Seed fund partner', face: 'a', line: 'You said three paying clinics. How did you find them, and what are they paying?' },
  { initials: 'MW', name: 'Marcus Webb', short: 'Marcus', role: 'Angel investor', face: 'b', line: 'I like the story. Who exactly is your first customer, and how do you reach the next fifty?' },
  { initials: 'EK', name: 'Elena Kovac', short: 'Elena', role: 'Technical diligence', face: 'c', line: 'What have you actually built so far, and what breaks first if usage doubles?' },
]

/**
 * Rotates the speaking panelist every 3 s and types out their question. Clicking a tile jumps to that panelist and
 * holds a little longer; hovering pauses the rotation so nobody is cut off mid-read.
 */
function PanelMock() {
  const [active, setActive] = useState(0)
  const [typed, setTyped] = useState(0)
  const [hover, setHover] = useState(false)
  const [hold, setHold] = useState(3000)
  const line = PANEL[active].line

  useEffect(() => {
    if (hover) return
    const t = window.setTimeout(() => {
      setHold(3000)
      setActive((a) => (a + 1) % PANEL.length)
    }, hold)
    return () => window.clearTimeout(t)
  }, [active, hover, hold])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(line.length)
      return
    }
    setTyped(0)
    const t = window.setInterval(() => setTyped((n) => (n >= line.length ? n : n + 2)), 22)
    return () => window.clearInterval(t)
  }, [line])

  const p = PANEL[active]
  return (
    <div className="ld-mock ld-panel-mock" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="tiles" role="group" aria-label="Example panel">
        {PANEL.map((m, i) => (
          <button
            key={m.initials}
            type="button"
            className={`ld-tile${i === active ? ' speaking' : ''}`}
            aria-pressed={i === active}
            onClick={() => {
              setHold(6000)
              setActive(i)
            }}
          >
            <span className={`ld-face ${m.face}`}>{m.initials}</span>
            <span className="who">{m.name}</span>
            <span className="role">{m.role}</span>
            <span className="eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        ))}
      </div>
      <div className="caption" aria-live="polite">
        <b>{p.short}</b>
        <span>
          {line.slice(0, typed)}
          {typed < line.length && <span className="caret" />}
        </span>
      </div>
    </div>
  )
}

export function Landing({ onStart, onPast }: Props) {
  const more = () => document.getElementById('ld-more')?.scrollIntoView({ behavior: 'smooth' })
  return (
    <div className="ld">
      <div className="ld-bg" aria-hidden="true" />

      <header className="ld-nav">
        <button type="button" className="ld-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top">
          <svg className="rp-logo" viewBox="0 0 28 28" aria-hidden>
            <rect width="28" height="28" rx="7" className="bg" />
            <rect x="7" y="15" width="3" height="6" rx="1.5" className="bar" />
            <rect x="12.5" y="11" width="3" height="10" rx="1.5" className="bar" />
            <rect x="18" y="7" width="3" height="14" rx="1.5" className="peak" />
          </svg>
          Pitch Perfect
        </button>
        <nav className="ld-links" aria-label="Main">
          <button onClick={more}>How it works</button>
          <button onClick={onPast}>Past sessions</button>
          <button className="ld-btn primary small" onClick={onStart}>
            Start practising
          </button>
        </nav>
      </header>

      <section className="ld-hero">
        <div className="ld-hero-text">
          <span className="ld-kicker">AI pitch practice</span>
          <h1>Pitch Perfect</h1>
          <p className="ld-mission">Rehearse in front of an AI panel that listens, watches and pushes back. Then see exactly how you came across, moment by moment.</p>
          <div className="ld-cta">
            <button className="ld-btn primary" onClick={onStart}>
              Start practising
            </button>
            <button className="ld-btn ghost" onClick={onPast}>
              See past sessions
            </button>
          </div>
          <p className="ld-note">Runs in your browser · Your video is analysed on your device</p>
        </div>
        <button className="ld-scroll" onClick={more} aria-label="Learn more">
          <span>Learn more</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </section>

      <main className="ld-sheet" id="ld-more">
        <section className="ld-section ld-intro">
          <span className="ld-eyebrow">Why we built it</span>
          <h2>Practise the room, not the mirror.</h2>
          <p>
            Most people rehearse a pitch alone, to a wall. You get no reaction while you speak, no awkward follow-up question and no honest account of how you came
            across. Coaching is expensive and friends are too kind. Pitch Perfect gives you the room: a panel that reacts, questions and remembers what you said,
            and a report that shows you why.
          </p>
        </section>

        <section className="ld-section">
          <span className="ld-eyebrow">How it works</span>
          <h2>Three steps, one honest report.</h2>
          <div className="ld-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="ld-step" tabIndex={0}>
                <span className="n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Spotlight: the live panel */}
        <section className="ld-section ld-spot">
          <div className="ld-spot-text">
            <span className="ld-eyebrow">A live AI panel</span>
            <h2>A room that talks back.</h2>
            <p>
              Each panelist is a lifelike avatar with their own voice, personality and agenda. They listen while you speak, react to what they see, and ask the
              follow-up you were hoping to avoid, about the claim you just made, not a generic question from a list.
            </p>
            <ul className="ld-ticks">
              <li>Investors, peers or an interview panel, drawn fresh each time</li>
              <li>Interrupts when you ramble, waits when you pause to think</li>
              <li>Notices when you look away or fidget</li>
            </ul>
          </div>
          <PanelMock />
        </section>

        <section className="ld-section">
          <span className="ld-eyebrow">What we measure</span>
          <h2>Scores you can act on, tied to the moment.</h2>
          <div className="ld-measures">
            {MEASURES.map((m) => (
              <div key={m.label} className="ld-measure">
                <div className="top">
                  <span className="label">{m.label}</span>
                  <span className="score">{m.score}</span>
                </div>
                <div className={`bar ${band(m.score)}`}>
                  <i style={{ width: `${m.score}%` }} />
                </div>
                <p>{m.how}</p>
                <div className={`ld-example ${m.score >= 70 ? 'warn' : 'bad'}`}>
                  <span className="t">{m.note}</span>
                  {m.msg}
                </div>
              </div>
            ))}
          </div>
          <p className="ld-small">Example scores and notes, in the format your report uses.</p>
        </section>

        {/* Spotlight: see yourself do it better */}
        <section className="ld-section ld-spot reverse">
          <div className="ld-spot-text">
            <span className="ld-eyebrow">See yourself do it better</span>
            <h2>Hear the better version, in your own voice.</h2>
            <p>
              After the session, your weakest passage is rewritten to lead with the point and lose the fillers. Then it is spoken in a clone of your voice and
              lip-synced onto your face, so you can see exactly what better sounds and looks like on you. The voice clone is only made with your consent and is
              deleted straight after.
            </p>
          </div>
          <div className="ld-mock ld-redo-mock" aria-hidden="true">
            <div className="said">
              <span className="k">What you said · 0:21</span>
              <p>
                “So, <s>um</s>, <s>basically</s> we kind of help, <s>like</s>, clinics with their, <s>uh</s>, bookings. And it saves them, <s>you know</s>, a lot of
                time I guess.”
              </p>
            </div>
            <div className="arrow">↓</div>
            <div className="better">
              <span className="k">The better version · your voice</span>
              <p>“Clinics lose hours every week to missed bookings. We fix that automatically, and our pilot clinics got that time back.”</p>
              <span className="play">▶ Play the clip</span>
            </div>
          </div>
        </section>

        <section className="ld-section">
          <span className="ld-eyebrow">Who it is for</span>
          <h2>Anyone with something important to say.</h2>
          <div className="ld-audiences">
            {AUDIENCES.map((a) => (
              <div key={a.title} className="ld-audience">
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="ld-section ld-about">
          <span className="ld-eyebrow">About us</span>
          <h2>Built at the Imperial College AI Hackathon.</h2>
          <p>
            We are a team of four building in the Voice, Vision and Generative Media track. We wanted the practice tool we wished we had before our own pitches and
            interviews: honest, specific, and available whenever you need it. Your video is analysed in your browser; recordings stay on your own server.
          </p>
        </section>

        <section className="ld-final">
          <h2>Ready when you are.</h2>
          <p>Your first session takes about five minutes.</p>
          <button className="ld-btn primary" onClick={onStart}>
            Start practising
          </button>
        </section>

        <footer className="ld-footer">
          <span>Pitch Perfect · Imperial AI Week hackathon project</span>
          <span className="credits">Built with Claude by Anthropic, ElevenLabs, Anam, fal and MediaPipe.</span>
        </footer>
      </main>
    </div>
  )
}
