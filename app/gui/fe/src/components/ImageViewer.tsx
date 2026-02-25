import { useState, useEffect, useCallback, useRef } from 'react';
import LoadingSpinner from './LoadingSpinner';

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4.0;

interface ImageViewerProps {
  data: Uint8Array;
  mimeType: string;
  onExport?: () => void;
}

export default function ImageViewer({ data, mimeType, onExport }: ImageViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [flippedH, setFlippedH] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionAtDragStart = useRef({ x: 0, y: 0 });

  // Create a Blob URL inside useEffect so each mount (including React
  // StrictMode remounts) gets a fresh URL that won't be prematurely revoked.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([new Uint8Array(data)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url); // eslint-disable-line react-hooks/set-state-in-effect -- Blob URL must be created in effect for StrictMode
    return () => URL.revokeObjectURL(url);
  }, [data, mimeType]);

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

  const zoomIn = useCallback(() => setScale(s => Math.min(ZOOM_MAX, s + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => {
    setScale(s => {
      const next = Math.max(ZOOM_MIN, s - ZOOM_STEP);
      if (next <= 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  }, []);
  const zoomReset = useCallback(() => {
    setScale(1.0);
    setPosition({ x: 0, y: 0 });
  }, []);

  const rotateClockwise = useCallback(() => setRotation(r => (r + 90) % 360), []);
  const toggleFlipH = useCallback(() => setFlippedH(f => !f), []);

  // Ctrl+scroll wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) {
      setScale(s => Math.min(ZOOM_MAX, s + ZOOM_STEP));
    } else {
      setScale(s => {
        const next = Math.max(ZOOM_MIN, s - ZOOM_STEP);
        if (next <= 1) setPosition({ x: 0, y: 0 });
        return next;
      });
    }
  }, []);

  // Pan/drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    positionAtDragStart.current = { ...position };
  }, [scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPosition({
      x: positionAtDragStart.current.x + dx / scale,
      y: positionAtDragStart.current.y + dy / scale,
    });
  }, [isDragging, scale]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (error) {
    return (
      <div className="p-4 bg-[var(--error-muted)] rounded-[var(--radius-md)] text-center">
        <p className="text-sm text-[var(--error)]">Failed to load image: {error}</p>
      </div>
    );
  }

  const btnClass = "px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  const imageTransform = `scale(${scale}) translate(${position.x}px, ${position.y}px) rotate(${rotation}deg) scaleX(${flippedH ? -1 : 1})`;

  const toolbar = (
    <div className="flex items-center justify-between">
      {/* Zoom controls */}
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
      </div>

      {/* Rotate/flip + Save As + Fullscreen */}
      <div className="flex items-center gap-2">
        {/* Rotate clockwise */}
        <button
          onClick={rotateClockwise}
          className={btnClass}
          title="Rotate 90°"
          aria-label="Rotate clockwise"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        {/* Flip horizontal */}
        <button
          onClick={toggleFlipH}
          className={`${btnClass} ${flippedH ? 'text-[var(--accent)]' : ''}`}
          title="Flip horizontal"
          aria-label="Flip horizontal"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
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
              aria-label="Save image to file"
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m7 5l5-5m0 0v4m0-4h-4m-7 7l-5 5m0 0v-4m0 4h4m7-5l5 5m0 0v-4m0 4h-4" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5m-7 14l-5 5m0 0h4m-4 0v-4m16 4l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );

  const imageElement = blobUrl ? (
    <img
      src={blobUrl}
      alt="Decrypted content"
      className="select-none"
      draggable={false}
      style={{
        transform: imageTransform,
        transformOrigin: 'center',
        maxWidth: scale <= 1 ? '100%' : 'none',
        maxHeight: scale <= 1 && !isFullscreen ? '500px' : scale <= 1 ? '100%' : 'none',
        objectFit: 'contain',
      }}
      onLoad={() => setLoading(false)}
      onError={() => {
        setLoading(false);
        setError('The image could not be rendered.');
      }}
    />
  ) : null;

  const containerCursor = scale > 1
    ? (isDragging ? 'grabbing' : 'grab')
    : 'default';

  // Fullscreen overlay
  if (isFullscreen) {
    return (
      <>
        {/* Inline placeholder so LibraryContentModal layout isn't disrupted */}
        <div className="p-4 text-center text-sm text-[var(--text-muted)]">
          Image is expanded to fullscreen. Press Esc or the collapse button to return.
        </div>

        {/* Fullscreen overlay */}
        <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--bg-primary)]">
          {/* Toolbar */}
          <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
            {toolbar}
          </div>

          {/* Image content area */}
          <div
            className="flex-1 overflow-hidden flex items-center justify-center p-4 bg-[var(--bg-secondary)]"
            style={{ cursor: containerCursor }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {imageElement}
          </div>
        </div>
      </>
    );
  }

  // Normal inline view
  return (
    <div className="space-y-3">
      {toolbar}
      <div
        className="flex items-center justify-center overflow-hidden max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2"
        style={{ cursor: containerCursor }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {loading && blobUrl && (
          <div className="py-12 text-center">
            <LoadingSpinner size="lg" className="mx-auto mb-4" />
            <p className="text-sm text-[var(--text-muted)]">Loading image...</p>
          </div>
        )}
        {imageElement}
      </div>
    </div>
  );
}
