import { useState, useEffect, useCallback } from 'react';
import type { LibraryItem } from '../services/libraryService';
import { readLibraryContent, deleteLibraryItem } from '../services/libraryService';
import { copyToClipboard } from '../utils/clipboard';
import ConfirmModal from './ConfirmModal';
import LoadingSpinner from './LoadingSpinner';
import Badge from './Badge';

interface LibraryContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: LibraryItem | null;
  onDelete: (item: LibraryItem) => void;
}

type ModalState = 'loading' | 'loaded' | 'error';

const truncateToken = (token: string) => {
  if (!token) return '';
  return `${token.slice(0, 12)}...${token.slice(-6)}`;
};

const formatDate = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getCategoryLabel = (category: string): string => {
  if (!category) return 'Text';
  return category.charAt(0).toUpperCase() + category.slice(1);
};

const truncateSeller = (seller: string) => {
  if (!seller) return '';
  if (seller.length <= 20) return seller;
  return `${seller.slice(0, 10)}...${seller.slice(-6)}`;
};

export default function LibraryContentModal({
  isOpen,
  onClose,
  item,
  onDelete,
}: LibraryContentModalProps) {
  const [state, setState] = useState<ModalState>('loading');
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Effect 1: Reset state and load content when modal opens
  useEffect(() => {
    if (!isOpen || !item) return;

    /* eslint-disable react-hooks/set-state-in-effect */
    setState('loading');
    setTextContent(null);
    setError(null);
    setCopied(false);
    setConfirmingDelete(false);
    setDeleting(false);
    /* eslint-enable react-hooks/set-state-in-effect */

    if (item.contentMissing) {
      setState('error');
      setError('Content file not found on disk. The file may have been moved or deleted.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = await readLibraryContent(item.tokenName, item.category);
        if (cancelled) return;

        if (item.category === 'text' || !item.category) {
          const text = new TextDecoder().decode(data);
          setTextContent(text);
        }
        // For non-text categories, we don't display content inline yet
        setState('loaded');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setError(err instanceof Error ? err.message : 'Failed to load content');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, item]);

  // Effect 2: Escape key handler + body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting && !confirmingDelete) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, deleting, confirmingDelete, onClose]);

  const handleCopy = useCallback(async () => {
    if (!textContent) return;
    const success = await copyToClipboard(textContent);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [textContent]);

  const handleDelete = useCallback(async () => {
    if (!item) return;
    setDeleting(true);
    try {
      await deleteLibraryItem(item.tokenName, item.category);
      onDelete(item);
      setConfirmingDelete(false);
      onClose();
    } catch (err) {
      console.error('Failed to delete library item:', err);
      setDeleting(false);
    }
  }, [item, onDelete, onClose]);

  if (!isOpen || !item) return null;

  const isText = item.category === 'text' || !item.category;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={!deleting ? onClose : undefined}
        />

        {/* Modal */}
        <div className="relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)]">
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                Library
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {truncateToken(item.tokenName)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Metadata */}
            <div className="mb-6 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="accent">{getCategoryLabel(item.category)}</Badge>
                {item.contentMissing && <Badge variant="warning">Content Missing</Badge>}
              </div>

              {item.description && (
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                  {item.description}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border-subtle)]">
                {item.seller && (
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Seller</p>
                    <p className="text-sm font-mono text-[var(--text-secondary)]">
                      {truncateSeller(item.seller)}
                    </p>
                  </div>
                )}
                {item.createdAt && (
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Listed</p>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {formatDate(item.createdAt)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Decrypted</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {formatDate(item.decryptedAt)}
                  </p>
                </div>
                {item.storageLayer && (
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Storage</p>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {item.storageLayer}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Loading state */}
            {state === 'loading' && (
              <div className="py-12 text-center">
                <LoadingSpinner size="lg" className="mx-auto mb-4" />
                <p className="text-sm text-[var(--text-muted)]">Loading content...</p>
              </div>
            )}

            {/* Error state */}
            {state === 'error' && (
              <div className="p-4 bg-[var(--error-muted)] rounded-[var(--radius-md)] text-center">
                <svg className="w-8 h-8 mx-auto mb-2 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-[var(--error)]">{error}</p>
              </div>
            )}

            {/* Loaded state — text content */}
            {state === 'loaded' && isText && textContent !== null && (
              <div className="relative">
                <div className="absolute top-3 right-3">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <svg className="w-3.5 h-3.5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-4 pt-12 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-x-auto font-mono text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words min-h-[200px] max-h-[400px] overflow-y-auto">
                  {textContent}
                </pre>
              </div>
            )}

            {/* Loaded state — non-text placeholder */}
            {state === 'loaded' && !isText && (
              <div className="p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-center space-y-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-[var(--accent-muted)] flex items-center justify-center">
                  <svg className="w-7 h-7 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {getCategoryLabel(item.category)} file
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Content viewing for {item.category} files is not yet available.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmingDelete(true)}
                className="px-4 py-2.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
              >
                Delete from Library
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
        title="Delete from Library"
        message="This will permanently remove the decrypted content and metadata from your device. This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
      />
    </>
  );
}
