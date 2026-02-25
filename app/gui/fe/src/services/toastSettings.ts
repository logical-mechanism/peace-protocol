const TOAST_DURATION_KEY = 'veiled_toast_duration_ms'
const TOAST_DURATION_DEFAULT = 5000

/** Valid toast duration presets in milliseconds. 0 = never auto-dismiss. */
export const TOAST_DURATION_OPTIONS = [
  { label: '3 seconds', value: 3000 },
  { label: '5 seconds (default)', value: 5000 },
  { label: '8 seconds', value: 8000 },
  { label: 'Never', value: 0 },
] as const

/** Read the toast auto-dismiss duration from localStorage (ms, 0 = never). */
export function getToastDurationMs(): number {
  const stored = localStorage.getItem(TOAST_DURATION_KEY)
  return stored !== null ? Number(stored) : TOAST_DURATION_DEFAULT
}

/** Persist the toast auto-dismiss duration (ms, 0 = never). */
export function setToastDurationMs(ms: number): void {
  localStorage.setItem(TOAST_DURATION_KEY, String(ms))
}
