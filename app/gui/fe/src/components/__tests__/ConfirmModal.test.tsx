import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ConfirmModal from '../ConfirmModal';
import { ModalProvider } from '../../contexts/ModalContext';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../hooks/useModalStack', () => ({
  useModalStack: (_name: string, isOpen: boolean, _onClose: () => void, _loading?: boolean) => ({
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
  onConfirm: vi.fn(),
  title: 'Delete item?',
  message: 'This action cannot be undone.',
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <ModalProvider>
      <ConfirmModal {...defaultProps} {...overrides} />
    </ModalProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('ConfirmModal', () => {
  describe('rendering', () => {
    it('renders title and message when open', () => {
      renderModal();
      expect(screen.getByText('Delete item?')).toBeInTheDocument();
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByText('Delete item?')).not.toBeInTheDocument();
    });

    it('renders default confirm label "Confirm"', () => {
      renderModal();
      expect(screen.getByText('Confirm')).toBeInTheDocument();
    });

    it('renders custom confirm label', () => {
      render(
        <ModalProvider>
          <ConfirmModal {...defaultProps} confirmLabel="Delete Forever" />
        </ModalProvider>,
      );
      expect(screen.getByText('Delete Forever')).toBeInTheDocument();
    });

    it('renders description when provided', () => {
      render(
        <ModalProvider>
          <ConfirmModal {...defaultProps} description="Additional details about deletion" />
        </ModalProvider>,
      );
      expect(screen.getByText(/Additional details/)).toBeInTheDocument();
    });

    it('has correct accessibility attributes', () => {
      renderModal();
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-modal-title');
    });
  });

  describe('user interactions', () => {
    it('calls onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn();
      renderModal({ onConfirm });
      fireEvent.click(screen.getByText('Confirm'));
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      const backdrop = screen.getByRole('dialog').querySelector('[aria-hidden="true"]');
      fireEvent.click(backdrop!);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('loading state', () => {
    it('disables both buttons when loading', () => {
      render(
        <ModalProvider>
          <ConfirmModal {...defaultProps} loading={true} />
        </ModalProvider>,
      );
      expect(screen.getByText('Cancel')).toBeDisabled();
      expect(screen.getByText('Confirm')).toBeDisabled();
    });

    it('does not close on backdrop click when loading', () => {
      const onClose = vi.fn();
      render(
        <ModalProvider>
          <ConfirmModal {...defaultProps} onClose={onClose} loading={true} />
        </ModalProvider>,
      );
      const backdrop = screen.getByRole('dialog').querySelector('[aria-hidden="true"]');
      fireEvent.click(backdrop!);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('confirm variant', () => {
    it('applies danger styling by default', () => {
      renderModal();
      const confirmBtn = screen.getByText('Confirm');
      expect(confirmBtn.className).toContain('btn-danger');
    });

    it('applies primary styling for default variant', () => {
      render(
        <ModalProvider>
          <ConfirmModal {...defaultProps} confirmVariant="default" />
        </ModalProvider>,
      );
      const confirmBtn = screen.getByText('Confirm');
      expect(confirmBtn.className).toContain('btn-primary');
    });
  });
});
