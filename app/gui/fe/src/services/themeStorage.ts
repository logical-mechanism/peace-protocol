import { storageGet, storageSet } from './storageUtils'

const THEME_KEY = 'veiled_theme'

export type Theme = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const DEFAULT_THEME: Theme = 'dark'

/** Read the stored theme from localStorage (defaults to 'dark'). */
export function getTheme(): Theme {
  const stored = storageGet(THEME_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  return DEFAULT_THEME
}

/** Persist theme choice to localStorage. */
export function setTheme(theme: Theme): void {
  storageSet(THEME_KEY, theme)
}

/** Resolve 'system' to the current OS preference; pass 'dark'/'light' through. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Apply the theme by setting `data-theme` attribute on the root `<html>` element. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme))
}

/** Read stored theme and apply it. Call before createRoot() to prevent flash. */
export function initializeTheme(): void {
  applyTheme(getTheme())
}

/**
 * Subscribe to OS dark/light preference changes. Fires `callback` whenever the
 * preference flips. Returns a cleanup function that removes the listener.
 */
export function listenToSystemTheme(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => callback()
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}
