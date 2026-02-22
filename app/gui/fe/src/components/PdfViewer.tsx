import { useState, useCallback, useMemo, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import LoadingSpinner from './LoadingSpinner';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;

interface PdfViewerProps {
  data: Uint8Array;
}

export default function PdfViewer({ data }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Memoize the file prop to avoid unnecessary reloads.
  // Copy into a fresh Uint8Array so it's a true structured-cloneable object
  // (Tauri IPC returns a proxy that WebKitGTK can't clone for the pdf.js worker).
  const file = useMemo(() => ({ data: new Uint8Array(data) }), [data]);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setCurrentPage(1);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || 'Failed to load PDF');
  }, []);

  const zoomIn = useCallback(() => setScale(s => Math.min(ZOOM_MAX, s + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(ZOOM_MIN, s - ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setScale(1.0), []);

  // Escape key closes fullscreen (not the parent modal)
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsFullscreen(false);
      }
    };
    // Use capture phase so we intercept before the modal's escape handler
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isFullscreen]);

  if (error) {
    return (
      <div className="p-4 bg-[var(--error-muted)] rounded-[var(--radius-md)] text-center">
        <p className="text-sm text-[var(--error)]">Failed to load PDF: {error}</p>
      </div>
    );
  }

  const btnClass = "px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  const toolbar = (
    <div className="flex items-center justify-between">
      {/* Page navigation */}
      <div className="flex items-center gap-2">
        {numPages > 1 ? (
          <>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className={btnClass}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm text-[var(--text-secondary)] min-w-[80px] text-center">
              {currentPage} / {numPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}
              className={btnClass}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">1 page</span>
        )}
      </div>

      {/* Zoom controls + expand */}
      <div className="flex items-center gap-2">
        <button
          onClick={zoomOut}
          disabled={scale <= ZOOM_MIN}
          className={btnClass}
          title="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={zoomReset}
          className={`${btnClass} min-w-[52px] text-center`}
          title="Reset zoom"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={zoomIn}
          disabled={scale >= ZOOM_MAX}
          className={btnClass}
          title="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {/* Expand / Collapse button */}
        <div className="w-px h-5 bg-[var(--border-subtle)]" />
        <button
          onClick={() => setIsFullscreen(fs => !fs)}
          className={btnClass}
          title={isFullscreen ? 'Exit fullscreen' : 'Expand'}
        >
          {isFullscreen ? (
            // Collapse icon (arrows inward)
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m7 5l5-5m0 0v4m0-4h-4m-7 7l-5 5m0 0v-4m0 4h4m7-5l5 5m0 0v-4m0 4h-4" />
            </svg>
          ) : (
            // Expand icon (arrows outward)
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5m-7 14l-5 5m0 0h4m-4 0v-4m16 4l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );

  const pdfContent = (
    <Document
      file={file}
      onLoadSuccess={onDocumentLoadSuccess}
      onLoadError={onDocumentLoadError}
      loading={
        <div className="py-12 text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-sm text-[var(--text-muted)]">Loading PDF...</p>
        </div>
      }
    >
      <Page
        pageNumber={currentPage}
        scale={scale}
        loading={
          <div className="py-8 text-center">
            <LoadingSpinner size="sm" className="mx-auto" />
          </div>
        }
        renderTextLayer={true}
        renderAnnotationLayer={true}
      />
    </Document>
  );

  // Fullscreen overlay
  if (isFullscreen) {
    return (
      <>
        {/* Inline placeholder so LibraryContentModal layout isn't disrupted */}
        <div className="p-4 text-center text-sm text-[var(--text-muted)]">
          PDF is expanded to fullscreen. Press Esc or the collapse button to return.
        </div>

        {/* Fullscreen overlay rendered via portal-like fixed positioning */}
        <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--bg-primary)]">
          {/* Toolbar */}
          <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
            {toolbar}
          </div>

          {/* PDF content area */}
          <div className="flex-1 overflow-auto flex justify-center bg-[var(--bg-secondary)]">
            {pdfContent}
          </div>
        </div>
      </>
    );
  }

  // Normal inline view
  return (
    <div className="space-y-3">
      {toolbar}
      <div className="flex justify-center overflow-auto max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        {pdfContent}
      </div>
    </div>
  );
}
