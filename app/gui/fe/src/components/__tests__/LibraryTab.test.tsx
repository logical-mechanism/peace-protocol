import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LibraryTab from '../LibraryTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { LIBRARY_INITIAL } from '../../hooks/useTabFilterState';
import type { LibraryItem } from '../../services/libraryService';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../services/libraryService', () => ({
  listLibraryItems: vi.fn(),
  deleteLibraryItem: vi.fn(),
}));

// Mock LibraryContentModal to avoid heavy deps (PdfViewer, VideoPlayer, etc.)
vi.mock('../LibraryContentModal', () => ({
  default: () => <div data-testid="library-content-modal">LibraryContentModal</div>,
}));

// Mock ConfirmModal to control its rendering
vi.mock('../ConfirmModal', () => ({
  default: ({ title, onConfirm, onCancel, isOpen }: { title: string; onConfirm: () => void; onCancel: () => void; isOpen: boolean }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

import { listLibraryItems, deleteLibraryItem } from '../../services/libraryService';

// ── Fixtures ────────────────────────────────────────────────────────

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    tokenName: 'lib' + Math.random().toString(36).slice(2, 18),
    category: 'text',
    description: 'A test library item',
    seller: 'addr_test1seller',
    savedAt: '2024-06-15T10:00:00Z',
    size: 1024,
    ...overrides,
  };
}

const noopDispatch = vi.fn();

function renderTab(overrides: Partial<Parameters<typeof LibraryTab>[0]> = {}) {
  return render(
    <ModalProvider>
      <LibraryTab
        filters={LIBRARY_INITIAL}
        dispatch={noopDispatch}
        {...overrides}
      />
    </ModalProvider>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (listLibraryItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (deleteLibraryItem as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe('LibraryTab', () => {
  it('shows empty state when library has no items', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Your library is empty')).toBeInTheDocument();
    });
  });

  it('shows error state when listLibraryItems fails', async () => {
    (listLibraryItems as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Filesystem error')
    );

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Failed to load your library')).toBeInTheDocument();
    });
    expect(screen.getByText('Filesystem error')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('renders library items when data exists', async () => {
    const item = makeItem({ description: 'My decrypted file' });
    (listLibraryItems as ReturnType<typeof vi.fn>).mockResolvedValue([item]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('My decrypted file')).toBeInTheDocument();
    });
  });

  it('renders multiple items', async () => {
    const items = [
      makeItem({ description: 'First item' }),
      makeItem({ description: 'Second item' }),
    ];
    (listLibraryItems as ReturnType<typeof vi.fn>).mockResolvedValue(items);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('First item')).toBeInTheDocument();
      expect(screen.getByText('Second item')).toBeInTheDocument();
    });
  });

  it('calls listLibraryItems on mount', async () => {
    renderTab();

    await waitFor(() => {
      expect(listLibraryItems).toHaveBeenCalledTimes(1);
    });
  });

  it('retry button refetches data on error', async () => {
    (listLibraryItems as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce([]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Try Again'));

    await waitFor(() => {
      expect(listLibraryItems).toHaveBeenCalledTimes(2);
    });
  });

  it('shows "Browse Marketplace" button when onSwitchTab is provided', async () => {
    const onSwitchTab = vi.fn();
    renderTab({ onSwitchTab });

    await waitFor(() => {
      expect(screen.getByText('Browse Marketplace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Browse Marketplace'));
    expect(onSwitchTab).toHaveBeenCalledWith('marketplace');
  });

  it('has accessible screen reader status region', async () => {
    renderTab();

    await waitFor(() => {
      const srRegion = document.querySelector('[role="status"][aria-live="polite"]');
      expect(srRegion).toBeInTheDocument();
    });
  });

  it('re-fetches when refreshSignal changes', async () => {
    (listLibraryItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { rerender } = render(
      <ModalProvider>
        <LibraryTab filters={LIBRARY_INITIAL} dispatch={noopDispatch} refreshSignal={1} />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(listLibraryItems).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ModalProvider>
        <LibraryTab filters={LIBRARY_INITIAL} dispatch={noopDispatch} refreshSignal={2} />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(listLibraryItems).toHaveBeenCalledTimes(2);
    });
  });
});
