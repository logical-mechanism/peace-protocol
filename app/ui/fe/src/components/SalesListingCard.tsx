import { useState } from 'react';
import type { EncryptionDisplay } from '../services/api';
import { EncryptionStatusBadge } from './Badge';
import DescriptionModal, {
  needsTruncation,
  truncateDescription,
} from './DescriptionModal';

// Default fallback price when suggested price can't be parsed
const DEFAULT_FALLBACK_PRICE = 1;

interface SalesListingCardProps {
  encryption: EncryptionDisplay;
  bidCount: number;
  onViewBids?: (encryption: EncryptionDisplay) => void;
  onRemove?: (encryption: EncryptionDisplay) => void;
  onCancelPending?: (encryption: EncryptionDisplay) => void;
  onCompleteSale?: (encryption: EncryptionDisplay) => void;
  compact?: boolean;
}

export default function SalesListingCard({
  encryption,
  bidCount,
  onViewBids,
  onRemove,
  onCancelPending,
  onCompleteSale,
  compact = false,
}: SalesListingCardProps) {
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);

  const truncateToken = (token: string) => {
    if (!token) return '';
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Format price with fallback to 1 ADA if undefined, null, NaN, or invalid
  const formatPrice = (price?: number): string => {
    if (price === undefined || price === null || isNaN(price) || price < 0) {
      return `${DEFAULT_FALLBACK_PRICE} ADA`;
    }
    return `${price.toLocaleString()} ADA`;
  };

  // Get storage layer label - returns "No data layer" for unknown/missing values
  const getStorageLayerLabel = (storageLayer?: string): string => {
    if (!storageLayer) return 'No data layer';
    if (storageLayer === 'on-chain') return 'On-chain';
    if (storageLayer.startsWith('ipfs://')) return 'IPFS';
    if (storageLayer.startsWith('arweave://')) return 'Arweave';
    return 'No data layer';
  };

  // Check if storage layer is unknown/missing
  const isUnknownStorageLayer = (storageLayer?: string): boolean => {
    if (!storageLayer) return true;
    if (storageLayer === 'on-chain') return false;
    if (storageLayer.startsWith('ipfs://')) return false;
    if (storageLayer.startsWith('arweave://')) return false;
    return true;
  };

  // Calculate TTL countdown for pending status
  const getPendingTTL = () => {
    if (encryption.status !== 'pending') return null;
    if (encryption.datum.status.type !== 'Pending') return null;

    const ttl = encryption.datum.status.ttl;
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
  const hasLongDescription = needsTruncation(encryption.description);

  if (compact) {
    return (
      <>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Token info */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Lock icon */}
              <div className="w-10 h-10 rounded-full bg-[var(--accent-muted)] flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-5 h-5 text-[var(--accent)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                  />
                </svg>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    {truncateToken(encryption.tokenName)}
                  </span>
                  <EncryptionStatusBadge status={encryption.status} />
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${
                      isUnknownStorageLayer(encryption.storageLayer)
                        ? 'bg-[var(--warning-muted)] text-[var(--warning)] border-[var(--warning)]'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                    }`}
                  >
                    {getStorageLayerLabel(encryption.storageLayer)}
                  </span>
                </div>
                {encryption.description && (
                  <div
                    className={`flex items-center gap-1 ${
                      hasLongDescription ? 'cursor-pointer' : ''
                    }`}
                    onClick={hasLongDescription ? () => setDescriptionModalOpen(true) : undefined}
                  >
                    <p className={`text-sm text-[var(--text-secondary)] truncate ${
                      hasLongDescription ? 'hover:text-[var(--text-primary)]' : ''
                    }`}>
                      {truncateDescription(encryption.description)}
                    </p>
                    {hasLongDescription && (
                      <svg
                        className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Middle: Price & Bids */}
            <div className="flex items-center gap-6 flex-shrink-0">
              <div className="text-right">
                <span className="text-lg font-semibold text-[var(--accent)]">
                  {formatPrice(encryption.suggestedPrice)}
                </span>
                {isActive && bidCount > 0 && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
                  </p>
                )}
                {isPending && pendingTTL && (
                  <p className="text-xs text-[var(--warning)]">{pendingTTL}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                {isActive && (
                  <>
                    <button
                      onClick={() => onViewBids?.(encryption)}
                      className="px-3 py-1.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
                    >
                      View Bids
                      {bidCount > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-white/20 rounded">
                          {bidCount}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => onRemove?.(encryption)}
                      className="px-3 py-1.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
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
                      className="px-3 py-1.5 text-sm font-medium bg-[var(--success)] text-white rounded-[var(--radius-md)] hover:bg-[var(--success)]/90 transition-all duration-150 cursor-pointer"
                    >
                      Complete Sale
                    </button>
                    <button
                      onClick={() => onCancelPending?.(encryption)}
                      className="px-3 py-1.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
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
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-[var(--text-muted)] truncate">
                {truncateToken(encryption.tokenName)}
              </span>
              <EncryptionStatusBadge status={encryption.status} />
              <span
                className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${
                  isUnknownStorageLayer(encryption.storageLayer)
                    ? 'bg-[var(--warning-muted)] text-[var(--warning)] border-[var(--warning)]'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                }`}
              >
                {getStorageLayerLabel(encryption.storageLayer)}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Listed {formatDate(encryption.createdAt)}
            </p>
          </div>
        </div>

        {/* Description */}
        {encryption.description && (
          <div
            className={`mb-4 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] ${
              hasLongDescription ? 'cursor-pointer hover:bg-[var(--bg-elevated)] hover:border-[var(--border-default)]' : ''
            }`}
            onClick={hasLongDescription ? () => setDescriptionModalOpen(true) : undefined}
          >
            <div className="flex items-start gap-2">
              <p className="text-sm text-[var(--text-secondary)] line-clamp-2 flex-1">
                {truncateDescription(encryption.description)}
              </p>
              {hasLongDescription && (
                <svg
                  className="w-4 h-4 text-[var(--accent)] flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              )}
            </div>
          </div>
        )}

        {/* Lock Icon */}
        <div className="flex justify-center py-4">
          <div className="w-14 h-14 rounded-full bg-[var(--accent-muted)] flex items-center justify-center">
            <svg
              className="w-7 h-7 text-[var(--accent)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
        </div>

        {/* Price */}
        <div className="text-center mb-4">
          <p className="text-2xl font-semibold text-[var(--accent)]">
            {formatPrice(encryption.suggestedPrice)}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Suggested Price</p>
        </div>

        {/* Bids Info (for active listings) */}
        {isActive && (
          <div className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)]">
            <span className="text-xs text-[var(--text-muted)]">Active Bids</span>
            <span
              className={`text-sm font-medium ${
                bidCount > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
            </span>
          </div>
        )}

        {/* Pending Status Info */}
        {isPending && (
          <div className="mt-4 p-3 bg-[var(--warning-muted)] rounded-[var(--radius-md)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--warning)]">Sale in progress</p>
              {pendingTTL && (
                <p className="text-xs text-[var(--warning)]">{pendingTTL}</p>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Complete the sale or it will automatically cancel
            </p>
          </div>
        )}

        {/* Completed Status Info */}
        {isCompleted && (
          <div className="mt-4 p-3 bg-[var(--success-muted)] rounded-[var(--radius-md)] text-center">
            <p className="text-xs font-medium text-[var(--success)]">Sale completed</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-4 space-y-2">
          {isActive && (
            <>
              <button
                onClick={() => onViewBids?.(encryption)}
                className="w-full px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
              >
                <span>View Bids</span>
                {bidCount > 0 && (
                  <span className="px-2 py-0.5 text-xs bg-white/20 rounded-full">
                    {bidCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => onRemove?.(encryption)}
                className="w-full px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
              >
                Remove Listing
              </button>
            </>
          )}
          {isPending && (
            <>
              <button
                onClick={() => onCompleteSale?.(encryption)}
                className="w-full px-4 py-2.5 text-sm font-medium bg-[var(--success)] text-white rounded-[var(--radius-md)] hover:bg-[var(--success)]/90 transition-all duration-150 cursor-pointer"
              >
                Complete Sale
              </button>
              <button
                onClick={() => onCancelPending?.(encryption)}
                className="w-full px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
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
