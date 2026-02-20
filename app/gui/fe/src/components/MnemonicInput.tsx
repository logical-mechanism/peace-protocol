import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import wordlist from 'bip39/src/wordlists/english.json'

const WORDLIST: string[] = wordlist

interface MnemonicInputProps {
  index: number
  value: string
  onChange: (index: number, value: string) => void
  onTab: (index: number) => void
  disabled?: boolean
  autoFocus?: boolean
}

/**
 * Single mnemonic word input with BIP-39 autocomplete.
 *
 * Typing filters the 2048-word list. Since each 4-letter prefix is unique,
 * the user can type 4 chars and press Enter/Tab to accept the match.
 */
export default function MnemonicInput({
  index,
  value,
  onChange,
  onTab,
  disabled = false,
  autoFocus = false,
}: MnemonicInputProps) {
  const [focused, setFocused] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const trimmed = value.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!trimmed) return []
    return WORDLIST.filter((w) => w.startsWith(trimmed)).slice(0, 6)
  }, [trimmed])

  const showDropdown = focused && trimmed.length > 0 && matches.length > 0 &&
    !(matches.length === 1 && matches[0] === trimmed)

  // Reset highlight when matches change (render-time adjustment per React docs)
  const matchKey = `${matches.length}:${trimmed}`
  const [prevMatchKey, setPrevMatchKey] = useState(matchKey)
  if (matchKey !== prevMatchKey) {
    setPrevMatchKey(matchKey)
    setHighlightIndex(0)
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (showDropdown && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex, showDropdown])

  const acceptMatch = useCallback(
    (word: string) => {
      onChange(index, word)
      setFocused(false)
      onTab(index)
    },
    [index, onChange, onTab]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown) {
        if (e.key === 'Tab' || e.key === 'Enter') {
          // If exact match, accept it
          if (WORDLIST.includes(trimmed)) {
            onChange(index, trimmed)
          }
          if (e.key === 'Tab') {
            // Let default tab behavior proceed
            return
          }
          e.preventDefault()
          onTab(index)
        }
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex((i) => Math.min(i + 1, matches.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptMatch(matches[highlightIndex])
      } else if (e.key === 'Escape') {
        setFocused(false)
      }
    },
    [showDropdown, matches, highlightIndex, acceptMatch, trimmed, index, onChange, onTab]
  )

  const isValid = trimmed && WORDLIST.includes(trimmed)

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 rounded-lg"
        style={{
          background: 'var(--bg-secondary)',
          border: `1px solid ${
            isValid
              ? 'var(--success)'
              : trimmed && !matches.length
                ? 'var(--error)'
                : focused
                  ? 'var(--border-focus)'
                  : 'var(--border-subtle)'
          }`,
        }}
      >
        <span
          className="text-xs w-7 text-right pl-2 shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          {index + 1}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(index, e.target.value.toLowerCase().replace(/[^a-z]/g, ''))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay to allow click on dropdown item
            setTimeout(() => setFocused(false), 150)
          }}
          onKeyDown={handleKeyDown}
          className="flex-1 py-1.5 pr-2 text-sm font-mono bg-transparent outline-none"
          style={{ color: 'var(--text-primary)' }}
          placeholder="..."
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div
          ref={listRef}
          className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {matches.map((word, i) => (
            <div
              key={word}
              onMouseDown={(e) => {
                e.preventDefault()
                acceptMatch(word)
              }}
              onMouseEnter={() => setHighlightIndex(i)}
              className="px-3 py-1.5 text-sm font-mono cursor-pointer"
              style={{
                background:
                  i === highlightIndex ? 'var(--accent-muted)' : 'transparent',
                color:
                  i === highlightIndex
                    ? 'var(--accent-hover)'
                    : 'var(--text-secondary)',
              }}
            >
              <span style={{ color: 'var(--text-primary)' }}>
                {word.slice(0, trimmed.length)}
              </span>
              {word.slice(trimmed.length)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function validateMnemonicWords(words: string[]): boolean {
  return words.length === 24 && words.every((w) => WORDLIST.includes(w.toLowerCase()))
}
