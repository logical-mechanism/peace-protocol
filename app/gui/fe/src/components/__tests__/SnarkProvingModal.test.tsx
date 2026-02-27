import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SnarkProvingModal from '../SnarkProvingModal';
import { ModalProvider } from '../../contexts/ModalContext';
import type { SnarkProofInputs, SnarkProof } from '../../services/snark';

// ── Mocks ───────────────────────────────────────────────────────────

const mockGenerateProof = vi.fn();

vi.mock('../../services/snark', () => ({
  getSnarkProver: () => ({
    generateProof: mockGenerateProof,
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

vi.mock('../InfoTooltip', () => ({
  default: ({ text }: { text: string }) => <span data-testid="info-tooltip" title={text} />,
}));

// ── Fixtures ────────────────────────────────────────────────────────

const mockInputs: SnarkProofInputs = {
  a: 'scalar_a',
  r: 'scalar_r',
  v: 'scalar_v',
  w0: 'scalar_w0',
  w1: 'scalar_w1',
};

const mockProof: SnarkProof = {
  proofJson: '{"pi_a": [], "pi_b": [], "pi_c": []}',
  publicJson: '["1", "2", "3"]',
};

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onProofGenerated: vi.fn(),
  inputs: mockInputs,
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <ModalProvider>
      <SnarkProvingModal {...defaultProps} {...overrides} />
    </ModalProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('SnarkProvingModal', () => {
  describe('rendering', () => {
    it('does not render when isOpen is false', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByText('Generating Proof')).not.toBeInTheDocument();
    });

    it('does not start proving when inputs is null', () => {
      renderModal({ inputs: null });
      expect(mockGenerateProof).not.toHaveBeenCalled();
    });
  });

  describe('proving flow', () => {
    it('shows initializing state when opened with inputs', async () => {
      mockGenerateProof.mockImplementation(() => new Promise(() => {}));
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Initializing prover...')).toBeInTheDocument();
      });
    });

    it('shows "Do not close" warning during proving', async () => {
      mockGenerateProof.mockImplementation((_inputs: SnarkProofInputs, onProgress: (p: { stage: string; message: string }) => void) => {
        onProgress({ stage: 'proving', message: 'Proving...' });
        return new Promise(() => {});
      });
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Do not close the app')).toBeInTheDocument();
      });
    });

    it('shows "Generating zero-knowledge proof" text when proving', async () => {
      mockGenerateProof.mockImplementation((_inputs: SnarkProofInputs, onProgress: (p: { stage: string; message: string }) => void) => {
        onProgress({ stage: 'proving', message: 'Proving...' });
        return new Promise(() => {});
      });
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Generating zero-knowledge proof...')).toBeInTheDocument();
      });
    });

    it('shows success state after proof generated', async () => {
      mockGenerateProof.mockResolvedValue(mockProof);
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Proof Generated!')).toBeInTheDocument();
      });
    });

    it('shows "Proof Generated" in header on success', async () => {
      mockGenerateProof.mockResolvedValue(mockProof);
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Proof Generated')).toBeInTheDocument();
      });
    });

    it('calls onProofGenerated and onClose when Continue is clicked', async () => {
      const onProofGenerated = vi.fn();
      const onClose = vi.fn();
      mockGenerateProof.mockResolvedValue(mockProof);
      renderModal({ onProofGenerated, onClose });

      await waitFor(() => {
        expect(screen.getByText('Continue')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Continue'));
      expect(onProofGenerated).toHaveBeenCalledWith(mockProof);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('error state', () => {
    it('shows classified error for SNARK failures', async () => {
      mockGenerateProof.mockRejectedValue(new Error('SNARK binary crashed'));
      renderModal();

      await waitFor(() => {
        // getFriendlyError classifies "SNARK binary crashed" as Proof Generation Error
        expect(screen.getByText('Proof Generation Error')).toBeInTheDocument();
        expect(screen.getByText('The SNARK prover encountered an error.')).toBeInTheDocument();
      });
    });

    it('shows memory-specific error for OOM failures', async () => {
      mockGenerateProof.mockRejectedValue(new Error('out of memory during computation'));
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Not Enough Memory')).toBeInTheDocument();
        expect(screen.getByText(/Close other applications/)).toBeInTheDocument();
      });
    });

    it('shows setup-specific error for missing files', async () => {
      mockGenerateProof.mockRejectedValue(new Error('setup files not found'));
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('SNARK Setup Files Missing')).toBeInTheDocument();
        expect(screen.getByText(/Settings/)).toBeInTheDocument();
      });
    });

    it('shows Retry and Cancel buttons on error', async () => {
      mockGenerateProof.mockRejectedValue(new Error('SNARK fail'));
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });
    });

    it('retries proof generation on Retry click', async () => {
      mockGenerateProof
        .mockRejectedValueOnce(new Error('SNARK fail'))
        .mockResolvedValueOnce(mockProof);
      renderModal();

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText('Proof Generated!')).toBeInTheDocument();
      });
      expect(mockGenerateProof).toHaveBeenCalledTimes(2);
    });

    it('handles non-Error rejection with fallback message', async () => {
      mockGenerateProof.mockRejectedValue('string error');
      renderModal();

      await waitFor(() => {
        // Raw string falls through to default: title "Something Went Wrong", message is the raw string
        expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
        expect(screen.getByText('string error')).toBeInTheDocument();
      });
    });
  });

  describe('elapsed timer', () => {
    it('shows elapsed time display', async () => {
      mockGenerateProof.mockImplementation((_inputs: SnarkProofInputs, onProgress: (p: { stage: string; message: string }) => void) => {
        onProgress({ stage: 'proving', message: 'Proving...' });
        return new Promise(() => {});
      });
      renderModal();

      await waitFor(() => {
        expect(screen.getByText(/Elapsed:/)).toBeInTheDocument();
      });
    });
  });
});
