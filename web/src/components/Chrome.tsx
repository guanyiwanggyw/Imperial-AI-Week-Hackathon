/** Shared page chrome from the Figma design: top navigation and the three-step journey. */

interface NavProps {
  active: 'practice' | 'feedback'
  /** Tabs without a handler are shown but inert (e.g. during a live session). */
  onPractice?: () => void
  onPast?: () => void
  onFeedback?: () => void
  /** Full-width layout, used by the live session workspace. */
  wide?: boolean
}

export function TopNav({ active, onPractice, onPast, onFeedback, wide }: NavProps) {
  return (
    <header className={`rp-nav${wide ? ' wide' : ''}`}>
      <div className="rp-wrap">
        <span className="rp-brand">Pitch practice</span>
        <nav className="rp-tabs" aria-label="Main">
          <button className={active === 'practice' ? 'on' : ''} aria-current={active === 'practice' ? 'page' : undefined} onClick={onPractice} disabled={active !== 'practice' && !onPractice}>
            Practice
          </button>
          <button onClick={onPast} disabled={!onPast}>
            Past sessions
          </button>
          <button className={active === 'feedback' ? 'on' : ''} aria-current={active === 'feedback' ? 'page' : undefined} onClick={onFeedback} disabled={active !== 'feedback' && !onFeedback}>
            Feedback
          </button>
        </nav>
      </div>
    </header>
  )
}

const STEPS = ['Set up your session', 'Pitch & answer', 'Review your report']

export function Steps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="rp-steps" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className={i < current ? 'done' : i === current ? 'current' : 'todo'} aria-current={i === current ? 'step' : undefined}>
          <span className="n">{i + 1}</span>
          <span className="t">{label}</span>
          {i < STEPS.length - 1 && <span className="bar" />}
        </li>
      ))}
    </ol>
  )
}
