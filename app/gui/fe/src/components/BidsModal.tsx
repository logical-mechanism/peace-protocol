import type { EncryptionDisplay, BidDisplay } from '../services/api';
import { truncateHex } from '../utils/truncate';
import { BidStatusBadge } from './Badge';
import EmptyState from './EmptyState';
import { useModalStack } from '../hooks/useModalStack';

interface BidsModalProps {
  isOpen: boolean;
  onClose: () => void;
  encryption: EncryptionDisplay;
  bids: BidDisplay[];
  onAcceptBid?: (bid: BidDisplay) => void;
}

export default function BidsModal({
  isOpen,
  onClose,
  encryption,
  bids,
  onAcceptBid,
}: BidsModalProps) {
  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('bids', isOpen, onClose);

  if (!shouldRender) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatLovelace = (lovelace: number) => {
    const ada = lovelace / 1_000_000;
    return `${ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ADA`;
  };

  // Sort bids by amount (highest first), then by status (pending first)
  const sortedBids = [...bids].sort((a, b) => {
    // Pending bids first
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    // Then by amount (highest first)
    return b.amount - a.amount;
  });

  const pendingBids = sortedBids.filter((b) => b.status === 'pending');
  const otherBids = sortedBids.filter((b) => b.status !== 'pending');

  const canAcceptBids = encryption.status === 'active';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bids-modal-title"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className={`relative w-full max-w-xl max-h-[80vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden flex flex-col mx-4 ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="bids-modal-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Bids for Listing
            </h2>
            <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5">
              {truncateHex(encryption.tokenName, 12, 6)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Listing Summary */}
        <div className="px-6 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Suggested Price</p>
              <p className="text-sm font-medium text-[var(--accent)]">
                {encryption.suggestedPrice
                  ? `${encryption.suggestedPrice.toLocaleString()} ADA`
                  : 'No price set'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[var(--text-muted)]">Total Bids</p>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {bids.length} ({pendingBids.length} pending)
              </p>
            </div>
          </div>
        </div>

        {/* Bids List */}
        <div className="flex-1 overflow-y-auto p-6">
          {bids.length === 0 ? (
            <EmptyState
              title="No bids yet"
              description="Once buyers place bids on this listing, they will appear here"
            />
          ) : (
            <div className="space-y-4">
              {/* Pending Bids Section */}
              {pendingBids.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">
                    Pending Bids ({pendingBids.length})
                  </h3>
                  <div className="space-y-3">
                    {pendingBids.map((bid) => (
                      <BidCard
                        key={bid.tokenName}
                        bid={bid}
                        canAccept={canAcceptBids}
                        onAccept={onAcceptBid}
                                                formatDate={formatDate}
                        formatLovelace={formatLovelace}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Other Bids Section */}
              {otherBids.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">
                    Past Bids ({otherBids.length})
                  </h3>
                  <div className="space-y-3">
                    {otherBids.map((bid) => (
                      <BidCard
                        key={bid.tokenName}
                        bid={bid}
                        canAccept={false}
                                                formatDate={formatDate}
                        formatLovelace={formatLovelace}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          {!canAcceptBids && encryption.status === 'pending' && (
            <p className="text-xs text-[var(--warning)] text-center mb-3">
              Cannot accept new bids while a sale is pending
            </p>
          )}
          {!canAcceptBids && encryption.status === 'completed' && (
            <p className="text-xs text-[var(--success)] text-center mb-3">
              This listing has been sold
            </p>
          )}
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Individual Bid Card component
interface BidCardProps {
  bid: BidDisplay;
  canAccept: boolean;
  onAccept?: (bid: BidDisplay) => void;
  formatDate: (date: string) => string;
  formatLovelace: (amount: number) => string;
}

function BidCard({
  bid,
  canAccept,
  onAccept,
  formatDate,
  formatLovelace,
}: BidCardProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:border-[var(--border-default)] transition-all duration-150">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Bidder Address */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-[var(--text-secondary)]">
              {truncateHex(bid.bidder, 12, 8)}
            </span>
            <BidStatusBadge status={bid.status} />
          </div>

          {/* Bid Amount */}
          <p className="text-lg font-semibold text-[var(--accent)]">
            {formatLovelace(bid.amount)}
          </p>

          {/* Date */}
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Placed {formatDate(bid.createdAt)}
          </p>
        </div>

        {/* Accept Button */}
        {canAccept && bid.status === 'pending' && onAccept && (
          <button
            onClick={() => onAccept(bid)}
            className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] flex-shrink-0 btn-base btn-success"
          >
            Accept Bid
          </button>
        )}
      </div>

      {/* Bid Token (collapsible info) */}
      <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">Bid Token</span>
          <span className="text-xs font-mono text-[var(--text-muted)]">
            {bid.tokenName.slice(0, 16)}...
          </span>
        </div>
      </div>
    </div>
  );
}
