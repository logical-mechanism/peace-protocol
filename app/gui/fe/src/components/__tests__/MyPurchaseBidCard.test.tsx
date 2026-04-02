import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MyPurchaseBidCard from '../MyPurchaseBidCard';
import { createBid, createEncryption } from '../../test/factories';
import type { BidDisplay, EncryptionDisplay } from '../../services/api';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../Badge', () => ({
  BidStatusBadge: ({ status }: { status: string }) => (
    <span data-testid="bid-status-badge">{status}</span>
  ),
}));

vi.mock('../BidTimeline', () => ({
  default: ({ stage }: { stage: string }) => (
    <div data-testid="bid-timeline">{stage}</div>
  ),
}));

vi.mock('../InfoTooltip', () => ({
  default: ({ text }: { text: string }) => (
    <span data-testid="info-tooltip" title={text} />
  ),
}));

vi.mock('../DescriptionModal', () => ({
  default: ({ isOpen, description }: { isOpen: boolean; description: string }) =>
    isOpen ? <div data-testid="description-modal">{description}</div> : null,
}));

vi.mock('../descriptionUtils', () => ({
  truncateDescription: (d: string) => d,
}));

vi.mock('../../utils/truncate', () => ({
  truncateHex: (s: string) => s.slice(0, 8) + '...',
}));

vi.mock('../../utils/formatAda', () => ({
  formatAda: (n: number) => n.toString(),
}));

vi.mock('../../utils/formatDate', () => ({
  formatDate: () => 'Jan 1, 2025',
}));

// ── Helpers ─────────────────────────────────────────────────────────

function renderCard(
  bidOverrides: Partial<BidDisplay> = {},
  props: {
    encryption?: EncryptionDisplay;
    onCancel?: (bid: BidDisplay) => void;
    onDecrypt?: (bid: BidDisplay) => void;
    compact?: boolean;
    purchaseStage?: string;
    decryptFailed?: boolean;
  } = {},
) {
  const bid = createBid(bidOverrides);
  return render(
    <MyPurchaseBidCard
      bid={bid}
      encryption={props.encryption}
      onCancel={props.onCancel}
      onDecrypt={props.onDecrypt}
      compact={props.compact}
      purchaseStage={props.purchaseStage as never}
      decryptFailed={props.decryptFailed}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  // @ts-expect-error - mock IntersectionObserver for ListingImage
  globalThis.IntersectionObserver = vi.fn(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }));
});

// ── Tests ───────────────────────────────────────────────────────────

describe('MyPurchaseBidCard', () => {
  describe('rendering', () => {
    it('renders bid amount', () => {
      renderCard({ amount: 50_000_000 });
      expect(screen.getByText(/50000000/)).toBeInTheDocument();
    });

    it('renders status badge', () => {
      renderCard({ status: 'pending' });
      expect(screen.getByTestId('bid-status-badge')).toHaveTextContent('pending');
    });

    it('renders encryption token reference', () => {
      renderCard({ encryptionToken: 'abcdef12' });
      expect(screen.getByText(/abcdef12/)).toBeInTheDocument();
    });

    it('renders info tooltip', () => {
      renderCard({ status: 'pending' });
      expect(screen.getByTestId('info-tooltip')).toBeInTheDocument();
    });
  });

  describe('pending status', () => {
    const expiredLock = { lockedUntil: 0 };

    it('shows Cancel Bid button in full mode when lock expired', () => {
      renderCard({ status: 'pending', ...expiredLock }, { onCancel: vi.fn() });
      expect(screen.getByText('Cancel Bid')).toBeInTheDocument();
    });

    it('shows Bid Locked button when lock is active', () => {
      renderCard({ status: 'pending' }, { onCancel: vi.fn() });
      expect(screen.getByText('Bid Locked')).toBeInTheDocument();
    });

    it('shows Cancel button in compact mode when lock expired', () => {
      renderCard({ status: 'pending', ...expiredLock }, { compact: true, onCancel: vi.fn() });
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('calls onCancel when Cancel Bid clicked', () => {
      const onCancel = vi.fn();
      renderCard({ status: 'pending', ...expiredLock }, { onCancel });
      fireEvent.click(screen.getByText('Cancel Bid'));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('does not show Decrypt button', () => {
      renderCard({ status: 'pending' });
      expect(screen.queryByText('Decrypt Message')).not.toBeInTheDocument();
    });
  });

  describe('accepted status', () => {
    it('shows acceptance message', () => {
      renderCard({ status: 'accepted' });
      expect(screen.getByText(/accepted.*decrypt/i)).toBeInTheDocument();
    });

    it('shows Decrypt Message button in full mode', () => {
      renderCard({ status: 'accepted' }, { onDecrypt: vi.fn() });
      expect(screen.getByText('Decrypt Message')).toBeInTheDocument();
    });

    it('shows Decrypt button in compact mode', () => {
      renderCard({ status: 'accepted' }, { compact: true, onDecrypt: vi.fn() });
      expect(screen.getByText('Decrypt')).toBeInTheDocument();
    });

    it('calls onDecrypt when Decrypt Message clicked', () => {
      const onDecrypt = vi.fn();
      renderCard({ status: 'accepted' }, { onDecrypt });
      fireEvent.click(screen.getByText('Decrypt Message'));
      expect(onDecrypt).toHaveBeenCalledOnce();
    });

    it('does not show Cancel button', () => {
      renderCard({ status: 'accepted' });
      expect(screen.queryByText('Cancel Bid')).not.toBeInTheDocument();
    });
  });

  describe('decrypt failed', () => {
    it('shows Retry Decrypt button in full mode', () => {
      renderCard({ status: 'accepted' }, { decryptFailed: true, onDecrypt: vi.fn() });
      expect(screen.getByText('Retry Decrypt')).toBeInTheDocument();
    });

    it('shows Retry button in compact mode', () => {
      renderCard({ status: 'accepted' }, { decryptFailed: true, compact: true, onDecrypt: vi.fn() });
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('shows failure message', () => {
      renderCard({ status: 'accepted' }, { decryptFailed: true });
      expect(screen.getByText(/Decryption failed/)).toBeInTheDocument();
    });
  });

  describe('rejected status', () => {
    it('shows rejection message', () => {
      renderCard({ status: 'rejected' });
      expect(screen.getByText(/not accepted/)).toBeInTheDocument();
    });

    it('does not show action buttons', () => {
      renderCard({ status: 'rejected' });
      expect(screen.queryByText('Cancel Bid')).not.toBeInTheDocument();
      expect(screen.queryByText('Decrypt Message')).not.toBeInTheDocument();
    });
  });

  describe('cancelled status', () => {
    it('shows cancelled message', () => {
      renderCard({ status: 'cancelled' });
      expect(screen.getByText('This bid was cancelled.')).toBeInTheDocument();
    });
  });

  describe('with encryption data', () => {
    it('shows seller info', () => {
      const encryption = createEncryption({ seller: 'addr_test1seller' });
      renderCard({}, { encryption });
      expect(screen.getByText(/addr_tes/)).toBeInTheDocument();
    });

    it('shows suggested price comparison', () => {
      const encryption = createEncryption({ suggestedPrice: 200 });
      renderCard({}, { encryption });
      expect(screen.getByText('200 ADA')).toBeInTheDocument();
    });
  });

  describe('purchase timeline', () => {
    it('renders bid timeline when purchaseStage provided', () => {
      renderCard({}, { purchaseStage: 'bid-placed' });
      expect(screen.getByTestId('bid-timeline')).toBeInTheDocument();
    });

    it('does not render timeline without purchaseStage', () => {
      renderCard({});
      expect(screen.queryByTestId('bid-timeline')).not.toBeInTheDocument();
    });
  });
});
