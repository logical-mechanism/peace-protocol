import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PlaceBidModal from '../PlaceBidModal';
import { ModalProvider } from '../../contexts/ModalContext';
import type { EncryptionDisplay } from '../../services/api';

const mockOnClose = vi.fn();
const mockOnSubmit = vi.fn();

const baseEncryption: EncryptionDisplay = {
  tokenName: 'abcdef1234567890abcdef1234567890',
  seller: 'addr_test1qzabcdef1234567890abcdef1234567890abcdef12345678',
  sellerPkh: 'abc123',
  status: 'Open',
  createdAt: '2024-01-01T00:00:00Z',
  utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
  datum: {} as EncryptionDisplay['datum'],
  suggestedPrice: 100,
  description: 'Test encrypted data listing',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSubmit.mockResolvedValue(undefined);
});

function renderModal(overrides: Partial<Parameters<typeof PlaceBidModal>[0]> = {}) {
  return render(
    <ModalProvider>
      <PlaceBidModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        encryption={baseEncryption}
        {...overrides}
      />
    </ModalProvider>
  );
}

describe('PlaceBidModal', () => {
  it('renders when isOpen is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Your Bid Amount/)).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText('Place Bid')).not.toBeInTheDocument();
  });

  it('does not render when encryption is null', () => {
    renderModal({ encryption: null });
    expect(screen.queryByText('Place Bid')).not.toBeInTheDocument();
  });

  it('pre-fills bid amount with suggested price', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    expect(input.value).toBe('100');
  });

  it('shows listing details from encryption', () => {
    renderModal();
    expect(screen.getByText('100 ADA')).toBeInTheDocument();
    expect(screen.getByText('Test encrypted data listing')).toBeInTheDocument();
  });

  it('validates empty bid amount on submit', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText('Bid amount is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('validates non-numeric bid amount', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText('Bid amount must be a positive number')).toBeInTheDocument();
  });

  it('validates bid amount below minimum (2 ADA)', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText(/Minimum bid is 2 ADA/)).toBeInTheDocument();
  });

  it('validates bid amount exceeding maximum', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9999999999' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText('Bid amount is too high')).toBeInTheDocument();
  });

  it('calls onSubmit with correct args on valid submission', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        baseEncryption.tokenName,
        50,
        baseEncryption.utxo,
        100, // futurePrice defaults to suggestedPrice when not shown
      );
    });
  });

  it('shows submit error when onSubmit rejects', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Insufficient funds'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText('Insufficient funds')).toBeInTheDocument();
  });

  it('clears field error when user starts typing', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));
    expect(await screen.findByText('Bid amount is required')).toBeInTheDocument();

    // Start typing — error should clear
    fireEvent.change(input, { target: { value: '5' } });
    expect(screen.queryByText('Bid amount is required')).not.toBeInTheDocument();
  });

  it('Escape key closes the modal when not submitting', () => {
    renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('resets form when reopened', () => {
    const { rerender } = render(
      <ModalProvider>
        <PlaceBidModal
          isOpen={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          encryption={baseEncryption}
        />
      </ModalProvider>
    );

    // Open the modal
    rerender(
      <ModalProvider>
        <PlaceBidModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          encryption={baseEncryption}
        />
      </ModalProvider>
    );

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    expect(input.value).toBe('100'); // Reset to suggestedPrice
  });

  it('close button calls onClose', () => {
    renderModal();

    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  // --- Suggested price hint ---

  it('shows hint when bid is below suggested price', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    expect(screen.getByText(/below the seller's suggested price/)).toBeInTheDocument();
  });

  it('does not show hint when bid equals suggested price', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });
    expect(screen.queryByText(/below the seller's suggested price/)).not.toBeInTheDocument();
  });

  it('does not show hint when bid exceeds suggested price', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '150' } });
    expect(screen.queryByText(/below the seller's suggested price/)).not.toBeInTheDocument();
  });

  it('does not show hint when suggestedPrice is undefined', () => {
    renderModal({ encryption: { ...baseEncryption, suggestedPrice: undefined } });
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(screen.queryByText(/below the seller's suggested price/)).not.toBeInTheDocument();
  });

  // --- Bid count display ---

  it('shows bid count when bidCount > 0', () => {
    renderModal({ bidCount: 5 });
    expect(screen.getByText('5 bids on this listing')).toBeInTheDocument();
  });

  it('shows singular "bid" for count of 1', () => {
    renderModal({ bidCount: 1 });
    expect(screen.getByText('1 bid on this listing')).toBeInTheDocument();
  });

  it('does not show bid count when bidCount is 0', () => {
    renderModal({ bidCount: 0 });
    expect(screen.queryByText(/bids? on this listing/)).not.toBeInTheDocument();
  });

  // --- Wallet balance display ---

  it('shows wallet balance when balanceLovelace is provided', () => {
    renderModal({ balanceLovelace: '1234000000' }); // 1,234 ADA
    expect(screen.getByText(/Balance: 1,234/)).toBeInTheDocument();
  });

  it('does not show balance when balanceLovelace is undefined', () => {
    renderModal({ balanceLovelace: undefined });
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
  });

  it('Max button fills input with balance minus fee reserve', () => {
    renderModal({ balanceLovelace: '100000000' }); // 100 ADA
    fireEvent.click(screen.getByRole('button', { name: 'Max' }));
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    expect(input.value).toBe('95'); // 100 - 5 fee reserve
  });

  it('Max button is disabled when balance is too low', () => {
    renderModal({ balanceLovelace: '3000000' }); // 3 ADA (below 5 ADA reserve)
    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
  });

  it('validates bid exceeding balance', async () => {
    renderModal({ balanceLovelace: '50000000' }); // 50 ADA
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));
    expect(await screen.findByText('Bid exceeds your wallet balance')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  // --- Balance parsing safety ---

  it('hides balance when balanceLovelace is empty string (NaN safety)', () => {
    renderModal({ balanceLovelace: '' });
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
  });

  it('hides balance when balanceLovelace is non-numeric (NaN safety)', () => {
    renderModal({ balanceLovelace: 'abc' });
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
  });
});
