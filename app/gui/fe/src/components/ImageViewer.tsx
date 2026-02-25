import { useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface ImageViewerProps {
  data: Uint8Array;
  mimeType: string;
}

export default function ImageViewer({ data, mimeType }: ImageViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create a Blob URL inside useEffect so each mount (including React
  // StrictMode remounts) gets a fresh URL that won't be prematurely revoked.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([new Uint8Array(data)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    /* eslint-disable react-hooks/set-state-in-effect */
    setBlobUrl(url);
    /* eslint-enable react-hooks/set-state-in-effect */
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

  if (error) {
    return (
      <div className="p-4 bg-[var(--error-muted)] rounded-[var(--radius-md)] text-center">
        <p className="text-sm text-[var(--error)]">Failed to load image: {error}</p>
      </div>
    );
  }

  const btnClass = "px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer";

  const toolbar = (
    <div className="flex items-center justify-end">
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
  );

  const imageElement = blobUrl ? (
    <img
      src={blobUrl}
      alt="Decrypted content"
      className={isFullscreen
        ? "max-w-full max-h-full object-contain"
        : "max-w-full max-h-[500px] object-contain"
      }
      onLoad={() => setLoading(false)}
      onError={() => {
        setLoading(false);
        setError('The image could not be rendered.');
      }}
    />
  ) : null;

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
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[var(--bg-secondary)]">
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
      <div className="flex items-center justify-center overflow-auto max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2">
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
