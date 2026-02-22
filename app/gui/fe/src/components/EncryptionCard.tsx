import { useState } from 'react';
import type { EncryptionDisplay } from '../services/api';
import { EncryptionStatusBadge } from './Badge';
import DescriptionModal from './DescriptionModal';
import ListingImage from './ListingImage';
import { truncateDescription } from './descriptionUtils';

// Default fallback price when suggested price can't be parsed
const DEFAULT_FALLBACK_PRICE = 1;

interface EncryptionCardProps {
  encryption: EncryptionDisplay;
  onPlaceBid?: (encryption: EncryptionDisplay) => void;
  isOwnListing?: boolean;
  hasBid?: boolean;
  compact?: boolean;
  initialCached?: boolean;
  initialBanned?: boolean;
}

export default function EncryptionCard({
  encryption,
  onPlaceBid,
  isOwnListing = false,
  hasBid = false,
  compact = false,
  initialCached = false,
  initialBanned = false,
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

  const canBid = encryption.status === 'active' && !isOwnListing && !hasBid;

  // Get category label, defaulting to "Text" for backward compatibility
  const getCategoryLabel = (category?: string): string => {
    if (!category) return 'Text';
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  if (compact) {
    return (
      <>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {truncateToken(encryption.tokenName)}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]">
                {getCategoryLabel(encryption.category)}
              </span>
              <EncryptionStatusBadge status={encryption.status} />
            </div>
          </div>
          {encryption.description && (
            <p
              className="text-sm text-[var(--text-secondary)] line-clamp-1 mb-2 cursor-pointer hover:text-[var(--text-primary)]"
              onClick={() => setDescriptionModalOpen(true)}
            >
              {truncateDescription(encryption.description)}
            </p>
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
            {hasBid && encryption.status === 'active' && !isOwnListing && (
              <span className="px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                Bid Placed
              </span>
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
              <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]">
                {getCategoryLabel(encryption.category)}
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
            className="mb-4 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-elevated)] hover:border-[var(--border-default)]"
            onClick={() => setDescriptionModalOpen(true)}
          >
            <p
              className="text-sm text-[var(--text-secondary)] line-clamp-1"
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

        {hasBid && encryption.status === 'active' && !isOwnListing && (
          <div className="mt-4 text-center text-xs text-[var(--text-muted)]">
            You have a bid on this listing
          </div>
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
