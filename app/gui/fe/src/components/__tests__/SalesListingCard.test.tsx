import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SalesListingCard from '../SalesListingCard';
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

vi.mock('../descriptionUtils', () => ({
  truncateDescription: (d: string) => d,
}));

vi.mock('../../utils/truncate', () => ({
  truncateHex: (s: string) => s.slice(0, 8) + '...',
}));

vi.mock('../../utils/time', () => ({
  formatRelativeTime: () => '2 days ago',
}));

// ── Helpers ─────────────────────────────────────────────────────────

function renderCard(
  overrides: Parameters<typeof createEncryption>[0] = {},
  props: {
    bidCount?: number;
    onViewBids?: () => void;
    onRemove?: () => void;
    onCancelPending?: () => void;
    onCompleteSale?: () => void;
    compact?: boolean;
  } = {},
) {
  const encryption = createEncryption(overrides);
  return render(
    <SalesListingCard
      encryption={encryption}
      bidCount={props.bidCount ?? 0}
      onViewBids={props.onViewBids}
      onRemove={props.onRemove}
      onCancelPending={props.onCancelPending}
      onCompleteSale={props.onCompleteSale}
      compact={props.compact}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('SalesListingCard', () => {
  describe('rendering', () => {
    it('renders token name', () => {
      renderCard({ tokenName: 'abc123ff' });
      // Token name appears in both the card text and the ListingImage mock
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

    it('renders fallback price when undefined', () => {
      renderCard({ suggestedPrice: undefined });
      expect(screen.getByText('No suggested price')).toBeInTheDocument();
    });

    it('renders description', () => {
      renderCard({ description: 'A test listing' });
      expect(screen.getByText('A test listing')).toBeInTheDocument();
    });

    it('renders category badge in compact mode', () => {
      renderCard({ category: 'document' }, { compact: true });
      expect(screen.getByText('Document')).toBeInTheDocument();
    });

    it('defaults category to Text when not provided (compact)', () => {
      renderCard({ category: undefined }, { compact: true });
      expect(screen.getByText('Text')).toBeInTheDocument();
    });

    it('renders listing image', () => {
      renderCard({ tokenName: 'img123' });
      expect(screen.getByTestId('listing-image')).toBeInTheDocument();
    });
  });

  describe('storage layer', () => {
    it('shows On-chain for on-chain storage', () => {
      renderCard({ storageLayer: 'on-chain' });
      expect(screen.getByText('On-chain')).toBeInTheDocument();
    });

    it('shows Iagon for iagon storage', () => {
      renderCard({ storageLayer: 'iagon' });
      expect(screen.getByText('Iagon')).toBeInTheDocument();
    });

    it('shows No data layer when missing', () => {
      renderCard({ storageLayer: undefined });
      expect(screen.getByText('No data layer')).toBeInTheDocument();
    });
  });

  describe('active status', () => {
    it('shows View Bids button', () => {
      renderCard({ status: 'active' }, { bidCount: 3, onViewBids: vi.fn() });
      expect(screen.getByText('View Bids')).toBeInTheDocument();
    });

    it('shows Remove Listing button', () => {
      renderCard({ status: 'active' }, { onRemove: vi.fn() });
      expect(screen.getByText('Remove Listing')).toBeInTheDocument();
    });

    it('shows bid count', () => {
      renderCard({ status: 'active' }, { bidCount: 5 });
      expect(screen.getByText('5 bids')).toBeInTheDocument();
    });

    it('shows singular bid text for 1 bid', () => {
      renderCard({ status: 'active' }, { bidCount: 1 });
      expect(screen.getByText('1 bid')).toBeInTheDocument();
    });

    it('calls onViewBids when clicked', () => {
      const onViewBids = vi.fn();
      renderCard({ status: 'active' }, { onViewBids, bidCount: 1 });
      fireEvent.click(screen.getByText('View Bids'));
      expect(onViewBids).toHaveBeenCalledOnce();
    });

    it('calls onRemove when clicked', () => {
      const onRemove = vi.fn();
      renderCard({ status: 'active' }, { onRemove });
      fireEvent.click(screen.getByText('Remove Listing'));
      expect(onRemove).toHaveBeenCalledOnce();
    });
  });

  describe('pending status', () => {
    it('shows Complete Sale button', () => {
      renderCard({ status: 'pending' }, { onCompleteSale: vi.fn() });
      expect(screen.getByText('Complete Sale')).toBeInTheDocument();
    });

    it('shows Cancel Pending Sale button', () => {
      renderCard({ status: 'pending' }, { onCancelPending: vi.fn() });
      expect(screen.getByText('Cancel Pending Sale')).toBeInTheDocument();
    });

    it('shows sale in progress message', () => {
      renderCard({ status: 'pending' });
      expect(screen.getByText('Sale in progress')).toBeInTheDocument();
    });

    it('calls onCompleteSale when clicked', () => {
      const onCompleteSale = vi.fn();
      renderCard({ status: 'pending' }, { onCompleteSale });
      fireEvent.click(screen.getByText('Complete Sale'));
      expect(onCompleteSale).toHaveBeenCalledOnce();
    });

    it('calls onCancelPending when clicked', () => {
      const onCancelPending = vi.fn();
      renderCard({ status: 'pending' }, { onCancelPending });
      fireEvent.click(screen.getByText('Cancel Pending Sale'));
      expect(onCancelPending).toHaveBeenCalledOnce();
    });
  });

  describe('completed status', () => {
    it('shows sale completed message', () => {
      renderCard({ status: 'completed' });
      expect(screen.getByText('Sale completed')).toBeInTheDocument();
    });

    it('does not show action buttons', () => {
      renderCard({ status: 'completed' });
      expect(screen.queryByText('View Bids')).not.toBeInTheDocument();
      expect(screen.queryByText('Complete Sale')).not.toBeInTheDocument();
    });
  });

  describe('compact variant', () => {
    it('shows View Bids in compact mode for active listings', () => {
      renderCard({ status: 'active' }, { compact: true, onViewBids: vi.fn(), bidCount: 2 });
      expect(screen.getByText('View Bids')).toBeInTheDocument();
    });

    it('shows Remove in compact mode for active listings', () => {
      renderCard({ status: 'active' }, { compact: true, onRemove: vi.fn() });
      expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('shows Cancel in compact mode for pending listings', () => {
      renderCard({ status: 'pending' }, { compact: true, onCancelPending: vi.fn() });
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  describe('description modal', () => {
    it('opens description modal on description click', () => {
      renderCard({ description: 'Click me' });
      fireEvent.click(screen.getByText('Click me'));
      expect(screen.getByTestId('description-modal')).toBeInTheDocument();
    });
  });
});
