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
  sellerPkh: 'abc123',
  status: 'active',
  createdAt: '2024-01-01T00:00:00Z',
  utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
  datum: {} as EncryptionDisplay['datum'],
  suggestedPrice: 100_000_000,
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
    expect(screen.getByText('100.00 ADA')).toBeInTheDocument();
    expect(screen.getByText('Test encrypted data listing')).toBeInTheDocument();
  });

  it('shows full token name on hover via title attribute', () => {
    renderModal();
    const tokenSpan = screen.getByTitle(baseEncryption.tokenName);
    expect(tokenSpan).toBeInTheDocument();
  });

  it('shows full seller pkh on hover via title attribute', () => {
    renderModal();
    const sellerSpan = screen.getByTitle(baseEncryption.sellerPkh);
    expect(sellerSpan).toBeInTheDocument();
  });

  it('validates empty bid amount on submit', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText('Bid amount is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('rejects non-numeric input via input filter and keeps the prior valid value', () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    // type=text means HTML no longer strips letters for us; the onChange filter
    // refuses to update state. After re-render, the controlled value snaps
    // back to the suggested-price prefill ("100").
    fireEvent.change(input, { target: { value: 'abc' } });
    // Force a re-render via a benign state update so React reasserts the
    // controlled value.
    fireEvent.focus(input);
    expect(input.value).toBe('100');
  });

  it('validates bid amount below minimum (2 ADA)', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText(/Minimum bid is 2 ADA/)).toBeInTheDocument();
  });

  it('clamps bid amount to Cardano max supply (45B ADA)', async () => {
    renderModal();

    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99999999999' } });

    expect(input.value).toBe('45000000000');
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

  it('shows structured error with title and message when onSubmit rejects', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Insufficient funds'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    // getFriendlyError maps "Insufficient funds" to the Insufficient Balance pattern
    expect(await screen.findByText('Insufficient Balance')).toBeInTheDocument();
    expect(screen.getByText('Your wallet does not have enough ADA for this transaction.')).toBeInTheDocument();
  });

  it('shows action guidance on submit error', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Insufficient funds'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText('Insufficient Balance')).toBeInTheDocument();
    expect(screen.getByText('Add more ADA to your wallet and try again.')).toBeInTheDocument();
  });

  it('shows fallback error for unrecognized errors', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Something completely unexpected'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));

    expect(await screen.findByText('Something Went Wrong')).toBeInTheDocument();
    expect(screen.getByText('Something completely unexpected')).toBeInTheDocument();
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

  it('shows "Balance: loading..." when balanceLovelace is undefined', () => {
    renderModal({ balanceLovelace: undefined });
    expect(screen.getByText('Balance: loading...')).toBeInTheDocument();
    expect(screen.queryByText(/Balance: \d/)).not.toBeInTheDocument();
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

  it('shows loading when balanceLovelace is empty string (NaN safety)', () => {
    renderModal({ balanceLovelace: '' });
    expect(screen.getByText('Balance: loading...')).toBeInTheDocument();
  });

  it('shows loading when balanceLovelace is non-numeric (NaN safety)', () => {
    renderModal({ balanceLovelace: 'abc' });
    expect(screen.getByText('Balance: loading...')).toBeInTheDocument();
  });

  // --- Min bid constraint hint ---

  it('shows minimum bid hint before user interacts with input', () => {
    renderModal();
    expect(screen.getByText(/Minimum bid: 2 ADA/)).toBeInTheDocument();
  });

  // --- Blur validation ---

  it('validates bid amount on blur when value is invalid', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.blur(input);
    expect(screen.getByText(/Minimum bid is 2 ADA/)).toBeInTheDocument();
  });

  it('does not show error on blur when input is empty (untouched)', () => {
    renderModal({ encryption: { ...baseEncryption, suggestedPrice: undefined } });
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    // Input starts empty when no suggested price, blur without typing
    fireEvent.blur(input);
    expect(screen.queryByText('Bid amount is required')).not.toBeInTheDocument();
  });

  it('shows balance-exceeded error on blur', () => {
    renderModal({ balanceLovelace: '10000000' }); // 10 ADA
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);
    expect(screen.getByText('Bid exceeds your wallet balance')).toBeInTheDocument();
  });

  // --- HTML input attributes (type=text + inputMode=decimal so we can render
  // thousands-separator commas at rest, which type=number forbids) ---

  it('uses type="text" so the input can render thousands-separator commas at rest', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    expect(input.type).toBe('text');
  });

  it('has inputMode decimal for mobile keyboard hints', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  // --- Future price "(optional)" label ---

  it('shows "(optional)" in the future price section when expanded', () => {
    renderModal();
    // Expand the future price section
    fireEvent.click(screen.getByRole('button', { name: /Set Future Listing Price/i }));
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  // --- Future price input attributes ---

  it('uses type="text" for future price input so it can render commas at rest', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Set Future Listing Price/i }));
    const input = document.getElementById('futurePrice') as HTMLInputElement;
    expect(input.type).toBe('text');
  });

  it('has inputMode decimal on future price input', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Set Future Listing Price/i }));
    const input = document.getElementById('futurePrice') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  // --- Thousands-separator format-on-blur (D16) ---

  it('formats the bid amount with thousands separators on blur', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1000000' } });
    expect(input.value).toBe('1000000'); // raw while typing/focused
    fireEvent.blur(input);
    expect(input.value).toBe('1,000,000'); // formatted at rest
  });

  it('reverts the bid amount to a comma-free raw string on focus', () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1000000' } });
    fireEvent.blur(input);
    expect(input.value).toBe('1,000,000');
    fireEvent.focus(input);
    expect(input.value).toBe('1000000');
  });

  it('strips commas before submitting so onSubmit receives a numeric ADA value', async () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1000000' } });
    fireEvent.blur(input);
    expect(input.value).toBe('1,000,000');

    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        baseEncryption.tokenName,
        1_000_000,
        baseEncryption.utxo,
        100, // futurePrice defaults to suggestedPrice when section not opened
      );
    });
  });

  // --- Minimum bid InfoTooltip ---

  it('shows minimum bid explanation via InfoTooltip instead of title attribute', () => {
    renderModal();
    // The "Why 2 ADA minimum?" text should be visible
    expect(screen.getByText(/Why 2 ADA minimum\?/)).toBeInTheDocument();
    // The InfoTooltip button should be present near the hint
    const hintArea = screen.getByText(/Why 2 ADA minimum\?/).closest('p');
    expect(hintArea).toBeInTheDocument();
    // Should contain an info tooltip button (the (i) icon)
    const tooltipButton = hintArea!.querySelector('button');
    expect(tooltipButton).toBeInTheDocument();
  });

  // --- Simplified error message ---

  it('shows simplified minimum bid error without technical explanation', async () => {
    renderModal();
    const input = screen.getByLabelText(/Your Bid Amount/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));
    const error = await screen.findByText(/Minimum bid is 2 ADA/);
    expect(error.textContent).toBe('Minimum bid is 2 ADA');
  });

  // --- Tutorial target IDs ---

  it('exposes tutorial-bid-amount id on the bid amount section', () => {
    renderModal();
    const amountSection = document.querySelector('#tutorial-bid-amount');
    expect(amountSection).not.toBeNull();
  });

  it('exposes tutorial-future-price id on the future price section', () => {
    renderModal();
    const futureSection = document.querySelector('#tutorial-future-price');
    expect(futureSection).not.toBeNull();
  });

  it('exposes tutorial-submit-bid id on the submit button', () => {
    renderModal();
    const submit = document.querySelector('#tutorial-submit-bid');
    expect(submit).not.toBeNull();
  });
});
