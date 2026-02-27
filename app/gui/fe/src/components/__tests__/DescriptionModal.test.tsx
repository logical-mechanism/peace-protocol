import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import DescriptionModal from '../DescriptionModal';
import { ModalProvider } from '../../contexts/ModalContext';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../hooks/useModalStack', () => ({
  useModalStack: (_name: string, isOpen: boolean, onClose: () => void) => ({
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
  description: 'This is a full listing description with detailed content.',
};

function renderModal(overrides: Partial<typeof defaultProps & { tokenName?: string }> = {}) {
  return render(
    <ModalProvider>
      <DescriptionModal {...defaultProps} {...overrides} />
    </ModalProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('DescriptionModal', () => {
  describe('rendering', () => {
    it('renders description text', () => {
      renderModal();
      expect(screen.getByText('This is a full listing description with detailed content.')).toBeInTheDocument();
    });

    it('renders "Description" heading', () => {
      renderModal();
      expect(screen.getByText('Description')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByText('Description')).not.toBeInTheDocument();
    });

    it('renders tokenName when provided', () => {
      renderModal({ tokenName: 'abcdef1234567890abcdef1234567890' });
      // truncateHex(name, 12, 6) — should show truncated hex
      const tokenEl = screen.getByText(/abcdef/);
      expect(tokenEl).toBeInTheDocument();
    });

    it('does not render tokenName section when not provided', () => {
      renderModal();
      // Only the heading "Description" and the description text should exist
      const container = screen.getByText('Description').closest('div');
      const monospaceEl = container?.querySelector('.font-mono');
      expect(monospaceEl).toBeNull();
    });

    it('preserves whitespace in description text', () => {
      renderModal({ description: 'Line 1\nLine 2\n  Indented' });
      const textEl = screen.getByText(/Line 1/);
      expect(textEl.className).toContain('whitespace-pre-wrap');
    });
  });

  describe('close handlers', () => {
    it('calls onClose when X button is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      const closeBtn = screen.getByLabelText('Close dialog');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when footer Close button is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByText('Close'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      const backdrop = document.querySelector('[aria-hidden="true"]');
      fireEvent.click(backdrop!);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('empty description', () => {
    it('renders with empty string description', () => {
      renderModal({ description: '' });
      expect(screen.getByText('Description')).toBeInTheDocument();
    });
  });
});
