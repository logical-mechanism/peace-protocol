import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Mocks ───────────────────────────────────────────────────────────

const capturedOnLoadSuccessRef = { current: null as ((doc: { numPages: number }) => void) | null };

vi.mock('react-pdf', () => {
  const DocumentMock = ({ onLoadSuccess, children }: { onLoadSuccess?: (doc: { numPages: number }) => void; children: React.ReactNode }) => {
    // eslint-disable-next-line react-hooks/immutability -- test mock, not a real component
    capturedOnLoadSuccessRef.current = onLoadSuccess ?? null;
    return <div data-testid="pdf-document">{children}</div>;
  };
  const PageMock = ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`pdf-page-${pageNumber}`}>Page {pageNumber}</div>
  );
  return {
    Document: DocumentMock,
    Page: PageMock,
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  };
});

vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}));
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));

vi.mock('../../services/pdfSearch', () => ({
  findMatchesInPdf: vi.fn().mockResolvedValue([]),
  highlightText: vi.fn().mockReturnValue('highlighted'),
}));

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: () => <div data-testid="spinner">Loading...</div>,
}));

const mockObjectUrl = 'blob:mock-pdf-url';
globalThis.URL.createObjectURL = vi.fn().mockReturnValue(mockObjectUrl);
globalThis.URL.revokeObjectURL = vi.fn();

import PdfViewer from '../PdfViewer';

// ── Helpers ─────────────────────────────────────────────────────────

const testPdfData = new Uint8Array([37, 80, 68, 70]);

function renderViewer(overrides: Partial<{ data: Uint8Array; onExport: () => void }> = {}) {
  capturedOnLoadSuccessRef.current = null;
  return render(<PdfViewer data={testPdfData} {...overrides} />);
}

/** Simulate the PDF document loading successfully with the given number of pages. */
function simulateDocumentLoad(numPages: number) {
  act(() => {
    if (capturedOnLoadSuccessRef.current) {
      capturedOnLoadSuccessRef.current({ numPages });
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnLoadSuccessRef.current = null;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('PdfViewer', () => {
  describe('rendering', () => {
    it('renders the pdf document container', () => {
      renderViewer();
      expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
    });

    it('creates blob URL from data', () => {
      renderViewer();
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    });

    it('revokes blob URL on unmount', () => {
      const { unmount } = renderViewer();
      unmount();
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(mockObjectUrl);
    });

    it('renders first page initially', () => {
      renderViewer();
      expect(screen.getByTestId('pdf-page-1')).toBeInTheDocument();
    });
  });

  describe('after document load', () => {
    it('shows page count', async () => {
      renderViewer();
      // Wait for blobUrl effect → Document mock mounts → captures onLoadSuccess
      await waitFor(() => {
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
      });
      simulateDocumentLoad(5);
      await waitFor(() => {
        expect(screen.getByText(/\/ 5/)).toBeInTheDocument();
      });
    });

    it('shows zoom controls', async () => {
      renderViewer();
      await waitFor(() => {
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
      });
      simulateDocumentLoad(3);
      await waitFor(() => {
        expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
        expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
      });
    });

    it('shows search button', async () => {
      renderViewer();
      await waitFor(() => {
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
      });
      simulateDocumentLoad(3);
      await waitFor(() => {
        expect(screen.getByLabelText('Find in PDF')).toBeInTheDocument();
      });
    });

    it('shows export button when onExport provided', async () => {
      const onExport = vi.fn();
      renderViewer({ onExport });
      await waitFor(() => {
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
      });
      simulateDocumentLoad(3);
      await waitFor(() => {
        expect(screen.getByLabelText('Save PDF to file')).toBeInTheDocument();
      });
    });

    it('calls onExport when export button clicked', async () => {
      const onExport = vi.fn();
      renderViewer({ onExport });
      await waitFor(() => {
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
      });
      simulateDocumentLoad(3);
      await waitFor(() => {
        expect(screen.getByLabelText('Save PDF to file')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText('Save PDF to file'));
      expect(onExport).toHaveBeenCalledOnce();
    });

    it('shows fullscreen button', async () => {
      renderViewer();
      await waitFor(() => {
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
      });
      simulateDocumentLoad(2);
      await waitFor(() => {
        expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
      });
    });
  });
});
