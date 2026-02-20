const AUTOLOCK_KEY = 'veiled_autolock_minutes'
const AUTOLOCK_DEFAULT = 15

/** Check interval for the inactivity timer (ms). */
export const AUTOLOCK_CHECK_INTERVAL = 30_000

/** Read the auto-lock timeout from localStorage (minutes, 0 = never). */
export function getAutolockMinutes(): number {
  const stored = localStorage.getItem(AUTOLOCK_KEY)
  return stored !== null ? Number(stored) : AUTOLOCK_DEFAULT
}

/** Persist the auto-lock timeout (minutes, 0 = never). */
export function setAutolockMinutes(minutes: number): void {
  localStorage.setItem(AUTOLOCK_KEY, String(minutes))
}
