import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryItem } from '../services/libraryService';
import { readLibraryContent, deleteLibraryItem, exportLibraryContent, openWithSystem, getLibraryContentUrl, getLibrarySubtitleUrl } from '../services/libraryService';
import { copyToClipboard } from '../utils/clipboard';
import { truncateHex } from '../utils/truncate';
import { formatBytes } from '../utils/formatBytes';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import ConfirmModal from './ConfirmModal';
import { DelayedSpinner } from './LoadingSpinner';
import Badge from './Badge';
import { formatDateTime } from '../utils/formatDate';

const PdfViewer = lazy(() => import('./PdfViewer'));
const ImageViewer = lazy(() => import('./ImageViewer'));
const AudioPlayer = lazy(() => import('./audio'));
const VideoPlayer = lazy(() => import('./video'));

interface LibraryContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: LibraryItem | null;
  onDelete: (item: LibraryItem) => void;
  onRelist?: (item: LibraryItem) => void;
  items?: LibraryItem[];
  currentIndex?: number;
  onNavigate?: (item: LibraryItem, index: number) => void;
}

type ModalState = 'loading' | 'loaded' | 'error';


// Category labels are resolved via t('common:categories.{id}') in the component below


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
    '.mov': 'video/quicktime',
    '.ogg': 'video/ogg',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/mp4',
  };
  return map[ext?.toLowerCase() ?? ''] ?? 'video/mp4';
}

type ViewMode = ReturnType<typeof getViewMode>;

function ContentSkeleton({ viewMode }: { viewMode: ViewMode }) {
  switch (viewMode) {
    case 'pdf':
      return (
        <div className="space-y-4">
          <div className="w-full h-[500px] rounded-[var(--radius-md)] skeleton-shimmer" />
          <div className="flex items-center justify-center gap-3">
            <div className="h-8 w-24 rounded-[var(--radius-md)] skeleton-shimmer" />
            <div className="h-8 w-20 rounded-[var(--radius-md)] skeleton-shimmer" />
            <div className="h-8 w-24 rounded-[var(--radius-md)] skeleton-shimmer" />
          </div>
        </div>
      );
    case 'image':
      return (
        <div className="flex items-center justify-center">
          <div className="w-full h-[400px] rounded-[var(--radius-md)] skeleton-shimmer" />
        </div>
      );
    case 'audio':
      return (
        <div className="space-y-4">
          <div className="w-full h-[200px] rounded-[var(--radius-md)] skeleton-shimmer" />
          <div className="flex items-center justify-center gap-4">
            <div className="h-10 w-10 rounded-full skeleton-shimmer" />
            <div className="h-10 w-10 rounded-full skeleton-shimmer" />
            <div className="h-10 w-10 rounded-full skeleton-shimmer" />
          </div>
          <div className="h-2 w-full rounded-full skeleton-shimmer" />
        </div>
      );
    case 'video':
      return (
        <div className="space-y-3">
          <div className="w-full aspect-video rounded-[var(--radius-md)] skeleton-shimmer" />
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded skeleton-shimmer" />
            <div className="flex-1 h-2 rounded-full skeleton-shimmer" />
            <div className="h-8 w-16 rounded skeleton-shimmer" />
          </div>
        </div>
      );
    case 'text':
      return (
        <div className="space-y-2 p-4">
          <div className="h-4 w-full rounded skeleton-shimmer" />
          <div className="h-4 w-11/12 rounded skeleton-shimmer" />
          <div className="h-4 w-4/5 rounded skeleton-shimmer" />
          <div className="h-4 w-full rounded skeleton-shimmer" />
          <div className="h-4 w-3/4 rounded skeleton-shimmer" />
          <div className="h-4 w-5/6 rounded skeleton-shimmer" />
          <div className="h-4 w-2/3 rounded skeleton-shimmer" />
          <div className="h-4 w-full rounded skeleton-shimmer" />
        </div>
      );
    default:
      return (
        <div className="p-6 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full skeleton-shimmer" />
          <div className="h-4 w-32 mx-auto rounded skeleton-shimmer" />
          <div className="h-3 w-48 mx-auto rounded skeleton-shimmer" />
        </div>
      );
  }
}

export default function LibraryContentModal({
  isOpen,
  onClose,
  item,
  onDelete,
  onRelist,
  items,
  currentIndex,
  onNavigate,
}: LibraryContentModalProps) {
  const { t, i18n } = useTranslation(['modals', 'common']);
  const [state, setState] = useState<ModalState>('loading');
  const [textContent, setTextContent] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<Uint8Array | null>(null);
  // URL for streamable media (video/audio) — avoids reading entire file into memory via IPC
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
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
    setContentUrl(null);
    setSubtitleUrl(null);
    setError(null);
    setCopied(false);
    setConfirmingDelete(false);
    setDeleting(false);
    setExporting(false);
    setExportedPath(null);

    if (item.contentMissing) {
      setState('error');
      setError(t('modals:libraryContent.contentMissingError'));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const viewMode = getViewMode(item.category, item.fileExtension);

        if (viewMode === 'video') {
          // Stream from disk via media server URL — avoids reading entire file into memory via IPC
          const url = await getLibraryContentUrl(item.tokenName, item.category);
          if (cancelled) return;
          setContentUrl(url);
          // Load subtitle URL for videos (best-effort, non-blocking)
          getLibrarySubtitleUrl(item.tokenName, item.category)
            .then(subUrl => { if (!cancelled) setSubtitleUrl(subUrl); })
            .catch(() => {}); // Subtitle not found is fine
        } else if (viewMode === 'audio') {
          // Audio playback handled by rodio (Rust) via Tauri IPC — no URL needed
        } else {
          // For non-streamable content, read into memory (text, PDF, image, download)
          const data = await readLibraryContent(item.tokenName, item.category);
          if (cancelled) return;

          if (viewMode === 'text') {
            const text = new TextDecoder().decode(data);
            setTextContent(text);
          }
          if (viewMode === 'pdf' || viewMode === 'image' || viewMode === 'download') {
            setRawContent(data);
          }
        }
        setState('loaded');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setError(err instanceof Error ? err.message : t('modals:libraryContent.loadFailed'));
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, item, t]);

  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState, isTopmost } = useModalStack('library-content', isOpen, onClose, deleting || confirmingDelete);
  const modalRef = useRef<HTMLDivElement>(null);
  // Footer Close is reordered to be first in DOM below so useFocusTrap's
  // natural "first focusable" fallback lands on it. Content varies wildly
  // by file type (PDF/audio/video/text) — Close is the only stable
  // starting point. Header X and Prev/Next nav arrows are tabIndex={-1}
  // (Escape closes, arrow keys navigate) so they don't crowd the cycle.
  useFocusTrap(modalRef, isOpen, { isTopmost });

  const handleCopy = useCallback(async () => {
    if (!textContent) return;
    const success = await copyToClipboard(textContent);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      console.warn('Clipboard copy failed for library content');
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

  const handleOpenExternal = useCallback(async () => {
    if (!item) return;
    try {
      await openWithSystem(item.tokenName, item.category);
    } catch (err) {
      console.error('Failed to open with system player:', err);
    }
  }, [item]);

  // Navigation
  const canGoPrev = items != null && currentIndex != null && currentIndex > 0;
  const canGoNext = items != null && currentIndex != null && currentIndex < items.length - 1;

  const handlePrev = useCallback(() => {
    if (!items || currentIndex == null || currentIndex <= 0 || !onNavigate) return;
    onNavigate(items[currentIndex - 1], currentIndex - 1);
  }, [items, currentIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (!items || currentIndex == null || currentIndex >= items.length - 1 || !onNavigate) return;
    onNavigate(items[currentIndex + 1], currentIndex + 1);
  }, [items, currentIndex, onNavigate]);

  // Arrow key navigation
  useEffect(() => {
    if (!isOpen || !onNavigate) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate when interacting with form elements
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' && canGoPrev) {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' && canGoNext) {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onNavigate, canGoPrev, canGoNext, handlePrev, handleNext]);

  if (!shouldRender || !item) return null;

  const viewMode = getViewMode(item.category, item.fileExtension);
  const isWideModal = viewMode === 'pdf' || viewMode === 'image' || viewMode === 'audio' || viewMode === 'video';
  const extKey = item.fileExtension ? item.fileExtension.toLowerCase().replace(/^\./, '') : '';
  const fileTypeLabel = item.fileExtension
    ? (i18n.exists(`modals:libraryContent.fileTypes.${extKey}`)
        ? t(`modals:libraryContent.fileTypes.${extKey}`)
        : t('modals:libraryContent.fileDefault', { type: item.fileExtension.toUpperCase().slice(1) }))
    : t('modals:libraryContent.fileDefault', { type: t(`common:categories.${item.category || 'text'}`) });
  // Show Save As for all non-text categories (documents, other, audio, image, video)
  const showSaveAs = item.category !== 'text' && !!item.category;

  return (
    <>
      <div
        ref={modalRef}
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-content-title"
      >
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
          onClick={!deleting ? onClose : undefined}
          aria-hidden="true"
        />

        {/* Modal — overflow-hidden moved off the panel so focus outlines on
         * edge-adjacent buttons aren't clipped in WebKit. */}
        <div className={`relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-2xl w-full max-h-[85vh] flex flex-col ${isWideModal ? 'max-w-4xl' : 'max-w-2xl'} ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] rounded-t-[var(--radius-lg)]">
            <div className="flex items-center gap-3">
              {/* Previous button — tabIndex={-1} because arrow keys handle
               * item navigation (see keydown effect above) and we don't
               * want it crowding the Tab cycle. */}
              {items && items.length > 1 && (
                <button
                  onClick={handlePrev}
                  disabled={!canGoPrev}
                  tabIndex={-1}
                  className="p-2 rounded-[var(--radius-md)] disabled:opacity-30 btn-base btn-icon"
                  title={t('modals:libraryContent.prevItemTitle')}
                  aria-label={t('modals:libraryContent.prevItem')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="library-content-title" className="text-xl font-semibold text-[var(--text-primary)]">
                    {t('modals:libraryContent.title')}
                  </h2>
                  {items && items.length > 1 && currentIndex != null && (
                    <span className="text-sm text-[var(--text-muted)]">
                      {t('modals:libraryContent.position', { current: currentIndex + 1, total: items.length })}
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-1" title={item.tokenName}>
                  {truncateHex(item.tokenName, 12, 6)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* Next button — tabIndex={-1} (arrow keys navigate). */}
              {items && items.length > 1 && (
                <button
                  onClick={handleNext}
                  disabled={!canGoNext}
                  tabIndex={-1}
                  className="p-2 rounded-[var(--radius-md)] disabled:opacity-30 btn-base btn-icon"
                  title={t('modals:libraryContent.nextItemTitle')}
                  aria-label={t('modals:libraryContent.nextItem')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {/* Header X — tabIndex={-1} (Escape closes per ARIA pattern). */}
              <button
                onClick={onClose}
                aria-label={t('modals:common.closeDialog')}
                tabIndex={-1}
                className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Metadata — compact two-row layout */}
            <div className="mb-3 px-3 py-2 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="accent">{t(`common:categories.${item.category || 'text'}`)}</Badge>
                {item.fileExtension && (
                  <Badge variant="neutral">{item.fileExtension.toUpperCase().slice(1)}</Badge>
                )}
                {item.contentMissing && <Badge variant="warning">{t('modals:libraryContent.contentMissing')}</Badge>}
                {item.description && (
                  <span className="text-xs text-[var(--text-secondary)] truncate ml-1" title={item.description}>{item.description}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-[var(--text-muted)]">
                {item.sellerPkh && (<>
                  <span><span className="text-[var(--accent)] opacity-70">{t('modals:libraryContent.seller')}</span> <span className="font-mono text-[var(--text-secondary)]" title={item.sellerPkh}>{truncateHex(item.sellerPkh, 10, 6)}</span></span>
                  <span className="opacity-30">&middot;</span>
                </>)}
                {item.createdAt && (<>
                  <span><span className="text-[var(--accent)] opacity-70">{t('modals:libraryContent.listed')}</span> <span className="text-[var(--text-secondary)]">{formatDateTime(item.createdAt)}</span></span>
                  <span className="opacity-30">&middot;</span>
                </>)}
                <span><span className="text-[var(--accent)] opacity-70">{t('modals:libraryContent.decrypted')}</span> <span className="text-[var(--text-secondary)]">{formatDateTime(item.decryptedAt)}</span></span>
                {item.storageLayer && (<>
                  <span className="opacity-30">&middot;</span>
                  <span><span className="text-[var(--accent)] opacity-70">{t('modals:libraryContent.storage')}</span> <span className="text-[var(--text-secondary)]">{item.storageLayer}</span></span>
                </>)}
                {item.fileSize != null && (<>
                  <span className="opacity-30">&middot;</span>
                  <span><span className="text-[var(--accent)] opacity-70">{t('modals:libraryContent.size')}</span> <span className="text-[var(--text-secondary)]">{formatBytes(item.fileSize)}</span></span>
                </>)}
              </div>
            </div>

            {/* Loading state */}
            {state === 'loading' && (
              <ContentSkeleton viewMode={viewMode} />
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
                    aria-label={t('modals:libraryContent.copyAriaLabel')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-secondary)] rounded-[var(--radius-md)] btn-base btn-tertiary"
                  >
                    {copied ? (
                      <>
                        <svg className="w-3.5 h-3.5 text-[var(--success)] copy-check-animate" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {t('modals:libraryContent.copied')}
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        {t('modals:libraryContent.copy')}
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
              <Suspense fallback={<ContentSkeleton viewMode="pdf" />}>
                <PdfViewer data={rawContent} onExport={handleExport} />
              </Suspense>
            )}

            {/* Loaded state — image viewer */}
            {state === 'loaded' && viewMode === 'image' && rawContent && (
              <Suspense fallback={<ContentSkeleton viewMode="image" />}>
                <ImageViewer data={rawContent} mimeType={extensionToMimeType(item.fileExtension)} onExport={handleExport} />
              </Suspense>
            )}

            {/* Loaded state — Audio player (rodio handles playback via Tauri IPC) */}
            {state === 'loaded' && viewMode === 'audio' && (
              <Suspense fallback={<ContentSkeleton viewMode="audio" />}>
                <AudioPlayer fileExtension={item.fileExtension || '.mp3'} tokenName={item.tokenName} category={item.category} onExport={handleExport} />
              </Suspense>
            )}

            {/* Loaded state — Video player */}
            {state === 'loaded' && viewMode === 'video' && contentUrl && (
              <Suspense fallback={<ContentSkeleton viewMode="video" />}>
                <VideoPlayer
                  src={contentUrl}
                  mimeType={videoExtensionToMimeType(item.fileExtension)}
                  fileExtension={item.fileExtension || '.mp4'}
                  onExport={handleExport}
                  subtitleUrl={subtitleUrl}
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
                  {t('modals:libraryContent.cannotPreview')}
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
                  {t('modals:libraryContent.savedTo', { path: exportedPath })}
                </span>
              </div>
            )}
          </div>

          {/* Footer — flex-row-reverse so Close is first in DOM (receives
           * initial focus from useFocusTrap) while still appearing on the
           * right visually. */}
          <div className="p-6 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] rounded-b-[var(--radius-lg)]">
            <div className="flex flex-row-reverse gap-3">
              <button
                onClick={onClose}
                className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                  viewMode === 'download' && showSaveAs
                    ? 'border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
                    : 'bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90'
                }`}
              >
                {t('modals:libraryContent.close')}
              </button>
              {showSaveAs && (
                <>
                  <button
                    onClick={handleExport}
                    disabled={exporting || state !== 'loaded'}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      viewMode === 'download'
                        ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90'
                        : 'border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {exporting ? (
                      <DelayedSpinner size="sm" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    )}
                    {t('modals:libraryContent.saveAs')}
                  </button>
                  <button
                    onClick={handleOpenExternal}
                    disabled={state !== 'loaded'}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-[var(--transition-fast)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('modals:libraryContent.openExternalTitle')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    {t('modals:libraryContent.openExternal')}
                  </button>
                </>
              )}
              {onRelist && item && !item.contentMissing && (
                <button
                  onClick={() => { onRelist(item); onClose(); }}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--accent-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {t('modals:libraryContent.relist')}
                </button>
              )}
              <button
                onClick={() => setConfirmingDelete(true)}
                className="px-4 py-2.5 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
              >
                {t('modals:libraryContent.deleteFromLibrary')}
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
        title={t('modals:libraryContent.deleteTitle')}
        message={t('modals:libraryContent.deleteMessage')}
        confirmLabel={t('modals:libraryContent.deleteConfirm')}
        confirmVariant="danger"
        loading={deleting}
      />
    </>
  );
}
