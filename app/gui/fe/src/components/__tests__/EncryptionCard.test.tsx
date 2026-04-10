import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EncryptionCard from '../EncryptionCard';
import { createEncryption } from '../../test/factories';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../Badge', () => ({
  EncryptionStatusBadge: ({ status }: { status: string }) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

vi.mock('../DescriptionModal', () => ({
  default: ({ isOpen, description }: { isOpen: boolean; description: string }) =>
    isOpen ? <div data-testid="description-modal">{description}</div> : null,
}));

vi.mock('../ListingImage', () => ({
  default: ({ tokenName }: { tokenName: string }) => (
    <div data-testid="listing-image">{tokenName}</div>
  ),
}));

vi.mock('../HighlightText', () => ({
  default: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../descriptionUtils', () => ({
  truncateDescription: (d: string) => d,
}));

vi.mock('../../utils/truncate', () => ({
  truncateHex: (s: string) => s.slice(0, 8) + '...',
}));

vi.mock('../../utils/formatDate', () => ({
  formatDate: () => '2 days ago',
}));

const mockCopyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function renderCard(
  overrides: Parameters<typeof createEncryption>[0] = {},
  props: {
    onPlaceBid?: (encryption: unknown, bidCount: number) => void;
    isOwnListing?: boolean;
    hasBid?: boolean;
    compact?: boolean;
    bidCount?: number;
    lovelace?: string | null;
    isFavorite?: boolean;
    onToggleFavorite?: (tokenName: string) => void;
    onFilterBySeller?: (sellerPkh: string) => void;
    onFilterByCategory?: (category: string) => void;
    searchQuery?: string;
  } = {},
) {
  const encryption = createEncryption(overrides);
  return render(
    <EncryptionCard
      encryption={encryption}
      onPlaceBid={props.onPlaceBid}
      isOwnListing={props.isOwnListing}
      hasBid={props.hasBid}
      compact={props.compact}
      bidCount={props.bidCount}
      lovelace={props.lovelace}
      isFavorite={props.isFavorite}
      onToggleFavorite={props.onToggleFavorite}
      onFilterBySeller={props.onFilterBySeller}
      onFilterByCategory={props.onFilterByCategory}
      searchQuery={props.searchQuery}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('EncryptionCard', () => {
  describe('rendering', () => {
    it('renders token name', () => {
      renderCard({ tokenName: 'abc123ff' });
      expect(screen.getAllByText(/abc123ff/).length).toBeGreaterThanOrEqual(1);
    });

    it('renders status badge', () => {
      renderCard({ status: 'active' });
      expect(screen.getByTestId('status-badge')).toHaveTextContent('active');
    });

    it('renders suggested price', () => {
      renderCard({ suggestedPrice: 100_000_000 });
      expect(screen.getByText('100.00 ADA')).toBeInTheDocument();
    });

    it('renders "No suggested price" when price is undefined', () => {
      renderCard({ suggestedPrice: undefined });
      expect(screen.getByText('No suggested price')).toBeInTheDocument();
    });

    it('renders "No suggested price" for negative price', () => {
      renderCard({ suggestedPrice: -5 });
      expect(screen.getByText('No suggested price')).toBeInTheDocument();
    });

    it('renders description', () => {
      renderCard({ description: 'A test listing' });
      expect(screen.getByText('A test listing')).toBeInTheDocument();
    });

    it('renders category label', () => {
      renderCard({ category: 'document' });
      expect(screen.getByText('Document')).toBeInTheDocument();
    });

    it('defaults category to Text when not provided', () => {
      renderCard({ category: undefined });
      expect(screen.getByText('Text')).toBeInTheDocument();
    });

    it('renders listing image in standard mode', () => {
      renderCard({ tokenName: 'img123' });
      expect(screen.getByTestId('listing-image')).toBeInTheDocument();
    });

    it('renders seller info', () => {
      renderCard();
      expect(screen.getByText('Seller')).toBeInTheDocument();
    });

    it('renders "Listed" date', () => {
      renderCard();
      expect(screen.getByText('Listed 2 days ago')).toBeInTheDocument();
    });
  });

  describe('bid count', () => {
    it('renders bid count badge when > 0', () => {
      renderCard({ status: 'active' }, { bidCount: 3 });
      expect(screen.getByText('3 bids')).toBeInTheDocument();
    });

    it('shows singular "bid" for count of 1', () => {
      renderCard({ status: 'active' }, { bidCount: 1 });
      expect(screen.getByText('1 bid')).toBeInTheDocument();
    });

    it('shows "0 bids" when count is 0', () => {
      renderCard({ status: 'active' }, { bidCount: 0 });
      expect(screen.getByText('0 bids')).toBeInTheDocument();
    });
  });

  describe('bid button', () => {
    it('shows Place Bid when canBid and has onPlaceBid', () => {
      renderCard(
        { status: 'active' },
        { onPlaceBid: vi.fn(), lovelace: '5000000' },
      );
      expect(screen.getByText('Place Bid')).toBeInTheDocument();
    });

    it('calls onPlaceBid when clicked', () => {
      const onPlaceBid = vi.fn();
      renderCard(
        { status: 'active' },
        { onPlaceBid, lovelace: '5000000', bidCount: 2 },
      );
      fireEvent.click(screen.getByText('Place Bid'));
      expect(onPlaceBid).toHaveBeenCalledOnce();
      // Should pass encryption object and bidCount
      expect(onPlaceBid.mock.calls[0][1]).toBe(2);
    });

    it('disables bid button when lovelace is null (low balance)', () => {
      renderCard(
        { status: 'active' },
        { onPlaceBid: vi.fn(), lovelace: null },
      );
      expect(screen.getByText('Insufficient Balance')).toBeInTheDocument();
    });

    it('disables bid button when balance < 2 ADA', () => {
      renderCard(
        { status: 'active' },
        { onPlaceBid: vi.fn(), lovelace: '1000000' },
      );
      expect(screen.getByText('Insufficient Balance')).toBeInTheDocument();
    });

    it('shows insufficient balance message', () => {
      renderCard(
        { status: 'active' },
        { onPlaceBid: vi.fn(), lovelace: null },
      );
      expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
    });

    it('does not show bid button for own listing', () => {
      renderCard(
        { status: 'active' },
        { onPlaceBid: vi.fn(), isOwnListing: true },
      );
      expect(screen.queryByText('Place Bid')).not.toBeInTheDocument();
    });

    it('does not show bid button when hasBid', () => {
      renderCard(
        { status: 'active' },
        { onPlaceBid: vi.fn(), hasBid: true },
      );
      expect(screen.queryByText('Place Bid')).not.toBeInTheDocument();
    });

    it('does not call onPlaceBid when disabled', () => {
      const onPlaceBid = vi.fn();
      renderCard(
        { status: 'active' },
        { onPlaceBid, lovelace: null },
      );
      fireEvent.click(screen.getByText('Insufficient Balance'));
      expect(onPlaceBid).not.toHaveBeenCalled();
    });
  });

  describe('own listing', () => {
    it('shows "This is your listing" message', () => {
      renderCard({ status: 'active' }, { isOwnListing: true });
      expect(screen.getByText('This is your listing')).toBeInTheDocument();
    });
  });

  describe('bid placed', () => {
    it('shows "You have a bid on this listing" for active with hasBid', () => {
      renderCard({ status: 'active' }, { hasBid: true });
      expect(screen.getByText('You have a bid on this listing')).toBeInTheDocument();
    });
  });

  describe('status messages', () => {
    it('shows "Sale in progress" for pending status', () => {
      renderCard({ status: 'pending' });
      expect(screen.getByText('Sale in progress')).toBeInTheDocument();
    });

    it('shows "Sale completed" for completed status', () => {
      renderCard({ status: 'completed' });
      expect(screen.getByText('Sale completed')).toBeInTheDocument();
    });
  });

  describe('copy seller address', () => {
    it('calls copyToClipboard with seller pkh', async () => {
      renderCard({ sellerPkh: 'abc123' });
      const copyButton = screen.getByTitle('Copy seller address');
      await act(async () => {
        fireEvent.click(copyButton);
      });
      expect(mockCopyToClipboard).toHaveBeenCalledWith('abc123');
    });
  });

  describe('favorite toggle', () => {
    it('calls onToggleFavorite with token name', () => {
      const onToggleFavorite = vi.fn();
      renderCard({ tokenName: 'fav123' }, { onToggleFavorite });
      const favButton = screen.getByTitle('Add to favorites');
      fireEvent.click(favButton);
      expect(onToggleFavorite).toHaveBeenCalledWith('fav123');
    });

    it('shows "Remove from favorites" when isFavorite', () => {
      renderCard({}, { onToggleFavorite: vi.fn(), isFavorite: true });
      expect(screen.getByTitle('Remove from favorites')).toBeInTheDocument();
    });

    it('does not render favorite button without onToggleFavorite', () => {
      renderCard();
      expect(screen.queryByTitle('Add to favorites')).not.toBeInTheDocument();
    });
  });

  describe('description modal', () => {
    it('opens description modal on description click', () => {
      renderCard({ description: 'Click me' });
      fireEvent.click(screen.getByText('Click me'));
      expect(screen.getByTestId('description-modal')).toBeInTheDocument();
    });
  });

  describe('filter by seller', () => {
    it('calls onFilterBySeller with seller pkh when address clicked', () => {
      const onFilterBySeller = vi.fn();
      renderCard({ sellerPkh: 'seller99' }, { onFilterBySeller });
      const sellerButton = screen.getByLabelText('Filter by this seller');
      fireEvent.click(sellerButton);
      expect(onFilterBySeller).toHaveBeenCalledWith('seller99');
    });

    it('does not render seller as button when onFilterBySeller is absent', () => {
      renderCard({ sellerPkh: 'seller99' });
      expect(screen.queryByLabelText('Filter by this seller')).not.toBeInTheDocument();
    });

    it('copy button still works independently of seller filter button', async () => {
      renderCard(
        { sellerPkh: 'seller99' },
        { onFilterBySeller: vi.fn() },
      );
      const copyButton = screen.getByTitle('Copy seller address');
      await act(async () => {
        fireEvent.click(copyButton);
      });
      expect(mockCopyToClipboard).toHaveBeenCalledWith('seller99');
    });
  });

  describe('filter by category', () => {
    it('calls onFilterByCategory with category when badge clicked (grid mode)', () => {
      const onFilterByCategory = vi.fn();
      renderCard({ category: 'audio' }, { onFilterByCategory });
      const categoryButton = screen.getByLabelText('Filter by category Audio');
      fireEvent.click(categoryButton);
      expect(onFilterByCategory).toHaveBeenCalledWith('audio');
    });

    it('defaults missing category to text when filtered', () => {
      const onFilterByCategory = vi.fn();
      renderCard({ category: undefined }, { onFilterByCategory });
      const categoryButton = screen.getByLabelText('Filter by category Text');
      fireEvent.click(categoryButton);
      expect(onFilterByCategory).toHaveBeenCalledWith('text');
    });

    it('calls onFilterByCategory in compact mode', () => {
      const onFilterByCategory = vi.fn();
      renderCard(
        { category: 'video' },
        { compact: true, onFilterByCategory },
      );
      const categoryButton = screen.getByLabelText('Filter by category Video');
      fireEvent.click(categoryButton);
      expect(onFilterByCategory).toHaveBeenCalledWith('video');
    });

    it('does not render category as button when onFilterByCategory is absent', () => {
      renderCard({ category: 'audio' });
      expect(screen.queryByLabelText('Filter by category Audio')).not.toBeInTheDocument();
    });
  });

  describe('compact variant', () => {
    it('renders compact bid button', () => {
      renderCard(
        { status: 'active' },
        { compact: true, onPlaceBid: vi.fn(), lovelace: '5000000' },
      );
      expect(screen.getByText('Bid')).toBeInTheDocument();
    });

    it('shows Bid Placed in compact when hasBid', () => {
      renderCard(
        { status: 'active' },
        { compact: true, hasBid: true },
      );
      expect(screen.getByText('Bid Placed')).toBeInTheDocument();
    });

    it('does not render listing image in compact mode', () => {
      renderCard({}, { compact: true });
      expect(screen.queryByTestId('listing-image')).not.toBeInTheDocument();
    });

    it('does not render bid count in compact mode', () => {
      renderCard({ status: 'active' }, { compact: true, bidCount: 5 });
      expect(screen.queryByText('5')).not.toBeInTheDocument();
    });
  });
});
