import { useRef } from 'react';
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
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('confirm', isOpen, onClose, loading);
  const modalRef = useRef<HTMLDivElement>(null);
  // Default focus lands on the affirmative button so a keyboard user can
  // press Enter to accept (Tab/Shift+Tab still reaches Cancel).
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(modalRef, isOpen, confirmButtonRef);

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

      {/* Modal */}
      <div className={`relative z-10 w-full max-w-md max-h-[85vh] mx-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-xl flex flex-col overflow-hidden ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        <div className="flex-1 overflow-y-auto p-6">
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

        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] flex items-center gap-2 ${confirmClass}`}
          >
            {loading && <LoadingSpinner size="sm" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
