import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SnarkSetupModal from '../SnarkDownloadModal';
import { ModalProvider } from '../../contexts/ModalContext';

// ── Mocks ───────────────────────────────────────────────────────────

const mockCheckSetup = vi.fn();
const mockInitialize = vi.fn();

vi.mock('../../services/snark', () => ({
  getSnarkProver: () => ({
    checkSetup: mockCheckSetup,
    initialize: mockInitialize,
  }),
}));

vi.mock('../../hooks/useModalStack', () => ({
  useModalStack: (_name: string, isOpen: boolean, _onClose: () => void, _blocked?: boolean) => ({
    zIndex: 50,
    shouldRender: isOpen,
    animationState: isOpen ? 'entered' : 'exiting',
    shouldHandleEscape: true,
  }),
}));

vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onReady: vi.fn(),
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <ModalProvider>
      <SnarkSetupModal {...defaultProps} {...overrides} />
    </ModalProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('SnarkSetupModal', () => {
  describe('rendering', () => {
    it('does not render when isOpen is false', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByText('SNARK Prover Setup')).not.toBeInTheDocument();
    });

    it('shows checking message on open', () => {
      mockCheckSetup.mockImplementation(() => new Promise(() => {}));
      renderModal();
      expect(screen.getByText('Checking setup files...')).toBeInTheDocument();
    });
  });

  describe('setup already exists', () => {
    it('transitions to complete and calls onReady when setup exists', async () => {
      const onReady = vi.fn();
      mockCheckSetup.mockResolvedValue(true);
      renderModal({ onReady });

      await waitFor(() => {
        expect(screen.getByText('Prover Ready')).toBeInTheDocument();
      });
      expect(onReady).toHaveBeenCalledOnce();
      expect(mockInitialize).not.toHaveBeenCalled();
    });
  });

  describe('decompression flow', () => {
    it('shows decompressing message when setup does not exist', async () => {
      mockCheckSetup.mockResolvedValue(false);
      mockInitialize.mockImplementation(() => new Promise(() => {})); // hang
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Decompressing SNARK setup files...')).toBeInTheDocument();
      });
    });

    it('shows "only once" note during decompression', async () => {
      mockCheckSetup.mockResolvedValue(false);
      mockInitialize.mockImplementation(() => new Promise(() => {}));
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('This only needs to happen once')).toBeInTheDocument();
      });
    });

    it('calls onReady after successful decompression', async () => {
      const onReady = vi.fn();
      mockCheckSetup.mockResolvedValue(false);
      mockInitialize.mockResolvedValue(undefined);
      renderModal({ onReady });

      await waitFor(() => {
        expect(screen.getByText('Prover Ready')).toBeInTheDocument();
      });
      expect(onReady).toHaveBeenCalledOnce();
    });

    it('updates progress message during decompression', async () => {
      mockCheckSetup.mockResolvedValue(false);
      mockInitialize.mockImplementation((onProgress) => {
        onProgress({ stage: 'decompressing', message: 'Extracting pk.bin (50%)...' });
        // Don't resolve yet — let the message render
        return new Promise(() => {});
      });
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Extracting pk.bin (50%)...')).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows error message on setup failure', async () => {
      mockCheckSetup.mockRejectedValue(new Error('Disk full'));
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Disk full')).toBeInTheDocument();
      });
    });

    it('shows Retry and Cancel buttons on error', async () => {
      mockCheckSetup.mockRejectedValue(new Error('fail'));
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });
    });

    it('retries setup on Retry click', async () => {
      mockCheckSetup.mockRejectedValueOnce(new Error('fail'));
      mockInitialize.mockResolvedValue(undefined);
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText('Prover Ready')).toBeInTheDocument();
      });
    });

    it('handles non-Error rejection', async () => {
      mockCheckSetup.mockRejectedValue('string error');
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Setup failed')).toBeInTheDocument();
      });
    });
  });

  describe('complete state', () => {
    it('shows Continue button in complete state', async () => {
      mockCheckSetup.mockResolvedValue(true);
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Continue')).toBeInTheDocument();
      });
    });

    it('calls onClose when Continue is clicked', async () => {
      const onClose = vi.fn();
      mockCheckSetup.mockResolvedValue(true);
      renderModal({ onClose });

      await waitFor(() => {
        expect(screen.getByText('Continue')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Continue'));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
