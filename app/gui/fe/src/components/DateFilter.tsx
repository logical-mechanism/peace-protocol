import { useState, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import '../i18n';

interface DateFilterProps {
  label: string;
  value: string;          // 'YYYY-MM-DD' or ''
  onChange: (v: string) => void;
  ariaLabel: string;
}

function toDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function DateFilter({ label, value, onChange, ariaLabel }: DateFilterProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
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
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]);

  const selected = toDate(value);

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">{label}</label>
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-1.5 px-2 py-1.5 text-sm border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
            value
              ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
              : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
          aria-label={ariaLabel}
          aria-expanded={open}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="font-mono text-xs">{value || t('dashboard:filters.dateAny')}</span>
        </button>
        {value && (
          <button
            onClick={() => onChange('')}
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label={t('dashboard:filters.dateClear', { label: label.toLowerCase() })}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] rdp-theme">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (date) {
                onChange(toStr(date));
              } else {
                onChange('');
              }
              setOpen(false);
            }}
            defaultMonth={selected}
          />
        </div>
      )}
    </div>
  );
}

export default memo(DateFilter);
