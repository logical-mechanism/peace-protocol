import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalStack } from '../hooks/useModalStack'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { getCommands, filterCommands, type Command, type CommandCategory } from '../services/commandRegistry'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onExecute: (commandId: string) => void
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  action: 'Actions',
  settings: 'Settings',
}

export default function CommandPalette({ isOpen, onClose, onExecute }: CommandPaletteProps) {
  const { zIndex, shouldRender, isTopmost } = useModalStack('command-palette', isOpen, onClose)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, isOpen && isTopmost)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)

  const allCommands = useMemo(() => getCommands(), [])
  const filtered = useMemo(() => filterCommands(allCommands, query), [allCommands, query])

  // Reset state when the palette opens (derived from props, not via effect)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }

  // Clamp selected index during render when filtered list shrinks
  const clampedIndex =
    selectedIndex >= filtered.length
      ? filtered.length > 0
        ? filtered.length - 1
        : 0
      : selectedIndex
  if (clampedIndex !== selectedIndex) {
    setSelectedIndex(clampedIndex)
  }

  // Grouped for display
  const grouped = useMemo(() => {
    const order: CommandCategory[] = ['navigation', 'action', 'settings']
    return order
      .map((cat) => ({
        category: cat,
        items: filtered.filter((c) => c.category === cat),
      }))
      .filter((g) => g.items.length > 0)
  }, [filtered])

  // Focus input when the palette opens
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [isOpen])

  // Keep selected item in view
  useEffect(() => {
    if (!isOpen) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${selectedIndex}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex, isOpen])

  if (!shouldRender) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length === 0) return
      setSelectedIndex((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = filtered[selectedIndex]
      if (cmd) {
        onExecute(cmd.id)
        onClose()
      }
    }
  }

  // Flat ordered list matches `filtered` order (category groups preserve this since filter preserves registry order)
  const flatOrdered: Command[] = grouped.flatMap((g) => g.items)

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[15vh]"
      style={{ zIndex }}
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm modal-backdrop-enter"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="relative w-full max-w-lg mx-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg modal-panel-enter flex flex-col max-h-[70vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="p-3 border-b border-[var(--border-subtle)]">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            aria-label="Command search"
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div ref={listRef} className="overflow-y-auto flex-1">
          {flatOrdered.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--text-secondary)]">
              No matching commands
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="py-1">
                <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {CATEGORY_LABELS[group.category]}
                </div>
                {group.items.map((cmd) => {
                  const flatIndex = flatOrdered.indexOf(cmd)
                  const isSelected = flatIndex === selectedIndex
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      data-cmd-index={flatIndex}
                      onClick={() => {
                        onExecute(cmd.id)
                        onClose()
                      }}
                      onMouseEnter={() => setSelectedIndex(flatIndex)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                        isSelected
                          ? 'bg-[var(--accent-muted)] text-[var(--text-primary)]'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                      }`}
                    >
                      <span>{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="px-1.5 py-0.5 text-xs font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-secondary)]">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
