import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from './LoadingSpinner';
import { truncateDescription } from './descriptionUtils';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'default';
  loading?: boolean;
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  description,
  confirmLabel,
  confirmVariant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  const { t } = useTranslation('common');
  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState, isTopmost } = useModalStack('confirm', isOpen, onClose, loading);
  const modalRef = useRef<HTMLDivElement>(null);
  // Affirmative button is first in DOM order below so useFocusTrap's
  // natural "first focusable" fallback lands on it without any raf timing
  // race. flex-row-reverse keeps Cancel visually on the left.
  useFocusTrap(modalRef, isOpen, { isTopmost });

  if (!shouldRender) return null;

  const confirmClass =
    confirmVariant === 'danger'
      ? 'btn-base btn-danger'
      : 'btn-base btn-primary';

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={loading ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal — overflow-hidden lives on the scroll body, not the panel,
       * so focus outlines on edge-adjacent buttons don't get clipped. */}
      <div className={`relative z-10 w-full max-w-md max-h-[85vh] mx-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-xl flex flex-col ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        <div className="flex-1 overflow-y-auto p-6 rounded-t-[var(--radius-lg)]">
          <h2
            id="confirm-modal-title"
            className="text-lg font-semibold text-[var(--text-primary)] mb-2"
          >
            {title}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {message}
          </p>
          {description && (
            <p className="mt-3 text-xs text-[var(--text-tertiary)] leading-relaxed italic">
              {truncateDescription(description)}
            </p>
          )}
        </div>

        {/* flex-row-reverse: affirmative button is first in DOM (so it
         * receives initial focus from useFocusTrap) while Cancel stays
         * visually on the left. */}
        <div className="flex flex-row-reverse justify-start gap-3 px-6 pb-6 rounded-b-[var(--radius-lg)]">
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] flex items-center gap-2 ${confirmClass}`}
          >
            {loading && <LoadingSpinner size="sm" />}
            {confirmLabel ?? t('actions.confirm')}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            {t('actions.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
