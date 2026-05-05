import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ReleaseNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
  releaseNotes: string;
}

export default function ReleaseNotesModal({
  isOpen,
  onClose,
  version,
  releaseNotes,
}: ReleaseNotesModalProps) {
  const { t } = useTranslation(['modals', 'common', 'settings']);
  const { zIndex, shouldRender, animationState } = useModalStack('release-notes', isOpen, onClose);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen);

  if (!shouldRender) return null;

  return createPortal(
    <div
      ref={modalRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-modal-title"
    >
      <div
        className={`absolute inset-0 bg-[var(--backdrop-overlay)] backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div className={`relative w-full max-w-2xl max-h-[80vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg flex flex-col mx-4 ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] rounded-t-[var(--radius-xl)]">
          <div>
            <h2 id="release-notes-modal-title" className="text-lg font-semibold text-[var(--text-primary)]">
              {t('settings:update.releaseNotesModalTitle')}
            </h2>
            <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5">v{version}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('modals:common.closeDialog')}
            tabIndex={-1}
            className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <pre className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words font-sans leading-relaxed">
            {releaseNotes}
          </pre>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] rounded-b-[var(--radius-xl)]">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            {t('common:actions.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
