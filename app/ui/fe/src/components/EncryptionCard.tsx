import { useState } from 'react';
import type { EncryptionDisplay } from '../services/api';
import { EncryptionStatusBadge } from './Badge';
import DescriptionModal, {
  needsTruncation,
  truncateDescription,
} from './DescriptionModal';

// Default fallback price when suggested price can't be parsed
const DEFAULT_FALLBACK_PRICE = 1;

interface EncryptionCardProps {
  encryption: EncryptionDisplay;
  onPlaceBid?: (encryption: EncryptionDisplay) => void;
  isOwnListing?: boolean;
  compact?: boolean;
}

export default function EncryptionCard({
  encryption,
  onPlaceBid,
  isOwnListing = false,
  compact = false,
}: EncryptionCardProps) {
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);

  const truncateAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  };

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

  const canBid = encryption.status === 'active' && !isOwnListing;

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

  const hasLongDescription = needsTruncation(encryption.description);

  if (compact) {
    return (
      <>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {truncateToken(encryption.tokenName)}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${
                  isUnknownStorageLayer(encryption.storageLayer)
                    ? 'bg-[var(--warning-muted)] text-[var(--warning)] border-[var(--warning)]'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                }`}
              >
                {getStorageLayerLabel(encryption.storageLayer)}
              </span>
              <EncryptionStatusBadge status={encryption.status} />
            </div>
          </div>
          {encryption.description && (
            <div
              className={`flex items-center gap-1 mb-2 ${
                hasLongDescription ? 'cursor-pointer' : ''
              }`}
              onClick={hasLongDescription ? () => setDescriptionModalOpen(true) : undefined}
            >
              <p className={`text-sm text-[var(--text-secondary)] line-clamp-1 ${
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
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-[var(--accent)]">
              {formatPrice(encryption.suggestedPrice)}
            </span>
            {canBid && onPlaceBid && (
              <button
                onClick={() => onPlaceBid(encryption)}
                className="px-3 py-1.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
              >
                Bid
              </button>
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

        {/* Seller Info */}
        <div className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)]">
          <span className="text-xs text-[var(--text-muted)]">Seller</span>
          <span className="text-xs font-mono text-[var(--text-secondary)]">
            {truncateAddress(encryption.seller)}
          </span>
        </div>

        {/* Action Button */}
        {canBid && onPlaceBid && (
          <button
            onClick={() => onPlaceBid(encryption)}
            className="w-full mt-4 px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
          >
            Place Bid
          </button>
        )}

        {isOwnListing && (
          <div className="mt-4 text-center text-xs text-[var(--text-muted)]">
            This is your listing
          </div>
        )}

        {encryption.status === 'pending' && (
          <div className="mt-4 p-3 bg-[var(--warning-muted)] rounded-[var(--radius-md)] text-center">
            <p className="text-xs text-[var(--warning)]">Sale in progress</p>
          </div>
        )}

        {encryption.status === 'completed' && (
          <div className="mt-4 p-3 bg-[var(--success-muted)] rounded-[var(--radius-md)] text-center">
            <p className="text-xs text-[var(--success)]">Sale completed</p>
          </div>
        )}
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
