import { useState, useRef, useEffect, memo } from 'react';
import { getSubcategories, getCategoryConfig, type FileCategory, type SubCategory } from '../config/categories';

interface SubCategorySelectorProps {
  category: FileCategory;
  selected: string;
  onChange: (subcategory: string) => void;
  disabled?: boolean;
}

function SubCategorySelector({ category, selected, onChange, disabled }: SubCategorySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const subcategories = getSubcategories(category);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]);

  // Focus search input on open
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  if (subcategories.length === 0) return null;

  const filtered = search
    ? subcategories.filter((s) => s.label.toLowerCase().includes(search.toLowerCase()))
    : subcategories;

  const selectedSub = subcategories.find((s) => s.id === selected);
  const categoryConfig = getCategoryConfig(category);

  const handleSelect = (sub: SubCategory) => {
    onChange(sub.id);
    setOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setOpen(false);
    setSearch('');
  };

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
        Sub-category <span className="text-xs font-normal text-[var(--text-muted)]">(optional)</span>
      </label>

      {/* Breadcrumb display when selected */}
      {selectedSub && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
            {categoryConfig?.label}
          </span>
          <svg className="w-3 h-3 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
            {selectedSub.label}
          </span>
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="ml-1 p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:cursor-not-allowed"
            aria-label="Clear sub-category"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          className={`w-full flex items-center justify-between px-3 py-2 text-sm border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            open
              ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/50'
              : 'border-[var(--border-subtle)] hover:border-[var(--text-muted)]'
          } bg-[var(--bg-secondary)] text-[var(--text-primary)]`}
          aria-expanded={open}
          aria-label="Select sub-category"
        >
          <span className={selectedSub ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
            {selectedSub ? selectedSub.label : 'Select a sub-category...'}
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
          <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] overflow-hidden">
            {/* Search input */}
            <div className="p-2 border-b border-[var(--border-subtle)]">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full px-2.5 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Options */}
            <div className="max-h-48 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No matches</p>
              ) : (
                filtered.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => handleSelect(sub)}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                      sub.id === selected
                        ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SubCategorySelector);
