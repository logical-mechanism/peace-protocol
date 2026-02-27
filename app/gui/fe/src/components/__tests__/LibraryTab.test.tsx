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
  default: ({ title, message, onConfirm, onCancel, isOpen, confirmLabel }: { title: string; message: string; onConfirm: () => void; onCancel: () => void; isOpen: boolean; confirmLabel?: string }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <span>{title}</span>
        <span data-testid="confirm-modal-message">{message}</span>
        {confirmLabel && <span data-testid="confirm-modal-label">{confirmLabel}</span>}
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
    decryptedAt: '2024-06-15T10:00:00Z',
    contentMissing: false,
    fileSize: 1024,
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

  describe('bulk delete', () => {
    const item1 = makeItem({ tokenName: 'token_aaa', description: 'Item A', category: 'text' });
    const item2 = makeItem({ tokenName: 'token_bbb', description: 'Item B', category: 'text' });
    const item3 = makeItem({ tokenName: 'token_ccc', description: 'Item C', category: 'text' });

    async function enterSelectModeAndSelectAll(onBulkDeleteResult?: ReturnType<typeof vi.fn>) {
      (listLibraryItems as ReturnType<typeof vi.fn>).mockResolvedValue([item1, item2, item3]);
      renderTab({ onBulkDeleteResult });

      // Wait for items to render
      await waitFor(() => {
        expect(screen.getByText('Item A')).toBeInTheDocument();
      });

      // Enter select mode
      fireEvent.click(screen.getByText('Select'));

      // Select all via "Select All" button — first select one to show the floating bar
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      await waitFor(() => {
        expect(screen.getByText('Select All')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Select All'));
    }

    it('calls onBulkDeleteResult with success message when all items deleted', async () => {
      const onBulkDeleteResult = vi.fn();
      await enterSelectModeAndSelectAll(onBulkDeleteResult);

      // Open bulk delete confirm
      await waitFor(() => {
        expect(screen.getByText('Delete 3')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Delete 3'));

      // Confirm
      await waitFor(() => {
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => {
        expect(onBulkDeleteResult).toHaveBeenCalledWith(
          'Deleted 3 items from library',
          false
        );
      });
      expect(deleteLibraryItem).toHaveBeenCalledTimes(3);
    });

    it('reports partial failure and only removes successful items', async () => {
      // item2 will fail
      (deleteLibraryItem as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined) // item1 OK
        .mockRejectedValueOnce(new Error('permission denied')) // item2 fails
        .mockResolvedValueOnce(undefined); // item3 OK

      const onBulkDeleteResult = vi.fn();
      await enterSelectModeAndSelectAll(onBulkDeleteResult);

      await waitFor(() => {
        expect(screen.getByText('Delete 3')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Delete 3'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => {
        expect(onBulkDeleteResult).toHaveBeenCalledWith(
          'Deleted 2 of 3 items. 1 item could not be removed.',
          true
        );
      });

      // item2 should still be in the list (failed to delete)
      expect(screen.getByText('Item B')).toBeInTheDocument();
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
