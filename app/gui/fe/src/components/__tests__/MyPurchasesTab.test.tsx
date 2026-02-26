import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MyPurchasesTab from '../MyPurchasesTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { MY_PURCHASES_INITIAL } from '../../hooks/useTabFilterState';
import type { EncryptionDisplay, BidDisplay } from '../../services/api';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../services/api', () => ({
  bidsApi: { getAll: vi.fn() },
  encryptionsApi: { getAll: vi.fn() },
}));

vi.mock('../../services/bidSecretStorage', () => ({
  getBidSecretsForEncryption: vi.fn(),
}));

vi.mock('../../services/libraryService', () => ({
  listLibraryItems: vi.fn().mockResolvedValue([]),
}));

import { bidsApi, encryptionsApi } from '../../services/api';
import { getBidSecretsForEncryption } from '../../services/bidSecretStorage';

// ── Fixtures ────────────────────────────────────────────────────────

const USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc' + Math.random().toString(36).slice(2, 18),
    seller: 'addr_test1seller',
    sellerPkh: USER_PKH,
    status: 'Open',
    createdAt: '2024-06-15T10:00:00Z',
    utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
    datum: { full_level: { r1b: 'aa', r2_g1b: 'bb', r2_g2b: 'cc', r4b: 'dd' } } as unknown as EncryptionDisplay['datum'],
    description: 'Test encryption',
    ...overrides,
  };
}

function makeBid(overrides: Partial<BidDisplay> = {}): BidDisplay {
  return {
    tokenName: 'bid' + Math.random().toString(36).slice(2, 18),
    bidder: 'addr_test1bidder',
    bidderPkh: USER_PKH,
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

function renderTab(overrides: Partial<Parameters<typeof MyPurchasesTab>[0]> = {}) {
  return render(
    <ModalProvider>
      <MyPurchasesTab
        userPkh={USER_PKH}
        filters={MY_PURCHASES_INITIAL}
        dispatch={noopDispatch}
        {...overrides}
      />
    </ModalProvider>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getBidSecretsForEncryption as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('MyPurchasesTab — bid secrets error feedback', () => {
  it('shows purchased encryption even when getBidSecretsForEncryption throws', async () => {
    const enc = makeEncryption({ tokenName: 'enc_failing_secrets' });

    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
    (getBidSecretsForEncryption as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Decryption key mismatch')
    );

    renderTab();

    // The card should still appear with the "Purchased" badge
    await waitFor(() => {
      expect(screen.getByText('Purchased')).toBeInTheDocument();
    });
  });

  it('shows warning banner when secrets fail to load', async () => {
    const enc = makeEncryption({ tokenName: 'enc_with_error' });

    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
    (getBidSecretsForEncryption as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Corrupt secrets file')
    );

    renderTab();

    await waitFor(() => {
      expect(
        screen.getByText(/some bid data could not be loaded/i)
      ).toBeInTheDocument();
    });
  });

  it('shows warning icon on cards with secret load errors', async () => {
    const enc = makeEncryption({ tokenName: 'enc_icon_test' });

    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
    (getBidSecretsForEncryption as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Read failed')
    );

    renderTab();

    await waitFor(() => {
      expect(
        screen.getByTitle('Bid secrets could not be loaded. Decryption may not be available.')
      ).toBeInTheDocument();
    });
  });

  it('does not show warning banner when secrets load successfully', async () => {
    const enc = makeEncryption({ tokenName: 'enc_success' });

    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
    (getBidSecretsForEncryption as ReturnType<typeof vi.fn>).mockResolvedValue([
      { bidTokenName: 'bid1', b: BigInt(42) },
    ]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Purchased')).toBeInTheDocument();
    });

    expect(screen.queryByText(/some bid data could not be loaded/i)).not.toBeInTheDocument();
  });

  it('logs warning to console when secrets fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const enc = makeEncryption({ tokenName: 'enc_console_test' });

    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
    (getBidSecretsForEncryption as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Key mismatch')
    );

    renderTab();

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load bid secrets for enc_console_test'),
        expect.any(Error)
      );
    });

    warnSpy.mockRestore();
  });

  it('renders empty state when user has no bids and no purchases', async () => {
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('No purchases yet')).toBeInTheDocument();
    });
  });

  it('shows bids when user has active bids', async () => {
    const bid = makeBid({ tokenName: 'bid_display_test' });

    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderTab();

    await waitFor(() => {
      // Should show the bids section with at least one bid card
      expect(screen.getByText(/1 bid/)).toBeInTheDocument();
    });
  });
});
