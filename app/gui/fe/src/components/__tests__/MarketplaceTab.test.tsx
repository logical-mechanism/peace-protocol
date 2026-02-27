import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MarketplaceTab from '../MarketplaceTab';
import { ModalProvider } from '../../contexts/ModalContext';
import { MARKETPLACE_INITIAL } from '../../hooks/useTabFilterState';
import type { EncryptionDisplay } from '../../services/api';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../services/api', () => ({
  encryptionsApi: { getAll: vi.fn() },
  bidsApi: { getAll: vi.fn() },
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
    suggestedPrice: '100',
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
});

describe('MarketplaceTab', () => {
  it('shows empty state when no listings are available', async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('No listings available')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Failed to load listings')).toBeInTheDocument();
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('calls encryptionsApi.getAll and bidsApi.getAll on mount', async () => {
    renderTab();

    await waitFor(() => {
      expect(encryptionsApi.getAll).toHaveBeenCalledTimes(1);
      expect(bidsApi.getAll).toHaveBeenCalledTimes(1);
    });
  });

  it('renders encryption cards when data is returned', async () => {
    const enc = makeEncryption({ tokenName: 'enc_test_card_01', description: 'Unique Description Here' });
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Unique Description Here')).toBeInTheDocument();
    });
  });

  it('renders multiple cards for multiple listings', async () => {
    const enc1 = makeEncryption({ tokenName: 'enc_multi_01', description: 'First listing' });
    const enc2 = makeEncryption({ tokenName: 'enc_multi_02', description: 'Second listing' });
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([enc1, enc2]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('First listing')).toBeInTheDocument();
      expect(screen.getByText('Second listing')).toBeInTheDocument();
    });
  });

  it('re-fetches data when refreshSignal changes', async () => {
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

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
      expect(encryptionsApi.getAll).toHaveBeenCalledTimes(1);
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
      expect(encryptionsApi.getAll).toHaveBeenCalledTimes(2);
    });
  });

  it('retry button refetches data on error', async () => {
    (encryptionsApi.getAll as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce([]);

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Try Again'));

    await waitFor(() => {
      expect(encryptionsApi.getAll).toHaveBeenCalledTimes(2);
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
