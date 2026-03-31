import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import BidsModal from '../BidsModal';
import { ModalProvider } from '../../contexts/ModalContext';
import type { EncryptionDisplay, BidDisplay } from '../../services/api';

const mockOnClose = vi.fn();
const mockOnAcceptBid = vi.fn();

const baseEncryption: EncryptionDisplay = {
  tokenName: 'abcdef1234567890abcdef1234567890',
  seller: 'addr_test1qzabcdef1234567890abcdef1234567890abcdef12345678',
  sellerPkh: 'abc123def456',
  status: 'active',
  createdAt: '2024-06-15T10:00:00Z',
  utxo: { txHash: 'a'.repeat(64), outputIndex: 0 },
  datum: {} as EncryptionDisplay['datum'],
  suggestedPrice: 100_000_000,
  description: 'Test listing',
};

function makeBid(overrides: Partial<BidDisplay> = {}): BidDisplay {
  return {
    tokenName: 'bid' + Math.random().toString(36).slice(2, 18),
    bidder: 'addr_test1bidder',
    bidderPkh: 'bidder123',
    encryptionToken: baseEncryption.tokenName,
    amount: 50_000_000,
    status: 'pending',
    createdAt: '2024-06-16T12:00:00Z',
    lockedUntil: Date.now() + 12 * 60 * 60 * 1000,
    utxo: { txHash: 'b'.repeat(64), outputIndex: 0 },
    datum: {} as BidDisplay['datum'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

function renderModal(
  overrides: Partial<Parameters<typeof BidsModal>[0]> = {},
  bids: BidDisplay[] = [],
) {
  return render(
    <ModalProvider>
      <BidsModal
        isOpen={true}
        onClose={mockOnClose}
        encryption={baseEncryption}
        bids={bids}
        onAcceptBid={mockOnAcceptBid}
        {...overrides}
      />
    </ModalProvider>,
  );
}

describe('BidsModal', () => {
  it('renders when isOpen is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Bids for Listing')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows truncated encryption token name in header', () => {
    renderModal();
    // truncateHex(tokenName, 12, 6) should show start...end
    const header = screen.getByText(/abcdef123456/);
    expect(header).toBeInTheDocument();
  });

  it('shows suggested price from encryption', () => {
    renderModal();
    expect(screen.getByText('100.00 ADA')).toBeInTheDocument();
  });

  it('shows "No price set" when no suggested price', () => {
    renderModal({ encryption: { ...baseEncryption, suggestedPrice: undefined } });
    expect(screen.getByText('No price set')).toBeInTheDocument();
  });

  it('shows total bids count and pending count', () => {
    const bids = [
      makeBid({ status: 'pending' }),
      makeBid({ status: 'accepted' }),
    ];
    renderModal({}, bids);
    expect(screen.getByText('2 (1 pending)')).toBeInTheDocument();
  });

  it('shows empty state when no bids', () => {
    renderModal({}, []);
    expect(screen.getByText('No bids yet')).toBeInTheDocument();
  });

  it('renders pending bids section with count', () => {
    const bids = [
      makeBid({ status: 'pending', tokenName: 'pendingbid1' }),
      makeBid({ status: 'pending', tokenName: 'pendingbid2' }),
    ];
    renderModal({}, bids);
    expect(screen.getByText('Pending Bids (2)')).toBeInTheDocument();
  });

  it('renders past bids section with count', () => {
    const bids = [
      makeBid({ status: 'accepted', tokenName: 'acceptedbid1' }),
      makeBid({ status: 'cancelled', tokenName: 'cancelledbid1' }),
    ];
    renderModal({}, bids);
    expect(screen.getByText('Past Bids (2)')).toBeInTheDocument();
  });

  it('sorts pending bids first, then by amount descending', () => {
    const bids = [
      makeBid({ status: 'accepted', amount: 100_000_000, tokenName: 'acc100' }),
      makeBid({ status: 'pending', amount: 20_000_000, tokenName: 'pend20' }),
      makeBid({ status: 'pending', amount: 80_000_000, tokenName: 'pend80' }),
    ];
    renderModal({}, bids);

    // Pending section should exist and show highest pending first
    const pendingSection = screen.getByText('Pending Bids (2)').closest('div')!;
    const amounts = within(pendingSection).getAllByText(/ADA$/);
    // First pending bid (80 ADA) should appear before second (20 ADA)
    expect(amounts[0].textContent).toContain('80');
    expect(amounts[1].textContent).toContain('20');
  });

  it('shows Accept Bid button for pending bids when encryption is active', () => {
    const bids = [makeBid({ status: 'pending' })];
    renderModal({ encryption: { ...baseEncryption, status: 'active' } }, bids);
    expect(screen.getByRole('button', { name: /Accept Bid/ })).toBeInTheDocument();
  });

  it('hides Accept Bid button when encryption is pending', () => {
    const bids = [makeBid({ status: 'pending' })];
    renderModal({ encryption: { ...baseEncryption, status: 'pending' } }, bids);
    expect(screen.queryByRole('button', { name: /Accept Bid/ })).not.toBeInTheDocument();
  });

  it('hides Accept Bid button when encryption is completed', () => {
    const bids = [makeBid({ status: 'pending' })];
    renderModal({ encryption: { ...baseEncryption, status: 'completed' } }, bids);
    expect(screen.queryByRole('button', { name: /Accept Bid/ })).not.toBeInTheDocument();
  });

  it('hides Accept Bid button when onAcceptBid is not provided', () => {
    const bids = [makeBid({ status: 'pending' })];
    renderModal({ onAcceptBid: undefined }, bids);
    expect(screen.queryByRole('button', { name: /Accept Bid/ })).not.toBeInTheDocument();
  });

  it('calls onAcceptBid with the correct bid when Accept Bid is clicked', () => {
    const bid = makeBid({ status: 'pending', tokenName: 'mybid123456789012' });
    renderModal({}, [bid]);

    fireEvent.click(screen.getByRole('button', { name: /Accept Bid/ }));
    expect(mockOnAcceptBid).toHaveBeenCalledWith(bid);
  });

  it('shows bid status badges', () => {
    const bids = [
      makeBid({ status: 'pending', tokenName: 'pendingbid' }),
      makeBid({ status: 'accepted', tokenName: 'acceptedbid' }),
    ];
    renderModal({}, bids);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when footer Close button is clicked', () => {
    renderModal();
    // Footer close button
    const closeButtons = screen.getAllByRole('button', { name: /Close/i });
    const footerClose = closeButtons[closeButtons.length - 1];
    fireEvent.click(footerClose);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows pending sale warning when encryption status is pending', () => {
    renderModal({ encryption: { ...baseEncryption, status: 'pending' } });
    expect(screen.getByText(/Cannot accept new bids while a sale is pending/)).toBeInTheDocument();
  });

  it('shows sold message when encryption status is completed', () => {
    renderModal({ encryption: { ...baseEncryption, status: 'completed' } });
    expect(screen.getByText(/This listing has been sold/)).toBeInTheDocument();
  });

  it('does not show status messages when encryption is active', () => {
    renderModal({ encryption: { ...baseEncryption, status: 'active' } });
    expect(screen.queryByText(/Cannot accept new bids/)).not.toBeInTheDocument();
    expect(screen.queryByText(/This listing has been sold/)).not.toBeInTheDocument();
  });

  it('formats lovelace amounts as ADA with proper decimals', () => {
    const bids = [makeBid({ amount: 1_500_000 })]; // 1.5 ADA
    renderModal({}, bids);
    expect(screen.getByText(/1\.50 ADA/)).toBeInTheDocument();
  });

  it('shows bid creation date', () => {
    const bids = [makeBid({ createdAt: '2024-06-16T12:00:00Z' })];
    renderModal({}, bids);
    // "Placed" prefix before the date
    expect(screen.getByText(/Placed/)).toBeInTheDocument();
  });
});
