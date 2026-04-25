import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ReleaseNotesModal from '../ReleaseNotesModal';
import { ModalProvider } from '../../contexts/ModalContext';

vi.mock('../../hooks/useModalStack', () => ({
  useModalStack: (_name: string, isOpen: boolean, _onClose: () => void) => ({
    zIndex: 50,
    shouldRender: isOpen,
    animationState: isOpen ? 'entered' : 'exiting',
    shouldHandleEscape: true,
  }),
}));

vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  version: '0.5.2',
  releaseNotes: '## Added\n- Feature A\n- Feature B\n\n## Fixed\n- Bug X',
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <ModalProvider>
      <ReleaseNotesModal {...defaultProps} {...overrides} />
    </ModalProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReleaseNotesModal', () => {
  it('renders the release notes text preserving whitespace', () => {
    renderModal();
    const text = screen.getByText(/Feature A/);
    expect(text).toBeInTheDocument();
    expect(text.className).toContain('whitespace-pre-wrap');
  });

  it('renders the modal title and version', () => {
    renderModal();
    expect(screen.getByText('Release notes')).toBeInTheDocument();
    expect(screen.getByText('v0.5.2')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText('Release notes')).not.toBeInTheDocument();
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the footer Close button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const backdrop = document.querySelector('[aria-hidden="true"]');
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
