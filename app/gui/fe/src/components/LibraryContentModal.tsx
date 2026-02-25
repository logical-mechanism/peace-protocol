import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type { LibraryItem } from '../services/libraryService';
import { readLibraryContent, deleteLibraryItem, exportLibraryContent } from '../services/libraryService';
import { copyToClipboard } from '../utils/clipboard';
import { truncateHex } from '../utils/truncate';
import { useModalStack } from '../hooks/useModalStack';
import ConfirmModal from './ConfirmModal';
import LoadingSpinner from './LoadingSpinner';
import Badge from './Badge';

const PdfViewer = lazy(() => import('./PdfViewer'));
const ImageViewer = lazy(() => import('./ImageViewer'));
const AudioPlayer = lazy(() => import('./AudioPlayer'));
const VideoPlayer = lazy(() => import('./VideoPlayer'));

interface LibraryContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: LibraryItem | null;
  onDelete: (item: LibraryItem) => void;
}

type ModalState = 'loading' | 'loaded' | 'error';


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


/** Map file extensions to human-readable labels. */
const FILE_TYPE_LABELS: Record<string, string> = {
  '.pdf': 'PDF Document',
  '.doc': 'Word Document',
  '.docx': 'Word Document',
  '.xls': 'Excel Spreadsheet',
  '.xlsx': 'Excel Spreadsheet',
  '.csv': 'CSV File',
  '.txt': 'Text File',
  '.rtf': 'Rich Text Document',
  '.png': 'PNG Image',
  '.jpg': 'JPEG Image',
  '.jpeg': 'JPEG Image',
  '.gif': 'GIF Image',
  '.webp': 'WebP Image',
  '.svg': 'SVG Image',
  '.bmp': 'BMP Image',
  '.mp4': 'MP4 Video',
  '.mkv': 'MKV Video',
  '.avi': 'AVI Video',
  '.mov': 'MOV Video',
  '.webm': 'WebM Video',
  '.mp3': 'MP3 Audio',
  '.wav': 'WAV Audio',
  '.flac': 'FLAC Audio',
  '.ogg': 'OGG Audio',
  '.aac': 'AAC Audio',
  '.m4a': 'M4A Audio',
  '.opus': 'Opus Audio',
  '.m4v': 'M4V Video',
  '.pptx': 'PowerPoint Presentation',
  '.odt': 'OpenDocument Text',
};

/** Determine view mode based on file extension, falling back to category for old listings. */
function getViewMode(category: string, fileExtension?: string) {
  // Text category (on-chain, no file) always renders as text
  if (category === 'text' || !category) {
    return 'text' as const;
  }

  const ext = fileExtension?.toLowerCase();

  // Extension-first detection for known file types
  if (ext) {
    if (['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.opus'].includes(ext)) return 'audio' as const;
    if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].includes(ext)) return 'video' as const;
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return 'image' as const;
    if (ext === '.pdf') return 'pdf' as const;
    if (ext === '.csv' || ext === '.txt') return 'text' as const;
    // Known extension but no viewer — download
    return 'download' as const;
  }

  // No extension: fall back to category-based logic (backward compat for old listings)
  if (category === 'audio') return 'audio' as const;
  if (category === 'video') return 'video' as const;
  if (category === 'image') return 'image' as const;
  if (category === 'document') return 'pdf' as const;

  return 'download' as const;
}

/** Map image file extension to MIME type for Blob creation. */
function extensionToMimeType(ext?: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
  };
  return map[ext?.toLowerCase() ?? ''] ?? 'image/png';
}

/** Map video file extension to MIME type for Blob creation. */
function videoExtensionToMimeType(ext?: string): string {
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/mp4',
    '.ogg': 'video/ogg',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/mp4',
  };
  return map[ext?.toLowerCase() ?? ''] ?? 'video/mp4';
}

export default function LibraryContentModal({
  isOpen,
  onClose,
  item,
  onDelete,
}: LibraryContentModalProps) {
  const [state, setState] = useState<ModalState>('loading');
  const [textContent, setTextContent] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  // Effect 1: Reset state and load content when modal opens
  useEffect(() => {
    if (!isOpen || !item) return;

    setState('loading');
    setTextContent(null);
    setRawContent(null);
    setError(null);
    setCopied(false);
    setConfirmingDelete(false);
    setDeleting(false);
    setExporting(false);
    setExportedPath(null);

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

        const viewMode = getViewMode(item.category, item.fileExtension);

        if (viewMode === 'text') {
          const text = new TextDecoder().decode(data);
          setTextContent(text);
        }
        if (viewMode === 'pdf' || viewMode === 'image' || viewMode === 'audio' || viewMode === 'video' || viewMode === 'download') {
          setRawContent(data);
        }
        setState('loaded');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setError(err instanceof Error ? err.message : 'Failed to load content');
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, item]);

  // Stack-aware Escape key + body scroll lock
  const { zIndex } = useModalStack('library-content', isOpen, onClose, deleting || confirmingDelete);

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

  const handleExport = useCallback(async () => {
    if (!item) return;
    setExporting(true);
    setExportedPath(null);
    try {
      const ext = item.fileExtension || (item.category === 'document' ? '.pdf' : '.bin');
      const suggestedFilename = item.tokenName + ext;
      const path = await exportLibraryContent(item.tokenName, item.category, suggestedFilename);
      if (path) {
        setExportedPath(path);
        setTimeout(() => setExportedPath(null), 3000);
      }
    } catch (err) {
      console.error('Failed to export library item:', err);
    } finally {
      setExporting(false);
    }
  }, [item]);

  if (!isOpen || !item) return null;

  const viewMode = getViewMode(item.category, item.fileExtension);
  const isWideModal = viewMode === 'pdf' || viewMode === 'image' || viewMode === 'audio' || viewMode === 'video';
  const fileTypeLabel = item.fileExtension
    ? (FILE_TYPE_LABELS[item.fileExtension.toLowerCase()] || `${item.fileExtension.toUpperCase().slice(1)} File`)
    : getCategoryLabel(item.category) + ' file';
  // Show Save As for all non-text categories (documents, other, audio, image, video)
  const showSaveAs = item.category !== 'text' && !!item.category;

  return (
    <>
      <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex }}>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={!deleting ? onClose : undefined}
        />

        {/* Modal */}
        <div className={`relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-2xl w-full max-h-[85vh] overflow-hidden flex flex-col ${isWideModal ? 'max-w-4xl' : 'max-w-2xl'}`}>
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)]">
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                Library
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {truncateHex(item.tokenName, 12, 6)}
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
                {item.fileExtension && (
                  <Badge variant="neutral">{item.fileExtension.toUpperCase().slice(1)}</Badge>
                )}
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
                      {truncateHex(item.seller, 10, 6)}
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

            {/* Loaded state — text content (text category, CSV, TXT documents) */}
            {state === 'loaded' && viewMode === 'text' && textContent !== null && (
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

            {/* Loaded state — PDF document viewer */}
            {state === 'loaded' && viewMode === 'pdf' && rawContent && (
              <Suspense fallback={
                <div className="py-12 text-center">
                  <LoadingSpinner size="lg" className="mx-auto mb-4" />
                  <p className="text-sm text-[var(--text-muted)]">Loading PDF viewer...</p>
                </div>
              }>
                <PdfViewer data={rawContent} onExport={handleExport} />
              </Suspense>
            )}

            {/* Loaded state — image viewer */}
            {state === 'loaded' && viewMode === 'image' && rawContent && (
              <Suspense fallback={
                <div className="py-12 text-center">
                  <LoadingSpinner size="lg" className="mx-auto mb-4" />
                  <p className="text-sm text-[var(--text-muted)]">Loading image viewer...</p>
                </div>
              }>
                <ImageViewer data={rawContent} mimeType={extensionToMimeType(item.fileExtension)} onExport={handleExport} />
              </Suspense>
            )}

            {/* Loaded state — Audio player */}
            {state === 'loaded' && viewMode === 'audio' && rawContent && (
              <Suspense fallback={
                <div className="py-12 text-center">
                  <LoadingSpinner size="lg" className="mx-auto mb-4" />
                  <p className="text-sm text-[var(--text-muted)]">Loading audio player...</p>
                </div>
              }>
                <AudioPlayer data={rawContent} fileExtension={item.fileExtension || '.mp3'} />
              </Suspense>
            )}

            {/* Loaded state — Video player */}
            {state === 'loaded' && viewMode === 'video' && rawContent && (
              <Suspense fallback={
                <div className="py-12 text-center">
                  <LoadingSpinner size="lg" className="mx-auto mb-4" />
                  <p className="text-sm text-[var(--text-muted)]">Loading video player...</p>
                </div>
              }>
                <VideoPlayer
                  data={rawContent}
                  mimeType={videoExtensionToMimeType(item.fileExtension)}
                  fileExtension={item.fileExtension || '.mp4'}
                  onExport={handleExport}
                />
              </Suspense>
            )}

            {/* Loaded state — download-only (non-renderable documents, other category, etc.) */}
            {state === 'loaded' && viewMode === 'download' && (
              <div className="p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-center space-y-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-[var(--accent-muted)] flex items-center justify-center">
                  <svg className="w-7 h-7 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {fileTypeLabel}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  This file type cannot be previewed. Use Save As to open it with an external application.
                </p>
              </div>
            )}

            {/* Export success indicator */}
            {exportedPath && (
              <div className="mt-4 flex items-center gap-2 p-3 bg-[var(--success-muted)] rounded-[var(--radius-md)]">
                <svg className="w-4 h-4 text-[var(--success)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-[var(--success)] truncate">
                  Saved to {exportedPath}
                </span>
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
              {showSaveAs && (
                <button
                  onClick={handleExport}
                  disabled={exporting || state !== 'loaded'}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    viewMode === 'download'
                      ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90'
                      : 'border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {exporting ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  )}
                  Save As
                </button>
              )}
              <button
                onClick={onClose}
                className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer ${
                  viewMode === 'download' && showSaveAs
                    ? 'border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
                    : 'bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90'
                }`}
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
