import { useState, useRef, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface SelectOption {
  value: string
  label: string
  /** Optional right-aligned adornment (e.g. a chevron for hierarchical submenus). */
  trailing?: ReactNode
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** Show an inline search box once the option count exceeds this. Default 6. */
  searchThreshold?: number
  className?: string
  ariaLabel?: string
}

/**
 * Styled single-select dropdown. Matches the app's CSS variable theme (accent
 * ring on open, secondary background on trigger, elevated dropdown panel) and
 * auto-adds an inline search field once the option count exceeds the
 * threshold. Extracted from `SubCategorySelector` so every dropdown looks the
 * same — prefer this over the native `<select>` element.
 */
export default function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  searchThreshold = 6,
  className = '',
  ariaLabel,
}: SelectProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('select.placeholder')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stop the modal stack from closing the enclosing dialog on the same Escape press.
        e.stopPropagation()
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const selectedItem = options.find((o) => o.value === value)

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/50'
            : 'border-[var(--border-subtle)] hover:border-[var(--text-muted)]'
        } bg-[var(--bg-secondary)] text-[var(--text-primary)]`}
      >
        <span className={selectedItem ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
          {selectedItem ? selectedItem.label : resolvedPlaceholder}
        </span>
        <svg
          className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 z-10 mt-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] overflow-hidden"
        >
          {options.length > searchThreshold && (
            <div className="p-2 border-b border-[var(--border-subtle)]">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('select.searchPlaceholder')}
                className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          )}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--text-muted)]">{t('select.noMatches')}</p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer flex items-center justify-between ${
                    opt.value === value
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  <span>{opt.label}</span>
                  {opt.trailing}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
