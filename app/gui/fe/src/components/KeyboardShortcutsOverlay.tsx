import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Shortcut {
  keys: string;
  descriptionKey: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl + 1–5', descriptionKey: 'overlay.shortcuts.tabSwitch' },
  { keys: 'Ctrl + R', descriptionKey: 'overlay.shortcuts.refresh' },
  { keys: 'Ctrl + K', descriptionKey: 'overlay.shortcuts.commandPalette' },
  { keys: '← →', descriptionKey: 'overlay.shortcuts.tabNavigate' },
  { keys: 'Home / End', descriptionKey: 'overlay.shortcuts.tabFirstLast' },
  { keys: 'Esc', descriptionKey: 'overlay.shortcuts.closeModal' },
  { keys: '?', descriptionKey: 'overlay.shortcuts.toggleHelp' },
];

interface KeyboardShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsOverlay({
  isOpen,
  onClose,
}: KeyboardShortcutsOverlayProps) {
  const { t } = useTranslation('common');
  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(overlayRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[70] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm modal-backdrop-enter"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className="relative w-full max-w-md mx-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg p-6 modal-panel-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="shortcuts-title" className="text-lg font-semibold text-[var(--text-primary)]">
            {t('overlay.shortcutsTitle')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('overlay.shortcutsCloseDialog')}
            className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="py-2.5 pr-4">
                  <kbd
                    aria-label={t('overlay.shortcutKeyLabel', { keys: s.keys })}
                    className="px-2 py-1 text-xs font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)]"
                  >
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-2.5 text-sm text-[var(--text-secondary)]">
                  {t(s.descriptionKey)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
