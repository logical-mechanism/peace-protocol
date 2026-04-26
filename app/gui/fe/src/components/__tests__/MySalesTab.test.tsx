import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MySalesTab from '../MySalesTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { MY_SALES_INITIAL } from '../../hooks/useTabFilterState';
import type { EncryptionDisplay, BidDisplay } from '../../services/api';
import { getOnboardingState, setOnboardingState } from '../../services/onboardingStorage';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../contexts/NodeContext', () => ({
  useNode: vi.fn().mockReturnValue({ expressReady: true }),
}));

vi.mock('../../contexts/AcceptBidQueueContext', () => ({
  useAcceptBidQueue: () => ({
    queue: [], currentItem: null, isProcessing: false, autoAcceptEnabled: false,
    queuedCount: 0, completedCount: 0, failedCount: 0,
    enqueue: vi.fn(), remove: vi.fn(), retry: vi.fn(), clear: vi.fn(),
    setAutoAccept: vi.fn(), hasEncryptionInQueue: vi.fn(() => false),
    setToast: vi.fn(), setRefreshTrigger: vi.fn(),
  }),
}));

vi.mock('../../services/api', () => ({
  encryptionsApi: { getAll: vi.fn() },
  bidsApi: { getAll: vi.fn() },
  chainApi: { getReencryptionHistory: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../services/imageCache', () => ({
  listCachedImages: vi.fn().mockResolvedValue({ cached: [], banned: [] }),
  deleteCachedImage: vi.fn(),
  downloadImage: vi.fn(),
  getCachedImage: vi.fn(),
  banImage: vi.fn(),
  unbanImage: vi.fn(),
}));

vi.mock('../../services/transactionHistory', () => ({
  getTransactions: vi.fn().mockReturnValue([]),
  getTypeLabelKey: vi.fn((type: string) => `history.txType.${type}`),
  getTypeLabel: vi.fn((type: string) => type),
  reencryptionHistoryToCSV: vi.fn(() => 'mock,reencryption,csv'),
}));

vi.mock('../../services/fileExport', () => ({
  exportTextFile: vi.fn(),
}));

import { encryptionsApi, bidsApi, chainApi } from '../../services/api';
import { exportTextFile } from '../../services/fileExport';
import { reencryptionHistoryToCSV } from '../../services/transactionHistory';

// ── Fixtures ────────────────────────────────────────────────────────

const USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc' + Math.random().toString(36).slice(2, 18),
    sellerPkh: USER_PKH,
    status: 'active',
    createdAt: '2024-06-15T10:00:00Z',
    utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
    datum: {} as EncryptionDisplay['datum'],
    description: 'A test sales listing',
    suggestedPrice: 200,
    ...overrides,
  };
}

function makeBid(overrides: Partial<BidDisplay> = {}): BidDisplay {
  return {
    tokenName: 'bid' + Math.random().toString(36).slice(2, 18),
    bidder: 'addr_test1bidder',
    bidderPkh: 'bidder_pkh_' + 'b'.repeat(46),
    encryptionToken: 'enc_token_abc',
    amount: 50_000_000,
    status: 'pending',
    createdAt: '2024-06-16T12:00:00Z',
    lockedUntil: Date.now() + 12 * 60 * 60 * 1000,
    utxo: { txHash: 'b'.repeat(64), outputIndex: 0 },
    datum: {} as BidDisplay['datum'],
    ...overrides,
  };
}

const noopDispatch = vi.fn();

function renderTab(overrides: Partial<Parameters<typeof MySalesTab>[0]> = {}) {
  return render(
    <ModalProvider>
      <MySalesTab
        userPkh={USER_PKH}
        filters={MY_SALES_INITIAL}
        dispatch={noopDispatch}
        {...overrides}
      />
    </ModalProvider>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

/** Simulate a user who has finished base onboarding but not the accept-bid tutorial. */
function primeOnboardingForAcceptBidBanner() {
  setOnboardingState({
    step: 3,
    completed: true,
    firstListingCompleted: true,
    firstBidCompleted: true,
    firstDecryptCompleted: true,
    firstBidAcceptedCompleted: false,
    iagonPrimerCompleted: false,
  });
}

describe('MySalesTab', () => {
  it('shows empty state when user has no listings', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('No listings yet')).toBeInTheDocument();
    });
    expect(screen.getByText('Create Listing')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Server offline')
    );

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Failed to load your listings')).toBeInTheDocument();
    });
    expect(screen.getByText('Server offline')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('filters encryptions to show only user listings', async () => {
    const userEnc = makeEncryption({ sellerPkh: USER_PKH, description: 'My listing' });
    const otherEnc = makeEncryption({ sellerPkh: 'other_pkh_' + 'x'.repeat(46), description: 'Not mine' });

    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([userEnc, otherEnc]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('My listing')).toBeInTheDocument();
    });
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();
  });

  it('renders listing cards with bid counts', async () => {
    const enc = makeEncryption({ tokenName: 'enc_with_bids', description: 'Listing with bids' });
    const bid1 = makeBid({ encryptionToken: 'enc_with_bids' });
    const bid2 = makeBid({ encryptionToken: 'enc_with_bids' });

    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid1, bid2]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Listing with bids')).toBeInTheDocument();
    });
  });

  it('calls encryptionsApi.getAll on mount', async () => {
    renderTab();

    await waitFor(() => {
      expect(encryptionsApi.getAll).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onCreateListing when Create Listing button is clicked', async () => {
    const onCreateListing = vi.fn();
    renderTab({ onCreateListing });

    await waitFor(() => {
      expect(screen.getByText('Create Listing')).toBeInTheDocument();
    });

    screen.getByText('Create Listing').click();
    expect(onCreateListing).toHaveBeenCalledTimes(1);
  });

  it('shows empty state without userPkh', async () => {
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeEncryption(),
    ]);

    renderTab({ userPkh: undefined });

    await waitFor(() => {
      expect(screen.getByText('No listings yet')).toBeInTheDocument();
    });
  });

  it('has accessible screen reader status region', async () => {
    renderTab();

    await waitFor(() => {
      const srRegion = document.querySelector('[role="status"][aria-live="polite"]');
      expect(srRegion).toBeInTheDocument();
    });
  });

  describe('accept-bid tutorial banner', () => {
    it('shows the banner when a listing has a pending bid and tour is not complete', async () => {
      primeOnboardingForAcceptBidBanner();
      const enc = makeEncryption({ tokenName: 'enc_eligible', description: 'Listing with pending bid' });
      const bid = makeBid({ encryptionToken: 'enc_eligible', status: 'pending' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
      (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

      renderTab({ onStartAcceptBidTutorial: vi.fn() });

      await waitFor(() => {
        expect(screen.getByText('Ready to accept your first bid?')).toBeInTheDocument();
      });
      expect(screen.getByText('Start Tour')).toBeInTheDocument();
    });

    it('hides the banner when no listing has a pending bid', async () => {
      primeOnboardingForAcceptBidBanner();
      const enc = makeEncryption({ tokenName: 'enc_no_bids', description: 'No bids' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
      (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderTab({ onStartAcceptBidTutorial: vi.fn() });

      await waitFor(() => {
        expect(screen.getByText('No bids')).toBeInTheDocument();
      });
      expect(screen.queryByText('Ready to accept your first bid?')).not.toBeInTheDocument();
    });

    it('hides the banner once the tour is completed', async () => {
      setOnboardingState({
        step: 3, completed: true,
        firstListingCompleted: true, firstBidCompleted: true,
        firstDecryptCompleted: true, firstBidAcceptedCompleted: true,
        iagonPrimerCompleted: false,
      });
      const enc = makeEncryption({ tokenName: 'enc_done', description: 'Tour already done' });
      const bid = makeBid({ encryptionToken: 'enc_done', status: 'pending' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
      (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

      renderTab({ onStartAcceptBidTutorial: vi.fn() });

      await waitFor(() => {
        expect(screen.getByText('Tour already done')).toBeInTheDocument();
      });
      expect(screen.queryByText('Ready to accept your first bid?')).not.toBeInTheDocument();
    });

    it('fires onStartAcceptBidTutorial with the eligible listing on click', async () => {
      primeOnboardingForAcceptBidBanner();
      const enc = makeEncryption({ tokenName: 'enc_eligible_click', description: 'Eligible' });
      const bid = makeBid({ encryptionToken: 'enc_eligible_click', status: 'pending' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
      (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

      const onStart = vi.fn();
      renderTab({ onStartAcceptBidTutorial: onStart });

      await waitFor(() => {
        expect(screen.getByText('Start Tour')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Start Tour'));
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStart.mock.calls[0][0].tokenName).toBe('enc_eligible_click');
      // Banner disappears after Start Tour click
      expect(screen.queryByText('Ready to accept your first bid?')).not.toBeInTheDocument();
    });

    it('hides on dismiss click without firing the tour callback', async () => {
      primeOnboardingForAcceptBidBanner();
      const enc = makeEncryption({ tokenName: 'enc_dismissable', description: 'Dismissable' });
      const bid = makeBid({ encryptionToken: 'enc_dismissable', status: 'pending' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
      (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

      const onStart = vi.fn();
      renderTab({ onStartAcceptBidTutorial: onStart });

      await waitFor(() => {
        expect(screen.getByText('Ready to accept your first bid?')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText('Dismiss accept-bid tutorial banner'));
      expect(onStart).not.toHaveBeenCalled();
      expect(screen.queryByText('Ready to accept your first bid?')).not.toBeInTheDocument();
      // Flag should remain untouched — dismissing the banner is not "completing" the tour
      expect(getOnboardingState().firstBidAcceptedCompleted).toBe(false);
    });

    it('hides the banner when onStartAcceptBidTutorial prop is not provided', async () => {
      primeOnboardingForAcceptBidBanner();
      const enc = makeEncryption({ tokenName: 'enc_no_handler', description: 'No handler' });
      const bid = makeBid({ encryptionToken: 'enc_no_handler', status: 'pending' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
      (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

      renderTab(); // no onStartAcceptBidTutorial

      await waitFor(() => {
        expect(screen.getByText('No handler')).toBeInTheDocument();
      });
      expect(screen.queryByText('Ready to accept your first bid?')).not.toBeInTheDocument();
    });
  });

  describe('Tax CSV export', () => {
    it('renders the export button even when the user has no current listings (historical events still relevant)', async () => {
      // No listings of the user's own — the empty state shows but the export
      // button must still be reachable since historical re-encryption events
      // (sales that have since left MySales) are the canonical tax record.
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderTab();

      const exportBtn = await screen.findByRole('button', { name: 'Export as CSV' });
      expect(exportBtn).toBeInTheDocument();
    });

    it('renders the export button when the user has current listings', async () => {
      const enc = makeEncryption({ description: 'Listing one' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);

      renderTab();

      const exportBtn = await screen.findByRole('button', { name: 'Export as CSV' });
      expect(exportBtn).toBeInTheDocument();
    });

    it('queries reencryption history and saves veiled-tax-records-{date}.csv on click', async () => {
      const enc = makeEncryption({ description: 'For export' });
      (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
      (chainApi.getReencryptionHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          txHash: 'd'.repeat(64),
          blockHeight: 5_000_000,
          timestamp: 1_700_000_000_000,
          encryptionTokenName: 'enc_export',
          buyerPkh: 'b'.repeat(56),
          sellerPkh: USER_PKH,
          bidAmountLovelace: 25_000_000,
          futurePriceLovelace: 60_000_000,
        },
      ]);
      (exportTextFile as ReturnType<typeof vi.fn>).mockResolvedValue('/tmp/veiled-tax-records-2026-04-25.csv');

      renderTab();

      const exportBtn = await screen.findByRole('button', { name: 'Export as CSV' });
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(exportTextFile).toHaveBeenCalledTimes(1);
      });
      expect(chainApi.getReencryptionHistory).toHaveBeenCalledWith(USER_PKH);
      const [csvArg, filenameArg] = (exportTextFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(csvArg).toBe('mock,reencryption,csv');
      expect(filenameArg).toMatch(/^veiled-tax-records-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(reencryptionHistoryToCSV).toHaveBeenCalledTimes(1);
      const [eventsArg, pkhArg] = (reencryptionHistoryToCSV as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(eventsArg).toHaveLength(1);
      expect(pkhArg).toBe(USER_PKH);
    });
  });
});
