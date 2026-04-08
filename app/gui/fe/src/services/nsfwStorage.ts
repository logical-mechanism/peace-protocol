import { storageGet, storageSet } from './storageUtils'

const NSFW_KEY = 'veiled_nsfw_enabled'

/** Check if NSFW content should be shown (default: false). */
export function getNsfwEnabled(): boolean {
  return storageGet(NSFW_KEY) === 'true'
}

/** Persist NSFW visibility preference to localStorage. */
export function setNsfwEnabled(enabled: boolean): void {
  storageSet(NSFW_KEY, enabled ? 'true' : 'false')
}
