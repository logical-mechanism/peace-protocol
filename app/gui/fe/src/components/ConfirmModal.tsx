import { useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
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
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  // Escape key + body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const confirmClass =
    confirmVariant === 'danger'
      ? 'bg-[var(--error)] hover:bg-[var(--error)]/80 text-white'
      : 'bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
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
      <div className="relative z-10 w-full max-w-md mx-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-xl">
        <div className="p-6">
          <h2
            id="confirm-modal-title"
            className="text-lg font-semibold text-[var(--text-primary)] mb-2"
          >
            {title}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {message}
          </p>
        </div>

        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${confirmClass}`}
          >
            {loading && <LoadingSpinner size="sm" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
