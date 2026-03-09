import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';

// ── Mocks ───────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../contexts/WalletContext', () => ({
  useWalletContext: () => ({
    disconnect: mockDisconnect,
    wallet: {},
    refreshBalance: vi.fn(),
  }),
  useAddress: () => 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae',
  useLovelace: () => '25000000',
}));

vi.mock('../../contexts/WasmContext', () => ({
  useWasm: () => ({
    isReady: true,
    isLoading: false,
    progress: 100,
  }),
}));

vi.mock('../../contexts/NodeContext', () => ({
  useNode: () => ({
    stage: 'synced',
    syncProgress: 100,
    kupoSyncProgress: 100,
    tipSlot: 12345,
    epoch: 150,
    era: 'Conway',
    slotInEpoch: 200000,
    slotsToEpochEnd: 232000,
    kupoConnected: true,
    kupoSecondsSinceLastBlock: 2.0,
  }),
}));

vi.mock('../../contexts/ModalContext', () => ({
  useModal: () => ({
    hasOpenModal: false,
    registerModal: vi.fn(),
    unregisterModal: vi.fn(),
    isTopModal: () => true,
  }),
}));

// Mock lazy-loaded tab components to avoid deep dependency chains
vi.mock('../../components/MarketplaceTab', () => ({
  default: () => <div data-testid="marketplace-tab">MarketplaceTab</div>,
}));
vi.mock('../../components/MySalesTab', () => ({
  default: () => <div data-testid="my-sales-tab">MySalesTab</div>,
}));
vi.mock('../../components/MyPurchasesTab', () => ({
  default: () => <div data-testid="my-purchases-tab">MyPurchasesTab</div>,
}));
vi.mock('../../components/HistoryTab', () => ({
  default: () => <div data-testid="history-tab">HistoryTab</div>,
}));
vi.mock('../../components/LibraryTab', () => ({
  default: () => <div data-testid="library-tab">LibraryTab</div>,
}));

// Mock modal components
vi.mock('../../components/CreateListingModal', () => ({
  default: () => null,
}));
vi.mock('../../components/PlaceBidModal', () => ({
  default: () => null,
}));
vi.mock('../../components/DecryptModal', () => ({
  default: () => null,
}));
vi.mock('../../components/SnarkProvingModal', () => ({
  default: () => null,
}));
vi.mock('../../components/ConfirmModal', () => ({
  default: () => null,
}));
vi.mock('../../components/KeyboardShortcutsOverlay', () => ({
  default: () => null,
}));
vi.mock('../../components/ScrollToTop', () => ({
  default: () => null,
}));

// Mock services
vi.mock('../../services/api', () => ({
  encryptionsApi: { getAll: vi.fn().mockResolvedValue([]) },
  bidsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../services/secretCleanup', () => ({
  cleanupStaleSecrets: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/iagonAuth', () => ({
  isIagonConnected: vi.fn().mockResolvedValue(false),
  connectIagon: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/transactionBuilder', () => ({
  createListing: vi.fn(),
  retryListingFromDraft: vi.fn(),
  removeListing: vi.fn(),
  placeBid: vi.fn(),
  cancelBid: vi.fn(),
  cancelPendingListing: vi.fn(),
  acceptBidSnark: vi.fn(),
  prepareSnarkInputs: vi.fn(),
  completeReEncryption: vi.fn(),
  getTransactionStubWarning: vi.fn().mockReturnValue(null),
  extractPaymentKeyHash: vi.fn().mockReturnValue('abc123def456abc123def456abc123def456abc123def456abc123def456'),
}));
vi.mock('../../services/acceptBidStorage', () => ({
  getAcceptBidSecrets: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../services/contentStorage', () => ({
  saveDecryptedContent: vi.fn(),
  saveContentMetadata: vi.fn(),
}));
vi.mock('../../services/listingDraftStorage', () => ({
  getRecoverableDrafts: vi.fn().mockResolvedValue([]),
  updateListingDraft: vi.fn(),
}));
vi.mock('../../services/transactionHistory', () => ({
  getTransactions: vi.fn().mockReturnValue([]),
  addTransaction: vi.fn(),
}));
vi.mock('../../services/tabStorage', () => ({
  getLastActiveTab: vi.fn().mockReturnValue('marketplace'),
  setLastActiveTab: vi.fn(),
  clearLastActiveTab: vi.fn(),
}));
vi.mock('../../services/filterStorage', () => ({
  getPersistedFilters: vi.fn().mockReturnValue(null),
  persistFilters: vi.fn(),
}));
vi.mock('../../services/libraryService', () => ({
  listLibraryItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../hooks/useBidNotifications', () => ({
  useBidNotifications: () => ({ newBidCount: 0, markAllSeen: vi.fn() }),
}));
vi.mock('../../services/notificationSound', () => ({
  playNotificationSound: vi.fn(),
}));
vi.mock('../../services/desktopNotifications', () => ({
  sendDesktopNotification: vi.fn(),
}));
vi.mock('../../hooks/useDataRefresh', () => ({
  useDataRefresh: () => ({
    refreshSignal: 0,
    triggerRefresh: vi.fn(),
    lastRefresh: Date.now(),
    isRefreshing: false,
    handleRefresh: vi.fn(),
  }),
}));
vi.mock('../../hooks/useWalletHealth', () => ({
  useWalletHealth: () => ({
    hasCollateral: true,
    utxoCount: 5,
    isFragmented: false,
    isHealthy: true,
    loading: false,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Dashboard', () => {
  it('renders the Dashboard with tab navigation', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Marketplace/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /My Sales/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /My Purchases/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /History/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Library/ })).toBeInTheDocument();
    });
  });

  it('starts with marketplace tab active', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-tab')).toBeInTheDocument();
    });
  });

  it('switches to My Sales tab on click', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /My Sales/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /My Sales/ }));

    await waitFor(() => {
      expect(screen.getByTestId('my-sales-tab')).toBeInTheDocument();
    });
  });

  it('switches to Library tab on click', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Library/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Library/ }));

    await waitFor(() => {
      expect(screen.getByTestId('library-tab')).toBeInTheDocument();
    });
  });

  it('displays wallet balance', async () => {
    renderPage();

    await waitFor(() => {
      // 25000000 lovelace = 25 ADA
      expect(screen.getByText(/25/)).toBeInTheDocument();
    });
  });

  it('displays wallet address (truncated)', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/addr_test/)).toBeInTheDocument();
    });
  });

  it('has settings navigation button', async () => {
    renderPage();

    await waitFor(() => {
      const settingsBtn = screen.getByLabelText(/settings/i);
      expect(settingsBtn).toBeInTheDocument();
    });
  });
});
