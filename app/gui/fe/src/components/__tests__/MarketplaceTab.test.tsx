import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MarketplaceTab from '../MarketplaceTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { MARKETPLACE_INITIAL } from '../../hooks/useTabFilterState';
import type { EncryptionDisplay } from '../../services/api';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../contexts/NodeContext', () => ({
  useNode: vi.fn().mockReturnValue({ expressReady: true }),
}));

vi.mock('../../services/api', () => ({
  encryptionsApi: { getAll: vi.fn(), getAllWithWarnings: vi.fn() },
  bidsApi: { getAll: vi.fn(), getAllWithWarnings: vi.fn() },
}));

vi.mock('../../services/imageCache', () => ({
  listCachedImages: vi.fn().mockResolvedValue({ cached: [], banned: [] }),
  downloadImage: vi.fn(),
  getCachedImage: vi.fn(),
  banImage: vi.fn(),
  unbanImage: vi.fn(),
}));

vi.mock('../../services/favoritesStorage', () => ({
  getFavorites: vi.fn().mockReturnValue(new Set()),
  toggleFavorite: vi.fn(),
}));

vi.mock('../../services/onboardingStorage', () => ({
  getOnboardingState: vi.fn().mockReturnValue({ step: 3, completed: true, firstListingCompleted: false, firstBidCompleted: false }),
}));

import { encryptionsApi, bidsApi } from '../../services/api';
import { getOnboardingState } from '../../services/onboardingStorage';

// ── Fixtures ────────────────────────────────────────────────────────

const USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc' + Math.random().toString(36).slice(2, 18),
    sellerPkh: 'seller_pkh_' + 'a'.repeat(46),
    status: 'active',
    createdAt: '2024-06-15T10:00:00Z',
    utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
    datum: {} as EncryptionDisplay['datum'],
    description: 'A test encryption listing',
    suggestedPrice: 100,
    ...overrides,
  };
}


const noopDispatch = vi.fn();

function renderTab(overrides: Partial<Parameters<typeof MarketplaceTab>[0]> = {}) {
  return render(
    <ModalProvider>
      <MarketplaceTab
        userPkh={USER_PKH}
        filters={MARKETPLACE_INITIAL}
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
  (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], stale: false });
  (bidsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], stale: false });
});

describe('MarketplaceTab', () => {
  it('shows empty state when no listings are available', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('No listings available yet')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Failed to load listings')).toBeInTheDocument();
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('calls getAllWithWarnings on mount', async () => {
    renderTab();

    await waitFor(() => {
      expect(encryptionsApi.getAllWithWarnings).toHaveBeenCalledTimes(1);
      expect(bidsApi.getAllWithWarnings).toHaveBeenCalledTimes(1);
    });
  });

  it('renders encryption cards when data is returned', async () => {
    const enc = makeEncryption({ tokenName: 'enc_test_card_01', description: 'Unique Description Here' });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [enc], stale: false });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Unique Description Here')).toBeInTheDocument();
    });
  });

  it('renders multiple cards for multiple listings', async () => {
    const enc1 = makeEncryption({ tokenName: 'enc_multi_01', description: 'First listing' });
    const enc2 = makeEncryption({ tokenName: 'enc_multi_02', description: 'Second listing' });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [enc1, enc2], stale: false });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('First listing')).toBeInTheDocument();
      expect(screen.getByText('Second listing')).toBeInTheDocument();
    });
  });

  it('re-fetches data when refreshSignal changes', async () => {
    const { rerender } = render(
      <ModalProvider>
        <MarketplaceTab
          userPkh={USER_PKH}
          filters={MARKETPLACE_INITIAL}
          dispatch={noopDispatch}
          refreshSignal={1}
        />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(encryptionsApi.getAllWithWarnings).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ModalProvider>
        <MarketplaceTab
          userPkh={USER_PKH}
          filters={MARKETPLACE_INITIAL}
          dispatch={noopDispatch}
          refreshSignal={2}
        />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(encryptionsApi.getAllWithWarnings).toHaveBeenCalledTimes(2);
    });
  });

  it('retry button refetches data on error', async () => {
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ data: [], stale: false });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Try Again'));

    await waitFor(() => {
      expect(encryptionsApi.getAllWithWarnings).toHaveBeenCalledTimes(2);
    });
  });

  it('closes filters panel on Escape key', async () => {
    const enc = makeEncryption({ description: 'Escape test listing' });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [enc], stale: false });

    renderTab();

    // Wait for data to load so the toolbar renders
    await waitFor(() => {
      expect(screen.getByText('Escape test listing')).toBeInTheDocument();
    });

    // Open filters
    const filtersButton = screen.getByRole('button', { name: /filters/i });
    fireEvent.click(filtersButton);
    expect(filtersButton).toHaveAttribute('aria-expanded', 'true');

    // Press Escape to close
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(filtersButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows encouraging empty state with Create Listing CTA', async () => {
    const onCreate = vi.fn();
    renderTab({ onCreateListing: onCreate });

    await waitFor(() => {
      expect(screen.getByText('No listings available yet')).toBeInTheDocument();
      expect(screen.getByText('Be the first to create one!')).toBeInTheDocument();
      expect(screen.getByText('Create Listing')).toBeInTheDocument();
    });
  });

  it('has accessible screen reader status region', async () => {
    renderTab();

    await waitFor(() => {
      const srRegion = document.querySelector('[role="status"][aria-live="polite"]');
      expect(srRegion).toBeInTheDocument();
    });
  });

  it('shows stale banner when backend returns stale warning', async () => {
    const enc = makeEncryption({ description: 'Stale listing' });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [enc],
      stale: true,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/Showing cached listings/)).toBeInTheDocument();
    });
    // Data is still rendered
    expect(screen.getByText('Stale listing')).toBeInTheDocument();
  });

  it('shows stale banner on refresh failure when data already loaded', async () => {
    const enc = makeEncryption({ description: 'Previously loaded' });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: [enc], stale: false })
      .mockRejectedValueOnce(new Error('Network error'));
    (bidsApi.getAllWithWarnings as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: [], stale: false })
      .mockRejectedValueOnce(new Error('Network error'));

    const { rerender } = render(
      <ModalProvider>
        <MarketplaceTab
          userPkh={USER_PKH}
          filters={MARKETPLACE_INITIAL}
          dispatch={noopDispatch}
          refreshSignal={1}
        />
      </ModalProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Previously loaded')).toBeInTheDocument();
    });

    // Trigger refresh failure
    rerender(
      <ModalProvider>
        <MarketplaceTab
          userPkh={USER_PKH}
          filters={MARKETPLACE_INITIAL}
          dispatch={noopDispatch}
          refreshSignal={2}
        />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Showing cached listings/)).toBeInTheDocument();
    });
    // Old data still visible
    expect(screen.getByText('Previously loaded')).toBeInTheDocument();
  });

  it('dismisses stale banner when dismiss button is clicked', async () => {
    const enc = makeEncryption({ description: 'Stale test' });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [enc],
      stale: true,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/Showing cached listings/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Dismiss stale data warning'));

    expect(screen.queryByText(/Showing cached listings/)).not.toBeInTheDocument();
  });

  it('clears stale banner on successful refresh', async () => {
    const enc = makeEncryption({ description: 'Stale then fresh' });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: [enc], stale: true })
      .mockResolvedValueOnce({ data: [enc], stale: false });
    (bidsApi.getAllWithWarnings as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: [], stale: false })
      .mockResolvedValueOnce({ data: [], stale: false });

    const { rerender } = render(
      <ModalProvider>
        <MarketplaceTab
          userPkh={USER_PKH}
          filters={MARKETPLACE_INITIAL}
          dispatch={noopDispatch}
          refreshSignal={1}
        />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Showing cached listings/)).toBeInTheDocument();
    });

    // Trigger successful refresh
    rerender(
      <ModalProvider>
        <MarketplaceTab
          userPkh={USER_PKH}
          filters={MARKETPLACE_INITIAL}
          dispatch={noopDispatch}
          refreshSignal={2}
        />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText(/Showing cached listings/)).not.toBeInTheDocument();
    });
  });

  it('shows tutorial banner when onboarding complete and firstListingCompleted is false', async () => {
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: false, firstBidCompleted: false,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/New to Veiled/)).toBeInTheDocument();
      expect(screen.getByText(/Take a guided tour/)).toBeInTheDocument();
    });
  });

  it('hides tutorial banner when firstListingCompleted is true', async () => {
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: true, firstBidCompleted: false,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.queryByText(/New to Veiled/)).not.toBeInTheDocument();
    });
  });

  it('hides tutorial banner when onboarding not complete', async () => {
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 1, completed: false, firstListingCompleted: false, firstBidCompleted: false,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.queryByText(/New to Veiled/)).not.toBeInTheDocument();
    });
  });

  it('dismisses tutorial banner on X click (session only)', async () => {
    // firstBidCompleted: true so only the listing banner renders — isolates this test
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: false, firstBidCompleted: true,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/New to Veiled/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Dismiss'));

    expect(screen.queryByText(/New to Veiled/)).not.toBeInTheDocument();
  });

  it('calls onStartTutorial and hides banner when Start Tour is clicked', async () => {
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: false, firstBidCompleted: false,
    });

    const onStartTutorial = vi.fn();
    renderTab({ onStartTutorial });

    await waitFor(() => {
      expect(screen.getByText('Start Tour')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Start Tour'));

    expect(onStartTutorial).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/New to Veiled/)).not.toBeInTheDocument();
  });

  // --- Bid tutorial banner ---

  it('shows bid banner when onboarding complete, firstBidCompleted is false, and an eligible listing exists', async () => {
    const enc = makeEncryption(); // default sellerPkh != USER_PKH so it's eligible
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [enc], stale: false });
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: true, firstBidCompleted: false,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/Ready to place your first bid/)).toBeInTheDocument();
    });
  });

  it('hides bid banner when no eligible listings exist (empty marketplace)', async () => {
    // default beforeEach mocks return empty data
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: true, firstBidCompleted: false,
    });

    renderTab();

    // Wait for the loaded state (no listings) to settle, then confirm banner is absent
    await waitFor(() => {
      expect(encryptionsApi.getAllWithWarnings).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Ready to place your first bid/)).not.toBeInTheDocument();
  });

  it('hides bid banner when the only listing is the user\'s own (not eligible)', async () => {
    const own = makeEncryption({ sellerPkh: USER_PKH });
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [own], stale: false });
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: true, firstBidCompleted: false,
    });

    renderTab();

    await waitFor(() => {
      expect(encryptionsApi.getAllWithWarnings).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Ready to place your first bid/)).not.toBeInTheDocument();
  });

  it('hides bid banner when firstBidCompleted is true', async () => {
    const enc = makeEncryption();
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [enc], stale: false });
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: true, firstBidCompleted: true,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.queryByText(/Ready to place your first bid/)).not.toBeInTheDocument();
    });
  });

  it('shows both banners when both tutorials are incomplete and an eligible listing exists', async () => {
    const enc = makeEncryption();
    (encryptionsApi.getAllWithWarnings as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [enc], stale: false });
    (getOnboardingState as ReturnType<typeof vi.fn>).mockReturnValue({
      step: 3, completed: true, firstListingCompleted: false, firstBidCompleted: false,
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/New to Veiled/)).toBeInTheDocument();
      expect(screen.getByText(/Ready to place your first bid/)).toBeInTheDocument();
    });
  });
});
