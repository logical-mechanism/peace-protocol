export type CommandCategory = 'navigation' | 'action' | 'settings'

export interface Command {
  id: string
  label: string
  keywords: string[]
  category: CommandCategory
  icon?: string
  shortcut?: string
}

const COMMANDS: Command[] = [
  { id: 'tab-marketplace', label: 'Go to Marketplace', keywords: ['marketplace', 'browse', 'listings'], category: 'navigation', shortcut: 'Ctrl+1' },
  { id: 'tab-my-sales', label: 'Go to My Sales', keywords: ['sales', 'selling', 'my listings'], category: 'navigation', shortcut: 'Ctrl+2' },
  { id: 'tab-my-purchases', label: 'Go to My Purchases', keywords: ['purchases', 'buying', 'bids'], category: 'navigation', shortcut: 'Ctrl+3' },
  { id: 'tab-history', label: 'Go to History', keywords: ['history', 'transactions', 'past'], category: 'navigation', shortcut: 'Ctrl+4' },
  { id: 'tab-library', label: 'Go to Library', keywords: ['library', 'content', 'downloaded', 'files'], category: 'navigation', shortcut: 'Ctrl+5' },
  { id: 'nav-settings', label: 'Go to Settings', keywords: ['settings', 'preferences', 'config'], category: 'navigation' },

  { id: 'action-refresh', label: 'Refresh Data', keywords: ['refresh', 'reload', 'update'], category: 'action', shortcut: 'Ctrl+R' },
  { id: 'action-create-listing', label: 'Create New Listing', keywords: ['create', 'new', 'listing', 'sell', 'upload'], category: 'action' },
  { id: 'action-toggle-theme', label: 'Toggle Theme', keywords: ['theme', 'dark', 'light', 'mode', 'appearance'], category: 'action' },
  { id: 'action-copy-address', label: 'Copy Wallet Address', keywords: ['copy', 'address', 'wallet', 'clipboard'], category: 'action' },
  { id: 'action-lock-wallet', label: 'Lock Wallet', keywords: ['lock', 'logout', 'disconnect', 'sign out'], category: 'action' },

  { id: 'settings-node', label: 'Jump to Node Status', keywords: ['node', 'cardano', 'sync'], category: 'settings' },
  { id: 'settings-network', label: 'Jump to Network', keywords: ['network', 'preprod', 'mainnet'], category: 'settings' },
  { id: 'settings-wallet', label: 'Jump to Wallet', keywords: ['wallet', 'mnemonic', 'seed'], category: 'settings' },
  { id: 'settings-storage', label: 'Jump to Storage', keywords: ['storage', 'iagon', 'disk'], category: 'settings' },
  { id: 'settings-automation', label: 'Jump to Automation', keywords: ['automation', 'auto', 'accept'], category: 'settings' },
  { id: 'settings-updates', label: 'Jump to Updates', keywords: ['updates', 'upgrade', 'version'], category: 'settings' },
  { id: 'settings-logs', label: 'Jump to Logs', keywords: ['logs', 'debug', 'output'], category: 'settings' },
  { id: 'settings-data-layer', label: 'Jump to Data Layer', keywords: ['data layer', 'kupo', 'ogmios'], category: 'settings' },
]

export function getCommands(): Command[] {
  return COMMANDS
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return commands
  return commands.filter((cmd) => {
    if (cmd.label.toLowerCase().includes(trimmed)) return true
    return cmd.keywords.some((kw) => kw.toLowerCase().includes(trimmed))
  })
}
