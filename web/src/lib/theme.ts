import { useEffect, useState } from 'react'

/**
 * Light/dark theme. The choice is stored in localStorage; with no stored choice the system setting is followed.
 * index.html applies the same logic before first paint so the page never flashes the wrong theme.
 */
export type Theme = 'light' | 'dark'

const KEY = 'theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const current = (): Theme => stored() ?? (media().matches ? 'dark' : 'light')

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current)

  useEffect(() => apply(theme), [theme])

  // Follow the system setting until the user picks a theme explicitly.
  useEffect(() => {
    const mq = media()
    const onChange = () => {
      if (!stored()) setTheme(mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        // Private mode: the toggle still works for this visit.
      }
      return next
    })

  return { theme, toggle }
}
