import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HistoryTab from '../HistoryTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { HISTORY_INITIAL } from '../../hooks/useTabFilterState';
import type { TransactionRecord } from '../../services/transactionHistory';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../services/api', () => ({
  encryptionsApi: { getAll: vi.fn() },
  bidsApi: { getAll: vi.fn() },
  chainApi: { getConfirmations: vi.fn() },
}));

vi.mock('../../services/transactionHistory', () => ({
  getTransactions: vi.fn().mockReturnValue([]),
  reconcileWithOnChain: vi.fn().mockReturnValue({ discrepancies: [] }),
  resolvePendingTxs: vi.fn().mockReturnValue([]),
  updateTransactionStatus: vi.fn(),
  clearHistory: vi.fn(),
  toCSV: vi.fn().mockReturnValue('txHash,type,status\n'),
  getTypeLabel: vi.fn((type: string) => {
    const labels: Record<string, string> = {
      'create-listing': 'Create Listing',
      'place-bid': 'Place Bid',
      'cancel-bid': 'Cancel Bid',
      'remove-listing': 'Remove Listing',
      'accept-bid': 'Accept Bid',
      'cancel-pending': 'Cancel Pending',
      'complete-sale': 'Complete Sale',
    };
    return labels[type] || type;
  }),
}));

vi.mock('../../services/fileExport', () => ({
  exportTextFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tanstack/react-virtual — jsdom has no layout engine so virtualizer renders nothing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 92,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 92,
        size: 92,
        key: i,
      })),
  }),
}));

import { encryptionsApi, bidsApi } from '../../services/api';
import { resolvePendingTxs, reconcileWithOnChain, clearHistory } from '../../services/transactionHistory';

// ── Fixtures ────────────────────────────────────────────────────────

const USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';

function makeRecord(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    txHash: 'tx' + Math.random().toString(36).slice(2, 18) + 'a'.repeat(48),
    type: 'create-listing',
    tokenName: 'enc_token_' + Math.random().toString(36).slice(2, 10),
    timestamp: Date.now(),
    status: 'confirmed',
    description: 'Test transaction',
    ...overrides,
  };
}

const noopDispatch = vi.fn();

function renderTab(overrides: Partial<Parameters<typeof HistoryTab>[0]> = {}) {
  return render(
    <ModalProvider>
      <HistoryTab
        userPkh={USER_PKH}
        transactions={[]}
        filters={HISTORY_INITIAL}
        dispatch={noopDispatch}
        {...overrides}
      />
    </ModalProvider>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (resolvePendingTxs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (reconcileWithOnChain as ReturnType<typeof vi.fn>).mockReturnValue({ discrepancies: [] });
});

describe('HistoryTab', () => {
  it('shows empty state when no transaction history exists', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('No transaction history')).toBeInTheDocument();
    });
  });

  it('renders transaction records when data exists', async () => {
    const records = [
      makeRecord({ description: 'Created my listing', type: 'create-listing', status: 'confirmed' }),
    ];
    (resolvePendingTxs as ReturnType<typeof vi.fn>).mockResolvedValue(records);

    renderTab({ transactions: records });

    await waitFor(() => {
      expect(screen.getByText('Created my listing')).toBeInTheDocument();
    });
  });

  it('shows stale data banner when API fails', async () => {
    const fallbackRecord = makeRecord({ description: 'Cached transaction' });
    const { getTransactions } = await import('../../services/transactionHistory');
    (getTransactions as ReturnType<typeof vi.fn>).mockReturnValue([fallbackRecord]);
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Kupo down')
    );

    renderTab({ transactions: [fallbackRecord] });

    await waitFor(() => {
      expect(screen.getByText(/Showing cached transaction history/i)).toBeInTheDocument();
    });
  });

  it('calls reconcileWithOnChain and resolvePendingTxs on refresh', async () => {
    renderTab();

    await waitFor(() => {
      expect(reconcileWithOnChain).toHaveBeenCalledWith(USER_PKH, expect.any(Array));
      expect(resolvePendingTxs).toHaveBeenCalledWith(USER_PKH);
    });
  });

  it('shows empty records when no userPkh provided', async () => {
    renderTab({ userPkh: undefined });

    await waitFor(() => {
      expect(screen.getByText('No transaction history')).toBeInTheDocument();
    });
    // Should not call APIs without userPkh
    expect(encryptionsApi.getAll).not.toHaveBeenCalled();
  });

  it('has accessible screen reader status region', async () => {
    renderTab();

    await waitFor(() => {
      const srRegion = document.querySelector('[role="status"][aria-live="polite"]');
      expect(srRegion).toBeInTheDocument();
    });
  });

  it('renders multiple transaction records', async () => {
    const records = [
      makeRecord({ description: 'First tx', type: 'create-listing' }),
      makeRecord({ description: 'Second tx', type: 'place-bid' }),
    ];
    (resolvePendingTxs as ReturnType<typeof vi.fn>).mockResolvedValue(records);

    renderTab({ transactions: records });

    await waitFor(() => {
      expect(screen.getByText('First tx')).toBeInTheDocument();
      expect(screen.getByText('Second tx')).toBeInTheDocument();
    });
  });

  it('opens ConfirmModal when Clear History is clicked and clears on confirm', async () => {
    const records = [makeRecord({ description: 'Test tx' })];
    (resolvePendingTxs as ReturnType<typeof vi.fn>).mockResolvedValue(records);
    const onClearHistory = vi.fn();

    renderTab({ transactions: records, onClearHistory });

    // Wait for records to render
    await waitFor(() => {
      expect(screen.getByText('Test tx')).toBeInTheDocument();
    });

    // Click Clear History button
    fireEvent.click(screen.getByLabelText('Clear transaction history'));

    // ConfirmModal should open with the expected title and message
    await waitFor(() => {
      expect(screen.getByText('Clear Transaction History')).toBeInTheDocument();
      expect(screen.getByText(/permanently remove all locally recorded/i)).toBeInTheDocument();
    });

    // Click the confirm button inside the modal (the danger-styled "Clear" button)
    const confirmBtn = screen.getByText('Clear Transaction History')
      .closest('[role="dialog"]')!
      .querySelector('.btn-danger') as HTMLElement;
    fireEvent.click(confirmBtn);

    // clearHistory should have been called and callback triggered
    await waitFor(() => {
      expect(clearHistory).toHaveBeenCalledWith(USER_PKH);
      expect(onClearHistory).toHaveBeenCalled();
    });
  });

  it('does not clear history when ConfirmModal is cancelled', async () => {
    const records = [makeRecord({ description: 'Test tx' })];
    (resolvePendingTxs as ReturnType<typeof vi.fn>).mockResolvedValue(records);

    renderTab({ transactions: records });

    await waitFor(() => {
      expect(screen.getByText('Test tx')).toBeInTheDocument();
    });

    // Click Clear History to open the modal
    fireEvent.click(screen.getByLabelText('Clear transaction history'));

    await waitFor(() => {
      expect(screen.getByText('Clear Transaction History')).toBeInTheDocument();
    });

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // clearHistory should NOT have been called
    expect(clearHistory).not.toHaveBeenCalled();
  });
});
