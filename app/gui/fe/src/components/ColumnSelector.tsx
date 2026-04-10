import type { ColumnCount } from '../hooks/useTabFilterState';

interface ColumnSelectorProps {
  value: ColumnCount;
  onChange: (cols: ColumnCount) => void;
}

const COLUMN_OPTIONS: ColumnCount[] = [2, 3, 4];

export default function ColumnSelector({ value, onChange }: ColumnSelectorProps) {
  return (
    <div className="flex border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden" role="group" aria-label="Column count">
      {COLUMN_OPTIONS.map((cols) => (
        <button
          key={cols}
          onClick={() => onChange(cols)}
          className={`px-2.5 py-2 transition-all duration-[var(--transition-fast)] cursor-pointer text-xs font-medium ${
            value === cols
              ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
              : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
          title={`${cols} columns`}
          aria-label={`${cols} columns`}
          aria-pressed={value === cols}
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
  );
}
