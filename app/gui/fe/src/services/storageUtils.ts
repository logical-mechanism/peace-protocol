/**
 * Shared localStorage utilities.
 *
 * Centralizes the try-catch boilerplate that every *Storage.ts module repeats.
 * In dev builds, caught errors are logged via console.warn so storage failures
 * are visible during development without crashing in production.
 */

function warnOnError(key: string, action: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[storage] ${action} failed for key "${key}":`, error);
  }
}

/** Read a raw string from localStorage, returning null on missing key or failure. */
export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    warnOnError(key, 'get', error);
    return null;
  }
}

/** Write a raw string to localStorage (best-effort). */
export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    warnOnError(key, 'set', error);
  }
}

/** Remove a key from localStorage (best-effort). */
export function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    warnOnError(key, 'remove', error);
  }
}

/** Read and JSON.parse from localStorage, returning the fallback on missing key or failure. */
export function storageGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    warnOnError(key, 'getJSON', error);
    return fallback;
  }
}

/** JSON.stringify and write to localStorage (best-effort). */
export function storageSetJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    warnOnError(key, 'setJSON', error);
  }
}
