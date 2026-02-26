import LoadingSpinner from './LoadingSpinner';
import { truncateDescription } from './descriptionUtils';
import { useModalStack } from '../hooks/useModalStack';

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
  const { zIndex } = useModalStack('confirm', isOpen, onClose, loading);

  if (!isOpen) return null;

  const confirmClass =
    confirmVariant === 'danger'
      ? 'bg-[var(--error)] hover:bg-[var(--error)]/80 text-white btn-base'
      : 'btn-base btn-primary';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md max-h-[85vh] mx-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-xl flex flex-col overflow-hidden">
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
