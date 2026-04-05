import { storageGet, storageSet, storageGetJSON, storageSetJSON } from './storageUtils'

const AUTO_ACCEPT_KEY = 'veiled_auto_accept_enabled'
const QUEUE_KEY = 'veiled_accept_bid_queue'

/** Serialized queue item for localStorage persistence. */
export interface SerializedQueueItem {
  id: string
  encryptionTokenName: string
  bidTokenName: string
  status: string
  priority: boolean
  error?: string
  partialSuccess?: 'snark-only'
  addedAt: number
  startedAt?: number
  completedAt?: number
  provingElapsed?: number
}

/** Read the auto-accept enabled flag from localStorage. */
export function getAutoAcceptEnabled(): boolean {
  return storageGet(AUTO_ACCEPT_KEY) === 'true'
}

/** Persist the auto-accept enabled flag to localStorage. */
export function setAutoAcceptEnabled(enabled: boolean): void {
  storageSet(AUTO_ACCEPT_KEY, String(enabled))
}

/** Read persisted queue items from localStorage.
 *  Items that were in-progress at shutdown are reset to 'failed'. */
export function getPersistedQueue(): SerializedQueueItem[] {
  const items = storageGetJSON<SerializedQueueItem[]>(QUEUE_KEY, [])
  let changed = false
  for (const item of items) {
    if (item.status === 'preparing' || item.status === 'proving' || item.status === 'submitting') {
      item.status = 'failed'
      item.error = 'Interrupted by app restart'
      changed = true
    }
  }
  if (changed) {
    storageSetJSON(QUEUE_KEY, items)
  }
  return items
}

/** Persist queue items to localStorage. */
export function setPersistedQueue(items: SerializedQueueItem[]): void {
  storageSetJSON(QUEUE_KEY, items)
}
