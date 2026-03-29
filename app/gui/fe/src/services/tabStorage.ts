import { storageGet, storageSet, storageRemove } from './storageUtils'

const TAB_KEY = 'veiled_active_tab'

type TabId = 'marketplace' | 'my-sales' | 'my-purchases' | 'history' | 'library';

const VALID_TABS: Set<string> = new Set(['marketplace', 'my-sales', 'my-purchases', 'history', 'library'])

/** Read the last active tab from localStorage (defaults to 'marketplace'). */
export function getLastActiveTab(): TabId {
  const stored = storageGet(TAB_KEY)
  if (stored && VALID_TABS.has(stored)) return stored as TabId
  return 'marketplace'
}

/** Persist the active tab to localStorage. */
export function setLastActiveTab(tabId: TabId): void {
  storageSet(TAB_KEY, tabId)
}

/** Clear the persisted tab (e.g., on wallet lock). */
export function clearLastActiveTab(): void {
  storageRemove(TAB_KEY)
}
