import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import DecryptModal from '../DecryptModal';
import { ModalProvider } from '../../contexts/ModalContext';
import type { EncryptionDisplay, BidDisplay } from '../../services/api';

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockDecryptBid = vi.fn();
const mockDecryptEncryption = vi.fn();
vi.mock('../../services/crypto/decrypt', () => ({
  decryptBid: (...args: unknown[]) => mockDecryptBid(...args),
  decryptEncryption: (...args: unknown[]) => mockDecryptEncryption(...args),
  getDecryptionExplanation: () => 'Test decryption explanation text.',
  isStubMode: () => false,
}));

vi.mock('../../services/contentStorage', () => ({
  saveDecryptedContent: vi.fn().mockResolvedValue('/media/content/text/token123/content.txt'),
  saveContentMetadata: vi.fn().mockResolvedValue('/media/content/text/token123/metadata.json'),
}));

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

// Mock WalletContext
const mockWallet = { signData: vi.fn() };
vi.mock('../../contexts/WalletContext', () => ({
  useWalletContext: () => ({ wallet: mockWallet }),
}));

// --- Test data ---

const baseEncryption: EncryptionDisplay = {
  tokenName: 'enc1234567890abcdef1234567890abcd',
  seller: 'addr_test1seller',
  sellerPkh: 'seller123',
  status: 'active',
  createdAt: '2024-06-15T10:00:00Z',
  utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
  datum: {} as EncryptionDisplay['datum'],
  description: 'Encrypted text content',
  suggestedPrice: 50,
  category: 'text',
};

const baseBid: BidDisplay = {
  tokenName: 'bid1234567890abcdef',
  bidder: 'addr_test1bidder',
  bidderPkh: 'bidder456',
  encryptionToken: baseEncryption.tokenName,
  amount: 50_000_000,
  status: 'accepted',
  createdAt: '2024-06-16T12:00:00Z',
  lockedUntil: Date.now() + 12 * 60 * 60 * 1000,
  utxo: { txHash: 'b'.repeat(64), outputIndex: 0 },
  datum: {} as BidDisplay['datum'],
};

const mockOnClose = vi.fn();
const mockOnDecryptResult = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function renderModal(overrides: Partial<Parameters<typeof DecryptModal>[0]> = {}) {
  return render(
    <ModalProvider>
      <DecryptModal
        isOpen={true}
        onClose={mockOnClose}
        bid={baseBid}
        encryption={baseEncryption}
        onDecryptResult={mockOnDecryptResult}
        {...overrides}
      />
    </ModalProvider>,
  );
}

describe('DecryptModal', () => {
  // --- Rendering ---

  it('renders when isOpen is true', () => {
    renderModal();
    expect(screen.getByText('Decrypt Content')).toBeInTheDocument();
    expect(screen.getByText('Decrypt Now')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText('Decrypt Content')).not.toBeInTheDocument();
  });

  it('renders without bid (encryption-only mode)', () => {
    renderModal({ bid: null });
    expect(screen.getByText('Decrypt Content')).toBeInTheDocument();
    expect(screen.getByText('Decrypt Now')).toBeInTheDocument();
  });

  it('renders Decrypt Now even when encryption is null (handler guards against it)', () => {
    renderModal({ encryption: null });
    // Button renders but handleDecrypt returns early if encryption is null
    expect(screen.getByText('Decrypt Now')).toBeInTheDocument();
  });

  // --- Idle state ---

  it('shows encryption description in idle state', () => {
    renderModal();
    expect(screen.getByText('Encrypted text content')).toBeInTheDocument();
  });

  it('shows bid amount in idle state when bid is present', () => {
    renderModal();
    expect(screen.getByText(/50\.00\s+ADA/)).toBeInTheDocument();
    expect(screen.getByText(/Your winning bid/)).toBeInTheDocument();
  });

  it('does not show bid info when bid is null', () => {
    renderModal({ bid: null });
    expect(screen.queryByText(/Your winning bid/)).not.toBeInTheDocument();
  });

  it('shows decryption explanation text', () => {
    renderModal();
    expect(screen.getByText('Test decryption explanation text.')).toBeInTheDocument();
  });

  it('shows security note', () => {
    renderModal();
    expect(screen.getByText('Secure Process')).toBeInTheDocument();
    expect(screen.getByText(/Decryption happens locally/)).toBeInTheDocument();
  });

  it('shows token identifier in header', () => {
    renderModal();
    expect(screen.getByText(/Token:/)).toBeInTheDocument();
  });

  // --- Iagon warning ---

  it('shows Iagon warning when storage is iagon and not connected', () => {
    renderModal({
      encryption: { ...baseEncryption, storageLayer: 'iagon' },
      isIagonConnected: false,
    });
    expect(screen.getByText('Iagon Connection Required')).toBeInTheDocument();
    expect(screen.getByText(/Connect your Iagon account/)).toBeInTheDocument();
  });

  it('shows Go to Settings button that navigates', () => {
    renderModal({
      encryption: { ...baseEncryption, storageLayer: 'iagon' },
      isIagonConnected: false,
    });
    fireEvent.click(screen.getByText('Go to Settings'));
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/settings', { state: { section: 'datalayer' } });
  });

  it('disables Decrypt button when Iagon required but not connected', () => {
    renderModal({
      encryption: { ...baseEncryption, storageLayer: 'iagon' },
      isIagonConnected: false,
    });
    const decryptBtn = screen.getByText('Decrypt Now').closest('button');
    expect(decryptBtn).toBeDisabled();
  });

  it('does not show Iagon warning when connected', () => {
    renderModal({
      encryption: { ...baseEncryption, storageLayer: 'iagon' },
      isIagonConnected: true,
    });
    expect(screen.queryByText('Iagon Connection Required')).not.toBeInTheDocument();
  });

  // --- Decrypting state ---

  it('shows decrypting state with spinner and progress', async () => {
    let resolveDecrypt: (value: unknown) => void;
    mockDecryptBid.mockImplementation((_w: unknown, _b: unknown, _e: unknown, onProgress: (c: number, t: number) => void) => {
      // Simulate progress
      onProgress(1, 3);
      return new Promise((resolve) => { resolveDecrypt = resolve; });
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Decrypting...')).toBeInTheDocument();
    });

    expect(screen.getByText(/Layer 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('Do not close this window')).toBeInTheDocument();

    // Close button should be hidden during decryption
    expect(screen.queryByLabelText('Close dialog')).not.toBeInTheDocument();

    // Resolve to clean up
    resolveDecrypt!({ success: true, message: 'done' });
  });

  it('shows downloading state when phase switches to downloading', async () => {
    let resolveDecrypt: (value: unknown) => void;
    mockDecryptBid.mockImplementation((_w: unknown, _b: unknown, _e: unknown, onProgress: (c: number, t: number, phase?: string) => void) => {
      // Simulate decryption layers completing then switching to download phase
      onProgress(3, 3);
      onProgress(0, 1, 'downloading');
      return new Promise((resolve) => { resolveDecrypt = resolve; });
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Downloading...')).toBeInTheDocument();
    });

    expect(screen.getByText('Downloading file from storage')).toBeInTheDocument();
    expect(screen.getByText('Do not close this window')).toBeInTheDocument();
    // Should not show layer progress
    expect(screen.queryByText(/Layer/)).not.toBeInTheDocument();

    // Resolve to clean up
    resolveDecrypt!({ success: true, message: 'done' });
  });

  // --- Success state (text) ---

  it('shows decrypted text message on success', async () => {
    mockDecryptBid.mockResolvedValue({
      success: true,
      message: 'The secret decrypted content!',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('The secret decrypted content!')).toBeInTheDocument();
    });

    expect(screen.getByText(/Decryption successful/)).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('shows copy button in text success state', async () => {
    mockDecryptBid.mockResolvedValue({
      success: true,
      message: 'Secret text',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });
  });

  it('changes header title to "Decrypted Message" for text on success', async () => {
    mockDecryptBid.mockResolvedValue({
      success: true,
      message: 'Secret text',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Decrypted Message')).toBeInTheDocument();
    });
  });

  // --- Success state (non-text) ---

  it('shows file card for non-text category on success', async () => {
    mockDecryptBid.mockResolvedValue({
      success: true,
      message: 'file-content',
    });

    renderModal({
      encryption: { ...baseEncryption, category: 'document' },
    });
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText(/Document file decrypted/)).toBeInTheDocument();
    });
    expect(screen.getByText('Decrypted Content')).toBeInTheDocument();
  });

  // --- Success callbacks ---

  it('calls onDecryptResult with success on successful decryption', async () => {
    mockDecryptBid.mockResolvedValue({
      success: true,
      message: 'decrypted',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(mockOnDecryptResult).toHaveBeenCalledWith({
        success: true,
        encryptionToken: baseEncryption.tokenName,
      });
    });
  });

  it('shows saved to library indicator', async () => {
    mockDecryptBid.mockResolvedValue({
      success: true,
      message: 'decrypted',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Saved to library')).toBeInTheDocument();
    });
  });

  // --- Success with stub ---

  it('shows stub warning when result isStub is true', async () => {
    mockDecryptBid.mockResolvedValue({
      success: true,
      message: 'stub content',
      isStub: true,
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText(/Showing simulated content/)).toBeInTheDocument();
    });
  });

  // --- Error state ---

  it('shows error state on decryption failure', async () => {
    mockDecryptBid.mockResolvedValue({
      success: false,
      error: 'BLS pairing check failed',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Decryption Failed')).toBeInTheDocument();
      expect(screen.getByText('BLS pairing check failed')).toBeInTheDocument();
    });
  });

  it('calls onDecryptResult with failure on error', async () => {
    mockDecryptBid.mockResolvedValue({
      success: false,
      error: 'Some error',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(mockOnDecryptResult).toHaveBeenCalledWith({
        success: false,
        encryptionToken: baseEncryption.tokenName,
      });
    });
  });

  it('shows error on thrown exception', async () => {
    mockDecryptBid.mockRejectedValue(new Error('Network failure'));

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Decryption Failed')).toBeInTheDocument();
      expect(screen.getByText('Network failure')).toBeInTheDocument();
    });
  });

  it('Try Again button resets to idle state', async () => {
    mockDecryptBid.mockResolvedValue({
      success: false,
      error: 'Failed',
    });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Decryption Failed')).toBeInTheDocument();
    });

    // Click "Try Again" in the error body
    const tryAgainButtons = screen.getAllByText('Try Again');
    fireEvent.click(tryAgainButtons[0]);

    // Should be back in idle state
    expect(screen.getByText('Decrypt Content')).toBeInTheDocument();
    expect(screen.getByText('Decrypt Now')).toBeInTheDocument();
  });

  // --- Close behavior ---

  it('calls onClose when Cancel button is clicked in idle state', () => {
    renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when Done button is clicked in success state', async () => {
    mockDecryptBid.mockResolvedValue({ success: true, message: 'done' });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Done'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when Close button is clicked in error state', async () => {
    mockDecryptBid.mockResolvedValue({ success: false, error: 'err' });

    renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Decryption Failed')).toBeInTheDocument();
    });

    // Footer Close button
    const closeButtons = screen.getAllByRole('button').filter(
      (btn) => btn.textContent?.trim() === 'Close',
    );
    fireEvent.click(closeButtons[0]);
    expect(mockOnClose).toHaveBeenCalled();
  });

  // --- Bid-based vs encryption-based decryption ---

  it('uses decryptBid when bid is provided', async () => {
    mockDecryptBid.mockResolvedValue({ success: true, message: 'from bid' });

    renderModal({ bid: baseBid });
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(mockDecryptBid).toHaveBeenCalled();
      expect(mockDecryptEncryption).not.toHaveBeenCalled();
    });
  });

  it('uses decryptEncryption when bid is null', async () => {
    mockDecryptEncryption.mockResolvedValue({ success: true, message: 'from enc' });

    renderModal({ bid: null });
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(mockDecryptEncryption).toHaveBeenCalled();
      expect(mockDecryptBid).not.toHaveBeenCalled();
    });
  });

  // --- State reset on reopen ---

  it('resets state when modal reopens', async () => {
    mockDecryptBid.mockResolvedValue({ success: false, error: 'Failed' });

    const { rerender } = renderModal();
    fireEvent.click(screen.getByText('Decrypt Now'));

    await waitFor(() => {
      expect(screen.getByText('Decryption Failed')).toBeInTheDocument();
    });

    // Close and reopen
    rerender(
      <ModalProvider>
        <DecryptModal
          isOpen={false}
          onClose={mockOnClose}
          bid={baseBid}
          encryption={baseEncryption}
          onDecryptResult={mockOnDecryptResult}
        />
      </ModalProvider>,
    );

    rerender(
      <ModalProvider>
        <DecryptModal
          isOpen={true}
          onClose={mockOnClose}
          bid={baseBid}
          encryption={baseEncryption}
          onDecryptResult={mockOnDecryptResult}
        />
      </ModalProvider>,
    );

    // Should be back in idle state
    await waitFor(() => {
      expect(screen.getByText('Decrypt Content')).toBeInTheDocument();
      expect(screen.getByText('Decrypt Now')).toBeInTheDocument();
    });
  });
});
