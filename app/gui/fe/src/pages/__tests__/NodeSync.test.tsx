import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import NodeSync from '../NodeSync';
import { invoke } from '@tauri-apps/api/core';

// ── Mocks ───────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockStartNode = vi.fn();
const mockStopNode = vi.fn();
const mockStartBootstrap = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockNodeState = {
  stage: 'stopped' as string,
  syncProgress: 0,
  kupoSyncProgress: 0,
  tipHeight: 0,
  network: 'preprod',
  processes: [] as Array<{ name: string; status: string; pid: number | null }>,
  mithrilProgress: null as { bytes_downloaded: number; total_bytes: number } | null,
  needsBootstrap: false,
  error: null as string | null,
  logs: [] as string[],
};

vi.mock('../../contexts/NodeContext', () => ({
  useNode: () => ({
    ...mockNodeState,
    startNode: mockStartNode,
    stopNode: mockStopNode,
    startBootstrap: mockStartBootstrap,
  }),
}));

vi.mock('../../contexts/WalletContext', () => ({
  useWalletContext: () => ({
    address: 'addr_test1_mock_address',
  }),
}));

const mockCopyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <NodeSync />
    </MemoryRouter>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockNodeState = {
    stage: 'stopped',
    syncProgress: 0,
    kupoSyncProgress: 0,
    tipHeight: 0,
    network: 'preprod',
    processes: [],
    mithrilProgress: null,
    needsBootstrap: false,
    error: null,
    logs: [],
  };
  (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ available_bytes: 20_000_000_000 });
});

describe('NodeSync — stopped stage', () => {
  it('renders the node sync page with stage indicators', () => {
    renderPage();

    expect(screen.getByText('Bootstrap')).toBeInTheDocument();
    expect(screen.getByText('Starting')).toBeInTheDocument();
    expect(screen.getByText('Syncing')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('shows Start Node button when stopped and no bootstrap needed', () => {
    renderPage();

    expect(screen.getByText('Start Node')).toBeInTheDocument();
  });

  it('calls startNode when Start Node is clicked', () => {
    renderPage();

    fireEvent.click(screen.getByText('Start Node'));
    expect(mockStartNode).toHaveBeenCalledWith('addr_test1_mock_address');
  });

  it('shows Download Snapshot button when needsBootstrap is true', () => {
    mockNodeState.needsBootstrap = true;
    renderPage();

    expect(screen.getByText('Download Snapshot & Start')).toBeInTheDocument();
  });

  it('shows bootstrap info message when needsBootstrap is true', () => {
    mockNodeState.needsBootstrap = true;
    renderPage();

    expect(screen.getByText(/Blockchain data not found/i)).toBeInTheDocument();
  });
});

describe('NodeSync — syncing stage', () => {
  it('shows syncing heading and status text', () => {
    mockNodeState.stage = 'syncing';
    mockNodeState.syncProgress = 45.5;
    mockNodeState.kupoSyncProgress = 30;
    renderPage();

    expect(screen.getByText('Syncing Chain')).toBeInTheDocument();
    // statusMessage rendered in multiple places (block info fallback + below checklist)
    expect(screen.getAllByText(/Syncing with preprod network/).length).toBeGreaterThanOrEqual(1);
    // Syncing shows service checklist, not ProgressBar (which is only for bootstrapping)
    expect(screen.getByText('Cardano Node')).toBeInTheDocument();
    expect(screen.getByText('Kupo Indexer')).toBeInTheDocument();
  });
});

describe('NodeSync — synced stage', () => {
  it('shows continue to dashboard button', () => {
    mockNodeState.stage = 'synced';
    mockNodeState.syncProgress = 100;
    mockNodeState.kupoSyncProgress = 100;
    renderPage();

    expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument();
  });

  it('navigates to dashboard on continue click', () => {
    mockNodeState.stage = 'synced';
    renderPage();

    fireEvent.click(screen.getByText('Continue to Dashboard'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});

describe('NodeSync — error stage', () => {
  it('shows error guidance', () => {
    mockNodeState.stage = 'error';
    mockNodeState.error = 'Connection refused';
    renderPage();

    // errorGuidance.title AND statusMessage are both 'Connection refused'
    const matches = screen.getAllByText('Connection refused');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows copy button in error details that copies the error message', async () => {
    mockNodeState.stage = 'error';
    mockNodeState.error = 'Connection refused';
    renderPage();

    // Open the details
    const details = screen.getByText('Details');
    fireEvent.click(details);

    // Copy button should be present
    const copyBtn = screen.getByLabelText('Copy error details');
    expect(copyBtn).toBeInTheDocument();

    // Click copy
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith('Connection refused');
    });
  });
});

describe('NodeSync — disk space', () => {
  it('shows disk space warning when space is low', async () => {
    mockNodeState.needsBootstrap = true;
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ available_bytes: 1_000_000_000 }); // 1GB

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Low disk space/i)).toBeInTheDocument();
    });
  });

  it('shows warning when disk space check fails', async () => {
    mockNodeState.needsBootstrap = true;
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No access'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Could not verify disk space/i)).toBeInTheDocument();
    });
  });
});
