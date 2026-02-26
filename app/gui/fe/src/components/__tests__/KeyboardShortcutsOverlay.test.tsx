import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import KeyboardShortcutsOverlay from '../KeyboardShortcutsOverlay';

describe('KeyboardShortcutsOverlay', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <KeyboardShortcutsOverlay isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders shortcut table when open', () => {
    render(<KeyboardShortcutsOverlay isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Switch dashboard tab')).toBeInTheDocument();
    expect(screen.getByText('Refresh data')).toBeInTheDocument();
    expect(screen.getByText('Navigate tabs (when focused)')).toBeInTheDocument();
    expect(screen.getByText('Close modal or overlay')).toBeInTheDocument();
    expect(screen.getByText('Toggle this help')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when ? is pressed (toggle off)', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(document, { key: '?' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsOverlay isOpen={true} onClose={onClose} />);

    // The backdrop has aria-hidden="true"
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has proper dialog accessibility attributes', () => {
    render(<KeyboardShortcutsOverlay isOpen={true} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'shortcuts-title');
  });

  it('has close button with aria-label', () => {
    render(<KeyboardShortcutsOverlay isOpen={true} onClose={vi.fn()} />);

    const closeBtn = screen.getByLabelText('Close dialog');
    expect(closeBtn).toBeInTheDocument();
  });
});
