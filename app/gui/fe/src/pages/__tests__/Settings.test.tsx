import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Settings from '../Settings';
import { invoke } from '@tauri-apps/api/core';

// ── Mocks ───────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockLock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/settings', search: '', hash: '', key: '' }),
  };
});

vi.mock('../../contexts/WalletContext', () => ({
  useWalletContext: () => ({
    walletState: 'unlocked',
    lock: mockLock,
    wallet: {},
  }),
  useAddress: () => 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae',
  useLovelace: () => '10000000',
}));

vi.mock('../../contexts/NodeContext', () => ({
  useNode: () => ({
    stage: 'synced',
    syncProgress: 100,
    kupoSyncProgress: 100,
    tipSlot: 12345,
    tipHeight: 5000,
    network: 'preprod',
    processes: [
      { name: 'cardano-node', status: 'running', pid: 1234 },
      { name: 'ogmios', status: 'running', pid: 1235 },
      { name: 'kupo', status: 'running', pid: 1236 },
    ],
    stopNode: vi.fn(),
    epoch: 150,
    era: 'Conway',
    slotInEpoch: 200000,
    slotsToEpochEnd: 232000,
    kupoConnected: true,
    kupoSecondsSinceLastBlock: 2.0,
  }),
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

vi.mock('../../services/autolock', () => ({
  getAutolockMinutes: vi.fn().mockReturnValue(15),
  setAutolockMinutes: vi.fn(),
}));

vi.mock('../../services/iagonAuth', () => ({
  connectIagon: vi.fn(),
  disconnectIagon: vi.fn(),
  isIagonConnected: vi.fn().mockResolvedValue(false),
  getValidApiKey: vi.fn().mockResolvedValue(null),
  getStoredApiKey: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/iagonApi', () => ({
  verifyApiKey: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('../../services/listingDraftStorage', () => ({
  getOrphanedDrafts: vi.fn().mockResolvedValue([]),
  removeListingDraft: vi.fn(),
}));

vi.mock('../../services/transactionHistory', () => ({
  getTransactions: vi.fn().mockReturnValue([]),
  addTransaction: vi.fn(),
  clearHistory: vi.fn(),
  clearOlderThan: vi.fn(),
  clearFailed: vi.fn(),
}));

vi.mock('../../services/tabStorage', () => ({
  setLastActiveTab: vi.fn(),
}));

vi.mock('../../services/transactionBuilder', () => ({
  extractPaymentKeyHash: vi.fn().mockReturnValue('abc123'),
}));

vi.mock('../../services/imageCache', () => ({
  listCachedImages: vi.fn().mockResolvedValue({ cached: [], banned: [] }),
  deleteCachedImage: vi.fn(),
}));

vi.mock('../../services/toastSettings', () => ({
  getToastDurationMs: vi.fn().mockReturnValue(5000),
  setToastDurationMs: vi.fn(),
  TOAST_DURATION_OPTIONS: [
    { label: '3 seconds', value: 3000 },
    { label: '5 seconds', value: 5000 },
    { label: '8 seconds', value: 8000 },
    { label: 'Never', value: 0 },
  ],
}));

vi.mock('../../services/apiCache', () => ({
  apiCache: { clear: vi.fn(), size: 0 },
}));

vi.mock('../../services/notificationSound', () => ({
  previewSound: vi.fn(),
}));

vi.mock('../../services/soundPreferences', () => ({
  isMasterSoundEnabled: vi.fn().mockReturnValue(true),
  setMasterSoundEnabled: vi.fn(),
  isEventSoundEnabled: vi.fn().mockReturnValue(true),
  setEventSoundEnabled: vi.fn(),
  getEventSoundVolume: vi.fn().mockReturnValue(0.5),
  setEventSoundVolume: vi.fn(),
  SOUND_EVENTS: ['new_bid', 'tx_confirmed', 'tx_failed', 'bid_accepted'],
  SOUND_EVENT_LABELS: {
    new_bid: { label: 'New Bid', description: 'A new bid is placed on one of your listings' },
    tx_confirmed: { label: 'Transaction Confirmed', description: 'A transaction reaches 15 confirmations' },
    tx_failed: { label: 'Transaction Failed', description: 'A transaction submission fails' },
    bid_accepted: { label: 'Bid Accepted', description: 'A bid you placed was accepted by the seller' },
  },
}));

vi.mock('../../services/desktopNotifications', () => ({
  isDesktopNotificationsEnabled: vi.fn().mockReturnValue(false),
  setDesktopNotificationsEnabled: vi.fn(),
  sendDesktopNotification: vi.fn(),
}));

vi.mock('../../services/themeStorage', () => ({
  getTheme: vi.fn().mockReturnValue('dark'),
  setTheme: vi.fn(),
  applyTheme: vi.fn(),
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

vi.mock('../../services/walletManagement', () => ({
  createCollateral: vi.fn(),
  defragWallet: vi.fn(),
  previewDefrag: vi.fn().mockResolvedValue(null),
}));

// Settings uses ConfirmModal → useModalStack → useModal
import { ModalProvider } from '../../contexts/ModalContext';

function renderPage() {
  return render(
    <MemoryRouter>
      <ModalProvider>
        <Settings />
      </ModalProvider>
    </MemoryRouter>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (invoke as ReturnType<typeof vi.fn>)
    .mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case 'get_network': return 'preprod';
        case 'get_disk_usage': return { chain_data_bytes: 0, snark_data_bytes: 0, wallet_bytes: 0, total_bytes: 0, data_dir: '/tmp' };
        case 'get_available_disk_space': return { available_bytes: 50_000_000_000 };
        case 'get_app_config': return {};
        case 'get_process_logs': return [];
        default: return undefined;
      }
    });
});

describe('Settings', () => {
  it('renders Settings page with sidebar navigation', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Node Status')).toBeInTheDocument();
      expect(screen.getByText('Wallet')).toBeInTheDocument();
      // "Network" also appears as a label in the node status section
      expect(screen.getAllByText('Network').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Data Layer')).toBeInTheDocument();
      expect(screen.getByText('Storage')).toBeInTheDocument();
      expect(screen.getByText('Logs')).toBeInTheDocument();
    });
  });

  it('starts on the node section by default', async () => {
    renderPage();

    await waitFor(() => {
      // Node section shows process status
      expect(screen.getByText('cardano-node')).toBeInTheDocument();
    });
  });

  it('navigates to wallet section on click', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Wallet')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Wallet'));

    await waitFor(() => {
      // Wallet section shows wallet address
      expect(screen.getByText(/addr_test1/)).toBeInTheDocument();
    });
  });

  it('has a back button that navigates to dashboard', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Back'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('calls get_network on mount', async () => {
    renderPage();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_network');
    });
  });

  it('displays network name', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/preprod/i)).toBeInTheDocument();
    });
  });
});
