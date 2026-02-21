import { useState, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import LoadingSpinner from './LoadingSpinner';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerProps {
  data: Uint8Array;
}

export default function PdfViewer({ data }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return (
      <div className="p-4 bg-[var(--error-muted)] rounded-[var(--radius-md)] text-center">
        <p className="text-sm text-[var(--error)]">Failed to load PDF: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Navigation */}
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--text-secondary)]">
            Page {currentPage} of {numPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* PDF Rendering */}
      <div className="flex justify-center overflow-auto max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
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
            loading={
              <div className="py-8 text-center">
                <LoadingSpinner size="sm" className="mx-auto" />
              </div>
            }
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>

      {/* Page count for single-page docs */}
      {numPages === 1 && (
        <p className="text-xs text-[var(--text-muted)] text-center">1 page</p>
      )}
    </div>
  );
}
