import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MySalesTab from '../MySalesTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { MY_SALES_INITIAL } from '../../hooks/useTabFilterState';
import type { EncryptionDisplay, BidDisplay } from '../../services/api';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../services/api', () => ({
  encryptionsApi: { getAll: vi.fn() },
  bidsApi: { getAll: vi.fn() },
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
  getTypeLabel: vi.fn((type: string) => type),
}));

import { encryptionsApi, bidsApi } from '../../services/api';

// ── Fixtures ────────────────────────────────────────────────────────

const USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc' + Math.random().toString(36).slice(2, 18),
    seller: 'addr_test1seller',
    sellerPkh: USER_PKH,
    status: 'active',
    createdAt: '2024-06-15T10:00:00Z',
    utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
    datum: {} as EncryptionDisplay['datum'],
    description: 'A test sales listing',
    suggestedPrice: '200',
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
  (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

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
});
