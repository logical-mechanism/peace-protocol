const THEME_KEY = 'veiled_theme'

export type Theme = 'dark' | 'light'

const DEFAULT_THEME: Theme = 'dark'

/** Read the stored theme from localStorage (defaults to 'dark'). */
export function getTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return DEFAULT_THEME
}

/** Persist theme choice to localStorage. */
export function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
}

/** Apply the theme by setting `data-theme` attribute on the root `<html>` element. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/** Read stored theme and apply it. Call before createRoot() to prevent flash. */
export function initializeTheme(): void {
  applyTheme(getTheme())
}
