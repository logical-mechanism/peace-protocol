const TAB_KEY = 'veiled_active_tab'

type TabId = 'marketplace' | 'my-sales' | 'my-purchases' | 'history' | 'library';

const VALID_TABS: Set<string> = new Set(['marketplace', 'my-sales', 'my-purchases', 'history', 'library'])

/** Read the last active tab from localStorage (defaults to 'marketplace'). */
export function getLastActiveTab(): TabId {
  try {
    const stored = localStorage.getItem(TAB_KEY)
    if (stored && VALID_TABS.has(stored)) return stored as TabId
  } catch { /* best-effort */ }
  return 'marketplace'
}

/** Persist the active tab to localStorage. */
export function setLastActiveTab(tabId: TabId): void {
  try {
    localStorage.setItem(TAB_KEY, tabId)
  } catch { /* best-effort */ }
}

/** Clear the persisted tab (e.g., on wallet lock). */
export function clearLastActiveTab(): void {
  try {
    localStorage.removeItem(TAB_KEY)
  } catch { /* best-effort */ }
}
