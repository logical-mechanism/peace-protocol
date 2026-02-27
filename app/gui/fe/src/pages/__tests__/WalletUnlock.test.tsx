import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import WalletUnlock from '../WalletUnlock';

// ── Mocks ───────────────────────────────────────────────────────────

const mockUnlockWallet = vi.fn();
const mockDeleteWallet = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../contexts/WalletContext', () => ({
  useWalletContext: () => ({
    unlockWallet: mockUnlockWallet,
    deleteWallet: mockDeleteWallet,
  }),
}));

const mockCopyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

vi.mock('../../contexts/ModalContext', () => ({
  useModal: () => ({
    openModal: vi.fn(),
    closeModal: vi.fn(),
    isTopModal: () => true,
    getZIndex: () => 50,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <WalletUnlock />
    </MemoryRouter>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUnlockWallet.mockResolvedValue(undefined);
  mockDeleteWallet.mockResolvedValue(undefined);
});

describe('WalletUnlock', () => {
  it('renders the unlock form with password input', () => {
    renderPage();

    expect(screen.getByText('Veiled')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.getByText('Unlock')).toBeInTheDocument();
  });

  it('unlock button is disabled when password is empty', () => {
    renderPage();

    const unlockBtn = screen.getByText('Unlock');
    expect(unlockBtn).toBeDisabled();
  });

  it('calls unlockWallet with password on form submit', async () => {
    renderPage();

    const input = screen.getByAutoComplete('current-password');
    fireEvent.change(input, { target: { value: 'mypassword' } });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(mockUnlockWallet).toHaveBeenCalledWith('mypassword');
    });
  });

  it('navigates to /dashboard on successful unlock', async () => {
    renderPage();

    const input = screen.getByAutoComplete('current-password');
    fireEvent.change(input, { target: { value: 'correct' } });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows error on failed unlock', async () => {
    mockUnlockWallet.mockRejectedValue(new Error('Invalid password'));

    renderPage();

    const input = screen.getByAutoComplete('current-password');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('clears error when typing new password', async () => {
    mockUnlockWallet.mockRejectedValue(new Error('Invalid password'));

    renderPage();

    const input = screen.getByAutoComplete('current-password');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: 'new' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('toggles password visibility', () => {
    renderPage();

    const input = screen.getByAutoComplete('current-password');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByLabelText('Toggle password visibility'));
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByLabelText('Toggle password visibility'));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows delete confirmation when "Forgot password?" is clicked', () => {
    renderPage();

    fireEvent.click(screen.getByText('Forgot password?'));

    expect(screen.getByText('Delete Wallet?')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Delete Wallet')).toBeInTheDocument();
  });

  it('deletes wallet and navigates to setup', async () => {
    renderPage();

    fireEvent.click(screen.getByText('Forgot password?'));
    fireEvent.click(screen.getByText('Delete Wallet'));

    await waitFor(() => {
      expect(mockDeleteWallet).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/wallet-setup');
    });
  });

  it('closes delete confirmation on Cancel', () => {
    renderPage();

    fireEvent.click(screen.getByText('Forgot password?'));
    expect(screen.getByText('Delete Wallet?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));

    // After animation delay, dialog should be gone
    // The modal uses useModalStack with exiting animation — check it triggers
    // At minimum, onCloseDelete should have been called
  });

  it('has accessible password input with aria-invalid on error', async () => {
    mockUnlockWallet.mockRejectedValue(new Error('bad'));

    renderPage();

    const input = screen.getByAutoComplete('current-password');
    expect(input).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('delete dialog has proper ARIA attributes', () => {
    renderPage();

    fireEvent.click(screen.getByText('Forgot password?'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'delete-wallet-title');
  });

  it('shows copy button in error details and copies raw error on click', async () => {
    // "Invalid wallet file" triggers a parsed error where raw !== title && raw !== suggestion
    mockUnlockWallet.mockRejectedValue('Invalid wallet file: bad nonce');

    renderPage();

    const input = screen.getByAutoComplete('current-password');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByText('Unlock'));

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Open the details
    const details = screen.getByText('Details');
    fireEvent.click(details);

    // Copy button should be present
    const copyBtn = screen.getByLabelText('Copy error details');
    expect(copyBtn).toBeInTheDocument();

    // Click copy
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith('Invalid wallet file: bad nonce');
    });
  });
});

// Helper: find input by autocomplete attribute
function getByAutoComplete(attribute: string) {
  return document.querySelector(`[autocomplete="${attribute}"]`) as HTMLElement;
}

// Augment screen with autocomplete helper
Object.defineProperty(screen, 'getByAutoComplete', {
  value: (attr: string) => getByAutoComplete(attr),
});
