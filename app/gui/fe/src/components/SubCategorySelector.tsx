import { useState, useRef, useEffect, memo } from 'react';
import { getSubcategories, getCategoryConfig, type FileCategory, type SubCategory } from '../config/categories';

interface SubCategorySelectorProps {
  category: FileCategory;
  selected: string;
  onChange: (subcategory: string) => void;
  disabled?: boolean;
}

/** A single dropdown level for selecting a subcategory. */
function LevelDropdown({
  items,
  selectedId,
  onSelect,
  placeholder,
  disabled,
}: {
  items: SubCategory[];
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = search
    ? items.filter((s) => s.label.toLowerCase().includes(search.toLowerCase()))
    : items;

  const selectedItem = items.find((s) => s.id === selectedId);

  return (
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
      >
        <span className={selectedItem ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
          {selectedItem ? selectedItem.label : placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] overflow-hidden">
          {items.length > 6 && (
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
          )}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No matches</p>
            ) : (
              filtered.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => { onSelect(sub.id); setOpen(false); setSearch(''); }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer flex items-center justify-between ${
                    sub.id === selectedId
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {sub.label}
                  {sub.children && sub.children.length > 0 && (
                    <svg className="w-3 h-3 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SubCategorySelector({ category, selected, onChange, disabled }: SubCategorySelectorProps) {
  const subcategories = getSubcategories(category);

  if (subcategories.length === 0) return null;

  // Parse selected into levels: "music:rock" → ["music", "rock"]
  const selectedParts = selected ? selected.split(':') : [];
  const level1Id = selectedParts[0] || '';
  const level2Id = selectedParts[1] || '';

  const level1Item = subcategories.find((s) => s.id === level1Id);
  const level2Items = level1Item?.children ?? [];

  const categoryConfig = getCategoryConfig(category);

  const handleLevel1Select = (id: string) => {
    // Selecting a new level 1 clears level 2
    onChange(id);
  };

  const handleLevel2Select = (id: string) => {
    onChange(`${level1Id}:${id}`);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const handleClearLevel2 = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(level1Id);
  };

  // Build breadcrumb labels
  const breadcrumbParts: string[] = [];
  if (categoryConfig) breadcrumbParts.push(categoryConfig.label);
  if (level1Item) breadcrumbParts.push(level1Item.label);
  if (level2Id) {
    const level2Item = level2Items.find((c) => c.id === level2Id);
    breadcrumbParts.push(level2Item?.label ?? level2Id);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
        Sub-category <span className="text-xs font-normal text-[var(--text-muted)]">(optional)</span>
      </label>

      {/* Breadcrumb display when selected */}
      {level1Id && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {breadcrumbParts.map((label, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <svg className="w-3 h-3 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                {label}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={level2Id ? handleClearLevel2 : handleClear}
            disabled={disabled}
            className="ml-1 p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:cursor-not-allowed"
            aria-label={level2Id ? 'Clear genre' : 'Clear sub-category'}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Level 1 dropdown */}
      <LevelDropdown
        items={subcategories}
        selectedId={level1Id}
        onSelect={handleLevel1Select}
        placeholder="None"
        disabled={disabled}
      />

      {/* Level 2 dropdown — only when level 1 has children */}
      {level1Id && level2Items.length > 0 && (
        <div className="mt-2">
          <LevelDropdown
            items={level2Items}
            selectedId={level2Id}
            onSelect={handleLevel2Select}
            placeholder="None"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

export default memo(SubCategorySelector);
