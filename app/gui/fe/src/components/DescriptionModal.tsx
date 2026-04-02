import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { truncateHex } from '../utils/truncate';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface DescriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  description: string;
  tokenName?: string;
}

export default function DescriptionModal({
  isOpen,
  onClose,
  description,
  tokenName,
}: DescriptionModalProps) {
  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('description', isOpen, onClose);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen);

  if (!shouldRender) return null;

  return createPortal(
    <div ref={modalRef} className="fixed inset-0 flex items-center justify-center" style={{ zIndex }}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className={`relative w-full max-w-lg max-h-[80vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden flex flex-col mx-4 ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Description
            </h2>
            {tokenName && (
              <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5" title={tokenName ?? ''}>
                {truncateHex(tokenName ?? '', 12, 6)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {description}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
