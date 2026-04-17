import { storageGet, storageSet } from './storageUtils'

const TOAST_DURATION_KEY = 'veiled_toast_duration_ms'
const TOAST_DURATION_DEFAULT = 5000

/** Valid toast duration presets in milliseconds. 0 = never auto-dismiss.
 *  labelKey resolves via t(`settings:preferences.${labelKey}`). */
export const TOAST_DURATION_OPTIONS = [
  { labelKey: 'notifDuration3s', value: 3000 },
  { labelKey: 'notifDuration5s', value: 5000 },
  { labelKey: 'notifDuration8s', value: 8000 },
  { labelKey: 'notifDurationNever', value: 0 },
] as const

/** Read the toast auto-dismiss duration from localStorage (ms, 0 = never). */
export function getToastDurationMs(): number {
  const stored = storageGet(TOAST_DURATION_KEY)
  return stored !== null ? Number(stored) : TOAST_DURATION_DEFAULT
}

/** Persist the toast auto-dismiss duration (ms, 0 = never). */
export function setToastDurationMs(ms: number): void {
  storageSet(TOAST_DURATION_KEY, String(ms))
}
