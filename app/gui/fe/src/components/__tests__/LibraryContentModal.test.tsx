import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LibraryContentModal from '../LibraryContentModal';
import type { LibraryItem } from '../../services/libraryService';

// ── Mocks ───────────────────────────────────────────────────────────

const mockReadLibraryContent = vi.fn();
const mockDeleteLibraryItem = vi.fn();
const mockExportLibraryContent = vi.fn();
const mockReadSubtitleFile = vi.fn();
const mockOpenWithSystem = vi.fn();
const mockGetLibraryContentUrl = vi.fn();
const mockGetLibrarySubtitleUrl = vi.fn();

vi.mock('../../services/libraryService', () => ({
  readLibraryContent: (...args: unknown[]) => mockReadLibraryContent(...args),
  deleteLibraryItem: (...args: unknown[]) => mockDeleteLibraryItem(...args),
  exportLibraryContent: (...args: unknown[]) => mockExportLibraryContent(...args),
  readSubtitleFile: (...args: unknown[]) => mockReadSubtitleFile(...args),
  openWithSystem: (...args: unknown[]) => mockOpenWithSystem(...args),
  getLibraryContentUrl: (...args: unknown[]) => mockGetLibraryContentUrl(...args),
  getLibrarySubtitleUrl: (...args: unknown[]) => mockGetLibrarySubtitleUrl(...args),
}));

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/truncate', () => ({
  truncateHex: (s: string) => s.slice(0, 8) + '...',
}));

vi.mock('../../utils/formatBytes', () => ({
  formatBytes: (n: number) => `${n} B`,
}));

vi.mock('../../utils/formatDate', () => ({
  formatDateTime: () => 'Jan 1, 2025',
}));

vi.mock('../../hooks/useModalStack', () => ({
  useModalStack: () => ({
    zIndex: 50,
    shouldRender: true,
    animationState: 'entered',
  }),
}));

vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock('../ConfirmModal', () => ({
  default: ({ isOpen, onConfirm, title }: { isOpen: boolean; onConfirm: () => void; title: string }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}));

vi.mock('../Badge', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: () => <div data-testid="spinner">Loading...</div>,
}));

// Mock lazy-loaded components (paths relative to test file → src/components/)
vi.mock('../PdfViewer', () => ({ default: () => <div data-testid="pdf-viewer">PDF</div> }));
vi.mock('../ImageViewer', () => ({ default: () => <div data-testid="image-viewer">Image</div> }));
vi.mock('../audio', () => ({ default: () => <div data-testid="audio-player">Audio</div> }));
vi.mock('../VideoPlayer', () => ({ default: () => <div data-testid="video-player">Video</div> }));

// ── Helpers ─────────────────────────────────────────────────────────

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    tokenName: 'abc123def456',
    category: 'text',
    decryptedAt: '2025-01-01T00:00:00Z',
    contentMissing: false,
    seller: 'seller_pkh_123',
    fileSize: 1024,
    description: 'Test content',
    suggestedPrice: 50,
    storageLayer: 'on-chain',
    ...overrides,
  };
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  item: makeItem(),
  onDelete: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockReadLibraryContent.mockResolvedValue(new TextEncoder().encode('Hello World'));
  mockReadSubtitleFile.mockResolvedValue(null);
});

// ── Tests ───────────────────────────────────────────────────────────

describe('LibraryContentModal', () => {
  it('renders nothing when isOpen is false', () => {
    render(
      <LibraryContentModal {...defaultProps} isOpen={false} />,
    );
    // useModalStack returns shouldRender=true always in mock, but component
    // still returns early because isOpen controls content loading
    expect(screen.queryByText('Hello World')).not.toBeInTheDocument();
  });

  it('renders text content when loaded', async () => {
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });
  });

  it('calls readLibraryContent with token name and category', async () => {
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(mockReadLibraryContent).toHaveBeenCalledWith('abc123def456', 'text');
    });
  });

  it('renders metadata section with seller info', async () => {
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/Seller:/)).toBeInTheDocument();
    });
  });

  it('shows error state when content is missing', async () => {
    render(
      <LibraryContentModal
        {...defaultProps}
        item={makeItem({ contentMissing: true })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Content file not found/)).toBeInTheDocument();
    });
  });

  it('shows error state when readLibraryContent rejects', async () => {
    mockReadLibraryContent.mockRejectedValueOnce(new Error('Read failed'));
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Read failed')).toBeInTheDocument();
    });
  });

  it('renders category label', async () => {
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Text')).toBeInTheDocument();
    });
  });

  it('renders file size', async () => {
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('1024 B')).toBeInTheDocument();
    });
  });

  it('renders close dialog button', async () => {
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Close dialog')).toBeInTheDocument();
    });
  });

  it('calls onClose when close dialog button clicked', async () => {
    const onClose = vi.fn();
    render(<LibraryContentModal {...defaultProps} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Close dialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows delete button and opens confirm dialog', async () => {
    render(<LibraryContentModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Delete from Library')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Delete from Library'));
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
  });

  it('deletes item when confirmed', async () => {
    mockDeleteLibraryItem.mockResolvedValueOnce(undefined);
    render(<LibraryContentModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Delete from Library')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete from Library'));
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm'));
    });

    expect(mockDeleteLibraryItem).toHaveBeenCalledWith('abc123def456', 'text');
    expect(defaultProps.onDelete).toHaveBeenCalled();
  });
});

describe('getViewMode (via rendering)', () => {
  it('renders text for text category', async () => {
    render(
      <LibraryContentModal
        {...defaultProps}
        item={makeItem({ category: 'text' })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });
  });

  it('renders image viewer for .png extension', async () => {
    mockReadLibraryContent.mockResolvedValue(new Uint8Array([0x89, 0x50]));
    render(
      <LibraryContentModal
        {...defaultProps}
        item={makeItem({ category: 'image', fileExtension: '.png' })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('image-viewer')).toBeInTheDocument();
    });
  });

  it('renders audio player for .mp3 extension', async () => {
    // Audio uses rodio (Rust) via Tauri IPC — no content URL needed
    render(
      <LibraryContentModal
        {...defaultProps}
        item={makeItem({ category: 'audio', fileExtension: '.mp3' })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toBeInTheDocument();
    });
  });
});
