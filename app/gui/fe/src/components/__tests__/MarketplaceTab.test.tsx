import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MarketplaceTab from '../MarketplaceTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { MARKETPLACE_INITIAL } from '../../hooks/useTabFilterState';
import type { EncryptionDisplay } from '../../services/api';

// ── Mocks ───────────────────────────────────────────────────────────

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

import { encryptionsApi, bidsApi } from '../../services/api';

// ── Fixtures ────────────────────────────────────────────────────────

const USER_PKH = 'abc123def456abc123def456abc123def456abc123def456abc123def456';

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc' + Math.random().toString(36).slice(2, 18),
    seller: 'addr_test1seller',
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
});
