import { useState, useEffect, memo } from 'react';
import type { EncryptionDisplay } from '../services/api';
import { truncateHex } from '../utils/truncate';
import { EncryptionStatusBadge } from './Badge';
import DescriptionModal from './DescriptionModal';
import ListingImage from './ListingImage';
import { truncateDescription } from './descriptionUtils';
import { formatRelativeTime } from '../utils/time';
import { formatPrice, getCategoryLabel } from '../utils/formatListing';
import { TransactionLinkInline } from './TransactionLink';

interface SalesListingCardProps {
  encryption: EncryptionDisplay;
  bidCount: number;
  onViewBids?: (encryption: EncryptionDisplay) => void;
  onRemove?: (encryption: EncryptionDisplay) => void;
  onUpdatePrice?: (encryption: EncryptionDisplay) => void;
  onCancelPending?: (encryption: EncryptionDisplay) => void;
  onCompleteSale?: (encryption: EncryptionDisplay) => void;
  compact?: boolean;
  initialCached?: boolean;
  initialBanned?: boolean;
}

function SalesListingCard({
  encryption,
  bidCount,
  onViewBids,
  onRemove,
  onUpdatePrice,
  onCancelPending,
  onCompleteSale,
  compact = false,
  initialCached = false,
  initialBanned = false,
}: SalesListingCardProps) {
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [prevBidCount, setPrevBidCount] = useState(bidCount);
  const [bidPulseKey, setBidPulseKey] = useState(0);
  const isOptimistic = encryption._optimistic === true;

  useEffect(() => {
    if (bidCount > prevBidCount) {
      setPrevBidCount(bidCount);
      setBidPulseKey(k => k + 1);
    }
  }, [bidCount, prevBidCount]);

  // Get storage layer label - returns "No data layer" for unknown/missing values
  const getStorageLayerLabel = (storageLayer?: string): string => {
    if (!storageLayer) return 'No data layer';
    if (storageLayer === 'on-chain') return 'On-chain';
    if (storageLayer === 'iagon') return 'Iagon';
    if (storageLayer.startsWith('ipfs://')) return 'IPFS';
    if (storageLayer.startsWith('arweave://')) return 'Arweave';
    return 'No data layer';
  };

  // Check if storage layer is unknown/missing
  const isUnknownStorageLayer = (storageLayer?: string): boolean => {
    if (!storageLayer) return true;
    if (storageLayer === 'on-chain') return false;
    if (storageLayer === 'iagon') return false;
    if (storageLayer.startsWith('ipfs://')) return false;
    if (storageLayer.startsWith('arweave://')) return false;
    return true;
  };

  // Calculate TTL countdown for pending status
  const getPendingTTL = () => {
    if (encryption.status !== 'pending') return null;
    if (encryption.datum.status.type !== 'Pending') return null;

    const ttl = encryption.datum.status.ttl;
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const remaining = ttl - now;

    if (remaining <= 0) return 'Expired';

    const minutes = Math.floor(remaining / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m remaining`;
    }
    return `${minutes}m remaining`;
  };

  const pendingTTL = getPendingTTL();
  const isActive = encryption.status === 'active';
  const isPending = encryption.status === 'pending';
  const isCompleted = encryption.status === 'completed';
  if (compact) {
    return (
      <>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-[var(--space-md)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-[var(--transition-fast)]">
          <div className="flex items-center justify-between gap-[var(--space-md)]">
            {/* Left: Token info */}
            <div className="flex items-center gap-[var(--space-3)] min-w-0 flex-1">
              {/* Image / Lock icon */}
              <ListingImage
                tokenName={encryption.tokenName}
                imageLink={encryption.imageLink}
                size="sm"
                initialCached={initialCached}
                initialBanned={initialBanned}
              />

              <div className="min-w-0">
                <div className="flex items-center gap-[var(--space-2)] mb-0.5 flex-wrap">
                  <span className="text-xs font-mono text-[var(--text-muted)]" title={encryption.tokenName}>
                    {truncateHex(encryption.tokenName, 8, 4)}
                  </span>
                  <EncryptionStatusBadge status={encryption.status} />
                  {isOptimistic && (
                    <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20 animate-pulse">
                      Awaiting confirmation
                    </span>
                  )}
                  <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]">
                    {getCategoryLabel(encryption.category)}
                  </span>
                </div>
                {encryption.description && (
                  <p
                    className="text-sm font-medium text-[var(--text-secondary)] truncate cursor-pointer hover:text-[var(--text-primary)]"
                    onClick={() => setDescriptionModalOpen(true)}
                  >
                    {truncateDescription(encryption.description)}
                  </p>
                )}
                <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5">
                  <span>{formatRelativeTime(encryption.createdAt)}</span>
                  <span>·</span>
                  <TransactionLinkInline txHash={encryption.utxo.txHash} className="text-xs" />
                </p>
              </div>
            </div>

            {/* Middle: Price & Bids */}
            <div className="flex items-center gap-[var(--space-lg)] flex-shrink-0">
              <div className="text-right">
                <span className="text-lg font-semibold text-[var(--accent)] inline-flex items-center gap-[var(--space-1)]">
                  {formatPrice(encryption.suggestedPrice)}
                  {isActive && !isOptimistic && onUpdatePrice && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdatePrice(encryption); }}
                      className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
                      title="Update price"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                      </svg>
                    </button>
                  )}
                </span>
                {isPending && pendingTTL && (
                  <p className="text-xs text-[var(--warning)]">{pendingTTL}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-[var(--space-2)]">
                {isActive && !isOptimistic && (
                  <>
                    <button
                      onClick={() => onViewBids?.(encryption)}
                      className="px-[var(--space-3)] py-1.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                    >
                      View Bids
                      {bidCount > 0 && (
                        <span
                          key={bidPulseKey}
                          className={`ml-1.5 px-1.5 py-0.5 text-xs bg-white/20 rounded${bidPulseKey > 0 ? ' bid-pulse' : ''}`}
                        >
                          {bidCount}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => onRemove?.(encryption)}
                      className="px-[var(--space-3)] py-1.5 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
                      title="Remove listing"
                    >
                      Remove
                    </button>
                  </>
                )}
                {isPending && (
                  <>
                    <button
                      onClick={() => onCompleteSale?.(encryption)}
                      className="px-[var(--space-3)] py-1.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-success"
                    >
                      Complete Sale
                    </button>
                    <button
                      onClick={() => onCancelPending?.(encryption)}
                      className="px-[var(--space-3)] py-1.5 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Description Modal */}
        <DescriptionModal
          isOpen={descriptionModalOpen}
          onClose={() => setDescriptionModalOpen(false)}
          description={encryption.description || ''}
          tokenName={encryption.tokenName}
        />
      </>
    );
  }

  return (
    <>
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-[var(--space-lg)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] hover:translate-y-[-1px] hover:shadow-[var(--shadow-md)] transition-all duration-[var(--transition-fast)]">
        {/* Header */}
        <div className="mb-[var(--space-md)] space-y-[var(--space-1)]">
          {/* Row 1: Status + Transaction Hash */}
          <div className="flex items-center gap-[var(--space-2)] min-w-0">
            <TransactionLinkInline txHash={encryption.utxo.txHash} className="text-xs font-mono tracking-wide truncate" />
            <EncryptionStatusBadge status={encryption.status} />
          </div>
          {/* Row 2: Storage Layer */}
          <span
            className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border inline-block ${
              isUnknownStorageLayer(encryption.storageLayer)
                ? 'bg-[var(--warning-muted)] text-[var(--warning)] border-[var(--warning)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]'
            }`}
          >
            {getStorageLayerLabel(encryption.storageLayer)}
          </span>
          {/* Row 3: Created Date */}
          <p className="text-xs text-[var(--text-muted)] text-center">
            Created: {formatRelativeTime(encryption.createdAt)}
          </p>
        </div>

        {/* Description */}
        {encryption.description && (
          <div
            className="mb-[var(--space-md)] p-[var(--space-3)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-elevated)] hover:border-[var(--border-default)]"
            onClick={() => setDescriptionModalOpen(true)}
          >
            <p
              className="text-sm font-medium text-[var(--text-secondary)] line-clamp-1"
              title={encryption.description}
            >
              {truncateDescription(encryption.description)}
            </p>
          </div>
        )}

        {/* Image / Lock Icon */}
        <ListingImage
          tokenName={encryption.tokenName}
          imageLink={encryption.imageLink}
          size="md"
          initialCached={initialCached}
          initialBanned={initialBanned}
        />

        {/* Price */}
        <div className="text-center mb-[var(--space-md)]">
          <p className="text-2xl font-semibold text-[var(--accent)] inline-flex items-center justify-center gap-[var(--space-1)]">
            {formatPrice(encryption.suggestedPrice)}
            {isActive && !isOptimistic && onUpdatePrice && (
              <button
                onClick={(e) => { e.stopPropagation(); onUpdatePrice(encryption); }}
                className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
                title="Update price"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                </svg>
              </button>
            )}
          </p>
        </div>

        {/* Pending Status Info */}
        {isPending && (
          <div className="mt-[var(--space-md)] p-[var(--space-3)] bg-[var(--warning-muted)] rounded-[var(--radius-md)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--warning)]">Sale in progress</p>
              {pendingTTL && (
                <p className="text-xs text-[var(--warning)]">{pendingTTL}</p>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-[var(--space-1)]">
              Complete the sale or it will automatically cancel
            </p>
          </div>
        )}

        {/* Completed Status Info */}
        {isCompleted && (
          <div className="mt-[var(--space-md)] p-[var(--space-3)] bg-[var(--success-muted)] rounded-[var(--radius-md)] text-center">
            <p className="text-xs font-medium text-[var(--success)]">Sale completed</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-[var(--space-md)] space-y-[var(--space-2)]">
          {isActive && !isOptimistic && (
            <>
              <button
                onClick={() => onViewBids?.(encryption)}
                className="w-full px-[var(--space-md)] py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-[var(--space-2)] btn-base btn-primary"
              >
                <span>View Bids</span>
                {bidCount > 0 && (
                  <span
                    key={bidPulseKey}
                    className={`px-2 py-0.5 text-xs bg-white/20 rounded-full${bidPulseKey > 0 ? ' bid-pulse' : ''}`}
                  >
                    {bidCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => onRemove?.(encryption)}
                className="w-full px-[var(--space-md)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
              >
                Remove Listing
              </button>
            </>
          )}
          {isPending && (
            <>
              <button
                onClick={() => onCompleteSale?.(encryption)}
                className="w-full px-[var(--space-md)] py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-success"
              >
                Complete Sale
              </button>
              <button
                onClick={() => onCancelPending?.(encryption)}
                className="w-full px-[var(--space-md)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
              >
                Cancel Pending Sale
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description Modal */}
      <DescriptionModal
        isOpen={descriptionModalOpen}
        onClose={() => setDescriptionModalOpen(false)}
        description={encryption.description || ''}
        tokenName={encryption.tokenName}
      />
    </>
  );
}

function arePropsEqual(prev: SalesListingCardProps, next: SalesListingCardProps): boolean {
  return (
    prev.encryption.tokenName === next.encryption.tokenName &&
    prev.encryption.status === next.encryption.status &&
    prev.encryption.suggestedPrice === next.encryption.suggestedPrice &&
    prev.encryption.imageLink === next.encryption.imageLink &&
    prev.encryption.description === next.encryption.description &&
    prev.encryption.category === next.encryption.category &&
    prev.encryption.storageLayer === next.encryption.storageLayer &&
    prev.encryption.createdAt === next.encryption.createdAt &&
    prev.encryption.datum?.status?.type === next.encryption.datum?.status?.type &&
    prev.bidCount === next.bidCount &&
    prev.compact === next.compact &&
    prev.initialCached === next.initialCached &&
    prev.initialBanned === next.initialBanned &&
    prev.onViewBids === next.onViewBids &&
    prev.onRemove === next.onRemove &&
    prev.onUpdatePrice === next.onUpdatePrice &&
    prev.onCancelPending === next.onCancelPending &&
    prev.onCompleteSale === next.onCompleteSale
  );
}

export default memo(SalesListingCard, arePropsEqual);
