import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MyPurchasesTab from '../MyPurchasesTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { MY_PURCHASES_INITIAL } from '../../hooks/useTabFilterState';
import type { EncryptionDisplay, BidDisplay } from '../../services/api';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../contexts/NodeContext', () => ({
  useNode: vi.fn().mockReturnValue({ expressReady: true }),
}));

vi.mock('../../services/api', () => ({
  bidsApi: { getAll: vi.fn() },
  encryptionsApi: { getAll: vi.fn() },
}));

vi.mock('../../services/bidSecretStorage', () => ({
  getBidSecretsForEncryption: vi.fn(),
  listBidSecretTokens: vi.fn(),
}));

vi.mock('../../services/libraryService', () => ({
  listLibraryItems: vi.fn().mockResolvedValue([]),
}));

const mockGetOnboardingState = vi.fn();
vi.mock('../../services/onboardingStorage', () => ({
  getOnboardingState: (...args: unknown[]) => mockGetOnboardingState(...args),
}));

import { bidsApi, encryptionsApi } from '../../services/api';
import { getBidSecretsForEncryption, listBidSecretTokens } from '../../services/bidSecretStorage';

// ── Fixtures ────────────────────────────────────────────────────────

const USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc' + Math.random().toString(36).slice(2, 18),
    sellerPkh: USER_PKH,
    status: 'active',
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
    lockedUntil: Date.now() + 12 * 60 * 60 * 1000,
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
  (listBidSecretTokens as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  // Default: onboarding done, tutorial not yet shown (banner would appear when
  // an accepted bid is present).
  mockGetOnboardingState.mockReturnValue({
    step: 3,
    completed: true,
    firstListingCompleted: true,
    firstBidCompleted: true,
    firstDecryptCompleted: false,
  });
});

describe('MyPurchasesTab — bid secrets error feedback', () => {
  it('shows purchased encryption even when getBidSecretsForEncryption throws', async () => {
    const enc = makeEncryption({ tokenName: 'enc_failing_secrets' });

    (listBidSecretTokens as ReturnType<typeof vi.fn>).mockResolvedValue(['enc_failing_secrets']);
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

    (listBidSecretTokens as ReturnType<typeof vi.fn>).mockResolvedValue(['enc_with_error']);
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

    (listBidSecretTokens as ReturnType<typeof vi.fn>).mockResolvedValue(['enc_icon_test']);
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

    (listBidSecretTokens as ReturnType<typeof vi.fn>).mockResolvedValue(['enc_success']);
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

    (listBidSecretTokens as ReturnType<typeof vi.fn>).mockResolvedValue(['enc_console_test']);
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
      expect(screen.getByText(/^1 bid$/)).toBeInTheDocument();
    });
  });
});

describe('MyPurchasesTab — first-decrypt tutorial banner', () => {
  it('shows the banner when buyer has an accepted bid and tutorial is incomplete', async () => {
    const encToken = 'enc_banner_show';
    const enc = makeEncryption({ tokenName: encToken });
    const bid = makeBid({ status: 'accepted', tokenName: 'bid_banner_show', encryptionToken: encToken });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/your first winning bid is ready/i)).toBeInTheDocument();
    });
  });

  it('hides the banner when onboarding is not yet completed', async () => {
    mockGetOnboardingState.mockReturnValue({
      step: 0,
      completed: false,
      firstListingCompleted: false,
      firstBidCompleted: false,
      firstDecryptCompleted: false,
    });
    const bid = makeBid({ status: 'accepted', tokenName: 'bid_banner_pre_onboard' });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/^1 bid$/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/your first winning bid is ready/i)).not.toBeInTheDocument();
  });

  it('hides the banner when the tutorial is already completed', async () => {
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: true,
      firstBidCompleted: true,
      firstDecryptCompleted: true,
    });
    const bid = makeBid({ status: 'accepted', tokenName: 'bid_banner_done' });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/^1 bid$/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/your first winning bid is ready/i)).not.toBeInTheDocument();
  });

  it('hides the banner when there are no accepted bids waiting to decrypt', async () => {
    const bid = makeBid({ status: 'pending', tokenName: 'bid_banner_pending' });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/^1 bid$/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/your first winning bid is ready/i)).not.toBeInTheDocument();
  });

  it('starts the tutorial with the first accepted bid when Start is clicked', async () => {
    const onStart = vi.fn();
    const encToken = 'enc_banner_start';
    const enc = makeEncryption({ tokenName: encToken });
    const accepted = makeBid({ status: 'accepted', tokenName: 'bid_banner_start', encryptionToken: encToken, createdAt: '2024-06-10T09:00:00Z' });
    const pending = makeBid({ status: 'pending', tokenName: 'bid_banner_start_pending', encryptionToken: encToken, createdAt: '2024-06-09T09:00:00Z' });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([pending, accepted]);
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);

    renderTab({ onStartDecryptTutorial: onStart });

    await waitFor(() => {
      expect(screen.getByText(/your first winning bid is ready/i)).toBeInTheDocument();
    });
    const startBtn = screen.getByRole('button', { name: /start tour/i });
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0].bid?.tokenName).toBe('bid_banner_start');
    expect(onStart.mock.calls[0][0].encryption.tokenName).toBe(encToken);
  });

  it('falls back to a purchased encryption when no accepted bid is waiting', async () => {
    const onStart = vi.fn();
    const enc = makeEncryption({ tokenName: 'enc_owned', sellerPkh: USER_PKH });
    (listBidSecretTokens as ReturnType<typeof vi.fn>).mockResolvedValue(['enc_owned']);
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);
    (getBidSecretsForEncryption as ReturnType<typeof vi.fn>).mockResolvedValue([
      { bidTokenName: 'bid1', b: BigInt(42) },
    ]);

    renderTab({ onStartDecryptTutorial: onStart });

    await waitFor(() => {
      expect(screen.getByText(/your first winning bid is ready/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /start tour/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0].bid).toBeUndefined();
    expect(onStart.mock.calls[0][0].encryption.tokenName).toBe('enc_owned');
  });

  it('hides the banner when the buyer has no bids and no purchased encryptions', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/no purchases yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/your first winning bid is ready/i)).not.toBeInTheDocument();
  });

  it('hides the banner after the dismiss button is clicked', async () => {
    const encToken = 'enc_banner_dismiss';
    const enc = makeEncryption({ tokenName: encToken });
    const bid = makeBid({ status: 'accepted', tokenName: 'bid_banner_dismiss', encryptionToken: encToken });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/your first winning bid is ready/i)).toBeInTheDocument();
    });
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(screen.queryByText(/your first winning bid is ready/i)).not.toBeInTheDocument();
    });
  });

  it('auto-starts the tutorial when autoStartDecryptTutorial flips true (Settings Replay)', async () => {
    const onStart = vi.fn();
    const onConsumed = vi.fn();
    const encToken = 'enc_auto_start';
    const enc = makeEncryption({ tokenName: encToken });
    const bid = makeBid({ status: 'accepted', tokenName: 'bid_auto_start', encryptionToken: encToken });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);

    renderTab({
      onStartDecryptTutorial: onStart,
      autoStartDecryptTutorial: true,
      onAutoStartConsumed: onConsumed,
    });

    await waitFor(() => {
      expect(onStart).toHaveBeenCalledTimes(1);
    });
    expect(onStart.mock.calls[0][0].bid?.tokenName).toBe('bid_auto_start');
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it('does not auto-start the tutorial when autoStartDecryptTutorial is false', async () => {
    const onStart = vi.fn();
    const bid = makeBid({ status: 'accepted', tokenName: 'bid_no_auto_start' });
    (bidsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([bid]);

    renderTab({ onStartDecryptTutorial: onStart });

    await waitFor(() => {
      expect(screen.getByText(/^1 bid$/)).toBeInTheDocument();
    });
    expect(onStart).not.toHaveBeenCalled();
  });
});
