/** Shared page chrome from the Figma design: top navigation and the three-step journey. */
import { useTheme } from '../lib/theme'

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
        <span className="rp-brand">
          <svg className="rp-logo" viewBox="0 0 28 28" aria-hidden>
            <rect width="28" height="28" rx="7" className="bg" />
            <rect x="7" y="15" width="3" height="6" rx="1.5" className="bar" />
            <rect x="12.5" y="11" width="3" height="10" rx="1.5" className="bar" />
            <rect x="18" y="7" width="3" height="14" rx="1.5" className="peak" />
          </svg>
          Pitch Perfect
        </span>
        <div className="rp-nav-right">
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
          {/* The live session is always dark, so the toggle is only offered on the other pages. */}
          {!wide && <ThemeToggle />}
        </div>
      </div>
    </header>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
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
