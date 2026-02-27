import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import LoadingSpinner from './LoadingSpinner';
import { findMatchesInPdf, highlightText } from '../services/pdfSearch';
import type { SearchMatch } from '../services/pdfSearch';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const THUMBNAIL_WIDTH = 80;
const THUMBNAIL_SCALE = 0.15;

/** Renders a single page thumbnail, lazy-loaded via IntersectionObserver. */
function LazyThumbnail({
  pageNumber,
  isActive,
  onClick,
}: {
  pageNumber: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: '100px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={containerRef}
      onClick={onClick}
      className={`flex-shrink-0 cursor-pointer rounded-[var(--radius-sm)] overflow-hidden border-2 transition-colors duration-150 ${
        isActive ? 'border-[var(--accent)]' : 'border-transparent hover:border-[var(--border-subtle)]'
      }`}
      style={{ width: THUMBNAIL_WIDTH, minHeight: THUMBNAIL_WIDTH * 1.4 }}
      title={`Page ${pageNumber}`}
      aria-label={`Go to page ${pageNumber}`}
    >
      {isVisible ? (
        <Page
          pageNumber={pageNumber}
          scale={THUMBNAIL_SCALE}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={
            <div className="w-full h-full bg-[var(--bg-secondary)]" />
          }
        />
      ) : (
        <div className="w-full h-full bg-[var(--bg-secondary)]" />
      )}
      <div className={`text-[9px] text-center py-0.5 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
        {pageNumber}
      </div>
    </button>
  );
}

interface PdfViewerProps {
  data: Uint8Array;
  onExport?: () => void;
}

export default function PdfViewer({ data, onExport }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState('1');
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [pageInputInvalid, setPageInputInvalid] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const thumbnailsRef = useRef<HTMLDivElement>(null);

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Create a Blob URL inside useEffect so each mount (including React
  // StrictMode remounts) gets a fresh URL that won't be prematurely revoked.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([new Uint8Array(data)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);

  const onDocumentLoadSuccess = useCallback((doc: PDFDocumentProxy) => {
    setNumPages(doc.numPages);
    setCurrentPage(1);
    pdfDocRef.current = doc;
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || 'Failed to load PDF');
  }, []);

  const zoomIn = useCallback(() => setScale(s => Math.min(ZOOM_MAX, s + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(ZOOM_MIN, s - ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setScale(1.0), []);

  // Sync page input when currentPage changes externally (prev/next buttons)
  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  const commitPageJump = useCallback(() => {
    const parsed = parseInt(pageInputValue, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > numPages) {
      setPageInputValue(String(currentPage));
      setPageInputInvalid(true);
      setTimeout(() => setPageInputInvalid(false), 600);
      return;
    }
    setCurrentPage(parsed);
  }, [pageInputValue, numPages, currentPage]);

  // Auto-scroll thumbnail sidebar to current page
  useEffect(() => {
    if (!showThumbnails || !thumbnailsRef.current) return;
    const child = thumbnailsRef.current.children[currentPage - 1] as HTMLElement | undefined;
    child?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPage, showThumbnails]);

  // --- Search logic ---

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setCurrentMatchIndex(0);
  }, []);

  const performSearch = useCallback(async () => {
    const doc = pdfDocRef.current;
    if (!doc || !searchQuery.trim()) {
      setSearchResults([]);
      setCurrentMatchIndex(0);
      return;
    }

    setIsSearching(true);
    try {
      const matches = await findMatchesInPdf(doc, searchQuery.trim());
      setSearchResults(matches);
      setCurrentMatchIndex(0);
      if (matches.length > 0) {
        setCurrentPage(matches[0].pageNumber);
      }
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const goToNextMatch = useCallback(() => {
    if (searchResults.length === 0) return;
    const next = (currentMatchIndex + 1) % searchResults.length;
    setCurrentMatchIndex(next);
    setCurrentPage(searchResults[next].pageNumber);
  }, [currentMatchIndex, searchResults]);

  const goToPrevMatch = useCallback(() => {
    if (searchResults.length === 0) return;
    const prev = (currentMatchIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentMatchIndex(prev);
    setCurrentPage(searchResults[prev].pageNumber);
  }, [currentMatchIndex, searchResults]);

  // Pre-filter matches for the current page to avoid filtering in the renderer
  const currentPageMatches = useMemo(
    () => searchResults.filter(m => m.pageNumber === currentPage),
    [searchResults, currentPage],
  );

  const customTextRenderer = useCallback(
    (textItem: { pageIndex: number; pageNumber: number; itemIndex: number; str: string }) => {
      const itemMatches = currentPageMatches.filter(m => m.itemIndex === textItem.itemIndex);
      if (itemMatches.length === 0) return textItem.str;
      return highlightText(textItem.str, itemMatches, currentMatchIndex, searchResults);
    },
    [currentPageMatches, currentMatchIndex, searchResults],
  );

  // Auto-focus search input when opened
  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isSearchOpen]);

  // Keyboard shortcuts: Ctrl+F to open search, Escape to close search then fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setIsSearchOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        if (isSearchOpen) {
          e.stopPropagation();
          closeSearch();
          return;
        }
        if (isFullscreen) {
          e.stopPropagation();
          setIsFullscreen(false);
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isSearchOpen, isFullscreen, closeSearch]);

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
              aria-label="Previous page"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)]">
              <input
                ref={pageInputRef}
                type="text"
                inputMode="numeric"
                value={pageInputValue}
                onChange={(e) => { setPageInputValue(e.target.value); setPageInputInvalid(false); }}
                onBlur={commitPageJump}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitPageJump();
                    pageInputRef.current?.blur();
                  }
                }}
                className={`w-12 text-center text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-sm)] text-[var(--text-primary)] py-0.5 outline-none transition-colors duration-200 ${pageInputInvalid ? 'border-[var(--error)] ring-1 ring-[var(--error)]' : 'border-[var(--border-subtle)] focus:border-[var(--accent)]'}`}
                aria-label="Page number"
                aria-invalid={pageInputInvalid || undefined}
              />
              <span>/ {numPages}</span>
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}
              className={btnClass}
              aria-label="Next page"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
          aria-label="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={zoomReset}
          className={`${btnClass} min-w-[52px] text-center`}
          title="Reset zoom"
          aria-label="Reset zoom"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={zoomIn}
          disabled={scale >= ZOOM_MAX}
          className={btnClass}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {/* Thumbnails toggle */}
        {numPages > 1 && (
          <>
            <div className="w-px h-5 bg-[var(--border-subtle)]" />
            <button
              onClick={() => setShowThumbnails(t => !t)}
              className={`${btnClass} ${showThumbnails ? 'text-[var(--accent)]' : ''}`}
              title={showThumbnails ? 'Hide page thumbnails' : 'Show page thumbnails'}
              aria-label={showThumbnails ? 'Hide page thumbnails' : 'Show page thumbnails'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
          </>
        )}

        {/* Search toggle */}
        <div className="w-px h-5 bg-[var(--border-subtle)]" />
        <button
          onClick={() => isSearchOpen ? closeSearch() : setIsSearchOpen(true)}
          className={`${btnClass} ${isSearchOpen ? 'text-[var(--accent)]' : ''}`}
          title="Find in PDF (Ctrl+F)"
          aria-label="Find in PDF"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>

        {/* Save As button */}
        {onExport && (
          <>
            <div className="w-px h-5 bg-[var(--border-subtle)]" />
            <button
              onClick={onExport}
              className={btnClass}
              title="Save As"
              aria-label="Save PDF to file"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          </>
        )}

        {/* Expand / Collapse button */}
        <div className="w-px h-5 bg-[var(--border-subtle)]" />
        <button
          onClick={() => setIsFullscreen(fs => !fs)}
          className={btnClass}
          title={isFullscreen ? 'Exit fullscreen' : 'Expand'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
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

  const searchBar = isSearchOpen ? (
    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-card)] border-b border-[var(--border-subtle)]">
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (searchResults.length === 0 || isSearching) {
              performSearch();
            } else if (e.shiftKey) {
              goToPrevMatch();
            } else {
              goToNextMatch();
            }
          }
        }}
        placeholder="Find in PDF..."
        className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        aria-label="Search text in PDF"
      />
      <button
        onClick={goToPrevMatch}
        disabled={searchResults.length === 0}
        className={btnClass}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button
        onClick={goToNextMatch}
        disabled={searchResults.length === 0}
        className={btnClass}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <span className="text-xs text-[var(--text-muted)] whitespace-nowrap min-w-[70px] text-center">
        {isSearching ? 'Searching...' : searchResults.length > 0
          ? `${currentMatchIndex + 1} of ${searchResults.length}`
          : searchQuery.trim() ? 'No matches' : ''}
      </span>
      <button
        onClick={closeSearch}
        className={btnClass}
        title="Close search (Escape)"
        aria-label="Close search"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  ) : null;

  const thumbnailSidebar = showThumbnails && numPages > 1 ? (
    <div
      ref={thumbnailsRef}
      className="flex-shrink-0 overflow-y-auto flex flex-col items-center gap-2 p-2 bg-[var(--bg-card)] border-r border-[var(--border-subtle)]"
      style={{ width: THUMBNAIL_WIDTH + 16 }}
    >
      {Array.from({ length: numPages }, (_, i) => (
        <LazyThumbnail
          key={i + 1}
          pageNumber={i + 1}
          isActive={currentPage === i + 1}
          onClick={() => setCurrentPage(i + 1)}
        />
      ))}
    </div>
  ) : null;

  const pdfLoading = (
    <div className="py-12 text-center">
      <LoadingSpinner size="lg" className="mx-auto mb-4" />
      <p className="text-sm text-[var(--text-muted)]">Loading PDF...</p>
    </div>
  );

  const mainPage = (
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
      customTextRenderer={isSearchOpen && searchResults.length > 0 ? customTextRenderer : undefined}
    />
  );

  // Wrap everything in a single <Document> so both thumbnails and main page share context
  const documentWrapper = (children: React.ReactNode) =>
    blobUrl ? (
      <Document
        file={blobUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={pdfLoading}
      >
        {children}
      </Document>
    ) : pdfLoading;

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
          {searchBar}

          {/* PDF content area with optional thumbnails sidebar */}
          <div className="flex-1 flex min-h-0">
            {documentWrapper(
              <>
                {thumbnailSidebar}
                <div className="flex-1 overflow-auto flex justify-center bg-[var(--bg-secondary)]">
                  {mainPage}
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // Normal inline view
  return (
    <div className="space-y-3">
      {toolbar}
      {searchBar}
      <div className="flex max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        {documentWrapper(
          <>
            {thumbnailSidebar}
            <div className="flex-1 overflow-auto flex justify-center">
              {mainPage}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
