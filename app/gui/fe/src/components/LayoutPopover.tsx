import { useEffect, useRef, useState } from 'react';
import type { CardSize, ColumnCount } from '../hooks/useTabFilterState';

type ViewMode = 'grid' | 'list';

interface LayoutPopoverProps {
  viewMode: ViewMode;
  cardSize: CardSize;
  columnCount: ColumnCount;
  onViewModeChange: (mode: ViewMode) => void;
  onCardSizeChange: (size: CardSize) => void;
  onColumnCountChange: (cols: ColumnCount) => void;
}

const SIZE_OPTIONS: CardSize[] = ['small', 'medium', 'large'];
const COLUMN_OPTIONS: ColumnCount[] = [2, 3, 4];

export default function LayoutPopover({
  viewMode,
  cardSize,
  columnCount,
  onViewModeChange,
  onCardSizeChange,
  onColumnCountChange,
}: LayoutPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isGrid = viewMode === 'grid';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`px-3 py-2 border border-[var(--border-subtle)] rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
          open
            ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
            : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
        }`}
        title="Layout options"
        aria-label="Layout options"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Layout options"
          className="absolute right-0 top-full mt-2 z-30 w-56 p-3 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)]"
        >
          {/* View mode */}
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">View</div>
            <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden" role="group" aria-label="View mode">
              <button
                type="button"
                onClick={() => onViewModeChange('grid')}
                className={`flex-1 px-3 py-2 flex items-center justify-center transition-all duration-[var(--transition-fast)] cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('list')}
                className={`flex-1 px-3 py-2 flex items-center justify-center transition-all duration-[var(--transition-fast)] cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Card size — grid only */}
          <div className={`mb-3 transition-opacity duration-[var(--transition-fast)] ${isGrid ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Card size</div>
            <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden" role="group" aria-label="Card size">
              {SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onCardSizeChange(size)}
                  disabled={!isGrid}
                  className={`flex-1 px-2.5 py-2 flex items-center justify-center transition-all duration-[var(--transition-fast)] cursor-pointer ${
                    cardSize === size
                      ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                  title={`${size.charAt(0).toUpperCase() + size.slice(1)} cards`}
                  aria-label={`${size.charAt(0).toUpperCase() + size.slice(1)} cards`}
                  aria-pressed={cardSize === size}
                >
                  {size === 'small' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1" y="1" width="4" height="4" rx="0.5" /><rect x="6" y="1" width="4" height="4" rx="0.5" /><rect x="11" y="1" width="4" height="4" rx="0.5" />
                      <rect x="1" y="6" width="4" height="4" rx="0.5" /><rect x="6" y="6" width="4" height="4" rx="0.5" /><rect x="11" y="6" width="4" height="4" rx="0.5" />
                      <rect x="1" y="11" width="4" height="4" rx="0.5" /><rect x="6" y="11" width="4" height="4" rx="0.5" /><rect x="11" y="11" width="4" height="4" rx="0.5" />
                    </svg>
                  )}
                  {size === 'medium' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1" y="1" width="6" height="6" rx="0.75" /><rect x="9" y="1" width="6" height="6" rx="0.75" />
                      <rect x="1" y="9" width="6" height="6" rx="0.75" /><rect x="9" y="9" width="6" height="6" rx="0.75" />
                    </svg>
                  )}
                  {size === 'large' && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1" y="1" width="14" height="6" rx="1" />
                      <rect x="1" y="9" width="14" height="6" rx="1" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Column count — grid only */}
          <div className={`transition-opacity duration-[var(--transition-fast)] ${isGrid ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Columns</div>
            <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden" role="group" aria-label="Column count">
              {COLUMN_OPTIONS.map((cols) => (
                <button
                  key={cols}
                  type="button"
                  onClick={() => onColumnCountChange(cols)}
                  disabled={!isGrid}
                  className={`flex-1 px-2.5 py-2 flex items-center justify-center transition-all duration-[var(--transition-fast)] cursor-pointer ${
                    columnCount === cols
                      ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                  title={`${cols} columns`}
                  aria-label={`${cols} columns`}
                  aria-pressed={columnCount === cols}
                >
                  {cols === 2 && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1" y="1" width="6" height="14" rx="0.75" />
                      <rect x="9" y="1" width="6" height="14" rx="0.75" />
                    </svg>
                  )}
                  {cols === 3 && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="0.5" y="1" width="4" height="14" rx="0.5" />
                      <rect x="6" y="1" width="4" height="14" rx="0.5" />
                      <rect x="11.5" y="1" width="4" height="14" rx="0.5" />
                    </svg>
                  )}
                  {cols === 4 && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="0.5" y="1" width="2.75" height="14" rx="0.5" />
                      <rect x="4.75" y="1" width="2.75" height="14" rx="0.5" />
                      <rect x="9" y="1" width="2.75" height="14" rx="0.5" />
                      <rect x="13.25" y="1" width="2.75" height="14" rx="0.5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
