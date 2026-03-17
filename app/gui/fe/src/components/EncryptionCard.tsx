import { useState, memo } from 'react';
import type { EncryptionDisplay } from '../services/api';
import { copyToClipboard } from '../utils/clipboard';
import { truncateHex } from '../utils/truncate';
import { EncryptionStatusBadge } from './Badge';
import DescriptionModal from './DescriptionModal';
import ListingImage from './ListingImage';
import { truncateDescription } from './descriptionUtils';
import HighlightText from './HighlightText';
import { formatDate } from '../utils/formatDate';


interface EncryptionCardProps {
  encryption: EncryptionDisplay;
  onPlaceBid?: (encryption: EncryptionDisplay, bidCount: number) => void;
  isOwnListing?: boolean;
  hasBid?: boolean;
  compact?: boolean;
  initialCached?: boolean;
  initialBanned?: boolean;
  bidCount?: number;
  lovelace?: string | null;
  isFavorite?: boolean;
  onToggleFavorite?: (tokenName: string) => void;
  searchQuery?: string;
}

function EncryptionCard({
  encryption,
  onPlaceBid,
  isOwnListing = false,
  hasBid = false,
  compact = false,
  initialCached = false,
  initialBanned = false,
  bidCount = 0,
  lovelace,
  isFavorite = false,
  onToggleFavorite,
  searchQuery = '',
}: EncryptionCardProps) {
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [prevBidCount, setPrevBidCount] = useState(bidCount);
  const [bidPulseKey, setBidPulseKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [favPulseKey, setFavPulseKey] = useState(0);

  if (bidCount > prevBidCount) {
    setPrevBidCount(bidCount);
    setBidPulseKey(k => k + 1);
  }

  // Format price with "No suggested price" fallback for missing/invalid values
  const formatPrice = (price?: number): string => {
    if (price === undefined || price === null || isNaN(price) || price < 0) {
      return 'No suggested price';
    }
    return `${price.toLocaleString()} ADA`;
  };

  const hasLowBalance = lovelace !== undefined && (lovelace === null || parseInt(lovelace) < 2_000_000);
  const isOptimistic = encryption._optimistic === true;
  const canBid = encryption.status === 'active' && !isOwnListing && !hasBid && !isOptimistic;

  // Get category label, defaulting to "Text" for backward compatibility
  const getCategoryLabel = (category?: string): string => {
    if (!category) return 'Text';
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const handleCopySeller = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await copyToClipboard(encryption.sellerPkh);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFavPulseKey(k => k + 1);
    onToggleFavorite?.(encryption.tokenName);
  };

  if (compact) {
    return (
      <>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-[var(--space-md)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-[var(--transition-fast)]">
          <div className="flex items-center justify-between mb-[var(--space-2)]">
            <div className="flex items-center gap-[var(--space-2)]">
              {onToggleFavorite && (
                <button
                  onClick={handleToggleFavorite}
                  className="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer"
                  title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <svg key={favPulseKey} className={`w-3.5 h-3.5${favPulseKey > 0 ? ' fav-pulse' : ''}`} fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </button>
              )}
              <span title={encryption.tokenName}>
                <HighlightText
                  text={truncateHex(encryption.tokenName, 8, 4)}
                  query={searchQuery}
                  className="text-xs font-mono text-[var(--text-muted)]"
                />
              </span>
            </div>
            <div className="flex items-center gap-[var(--space-2)]">
              <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]">
                {getCategoryLabel(encryption.category)}
              </span>
              <EncryptionStatusBadge status={encryption.status} />
              {isOptimistic && (
                <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20 animate-pulse">
                  Awaiting confirmation
                </span>
              )}
              {bidCount > 0 && (
                <span
                  key={bidPulseKey}
                  className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-muted)] text-[var(--accent)] font-medium${bidPulseKey > 0 ? ' bid-pulse' : ''}`}
                >
                  {bidCount}
                </span>
              )}
            </div>
          </div>
          {encryption.description && (
            <p
              className="text-sm font-medium text-[var(--text-secondary)] line-clamp-1 mb-[var(--space-2)] cursor-pointer hover:text-[var(--text-primary)]"
              onClick={() => setDescriptionModalOpen(true)}
            >
              <HighlightText text={truncateDescription(encryption.description)} query={searchQuery} />
            </p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-[var(--accent)]">
              {formatPrice(encryption.suggestedPrice)}
            </span>
            {canBid && onPlaceBid && (
              <div className="flex items-center gap-[var(--space-2)]">
                <button
                  onClick={() => !hasLowBalance && onPlaceBid(encryption, bidCount)}
                  disabled={hasLowBalance}
                  title={hasLowBalance ? 'Insufficient balance (minimum 2 ADA)' : undefined}
                  className={`px-[var(--space-3)] py-1.5 text-sm font-medium rounded-[var(--radius-md)] btn-base ${hasLowBalance ? 'cursor-not-allowed bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]' : 'btn-primary'}`}
                >
                  Bid
                </button>
                {hasLowBalance && (
                  <span className="text-xs text-[var(--error)]">Insufficient balance</span>
                )}
              </div>
            )}
            {hasBid && encryption.status === 'active' && !isOwnListing && (
              <span className="px-[var(--space-3)] py-1.5 text-sm font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
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
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-[var(--space-lg)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] hover:translate-y-[-1px] hover:shadow-[var(--shadow-md)] transition-all duration-[var(--transition-fast)]">
        {/* Header */}
        <div className="flex items-start justify-between mb-[var(--space-md)]">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-1)] flex-wrap">
              {onToggleFavorite && (
                <button
                  onClick={handleToggleFavorite}
                  className="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer"
                  title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <svg key={favPulseKey} className={`w-4 h-4${favPulseKey > 0 ? ' fav-pulse' : ''}`} fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </button>
              )}
              <span title={encryption.tokenName}>
                <HighlightText
                  text={truncateHex(encryption.tokenName, 8, 4)}
                  query={searchQuery}
                  className="text-xs font-mono text-[var(--text-muted)] truncate"
                />
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
              {bidCount > 0 && (
                <span
                  key={bidPulseKey}
                  className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-muted)] text-[var(--accent)] font-medium${bidPulseKey > 0 ? ' bid-pulse' : ''}`}
                >
                  {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Listed {formatDate(encryption.createdAt)}
            </p>
          </div>
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
              <HighlightText text={truncateDescription(encryption.description)} query={searchQuery} />
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
          <p className="text-2xl font-semibold text-[var(--accent)]">
            {formatPrice(encryption.suggestedPrice)}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-[var(--space-1)]">Suggested Price</p>
        </div>

        {/* Seller Info */}
        <div className="flex items-center justify-between py-[var(--space-3)] border-t border-[var(--border-subtle)]">
          <span className="text-xs font-medium text-[var(--text-muted)]">Seller</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-[var(--text-secondary)]">
              {truncateHex(encryption.seller, 10, 6)}
            </span>
            <button
              onClick={handleCopySeller}
              className="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer"
              title="Copy seller address"
              aria-label="Copy seller address"
            >
              {copied ? (
                <svg className="w-3.5 h-3.5 text-[var(--success)] copy-check-animate" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Action Button */}
        {canBid && onPlaceBid && (
          <>
            <button
              onClick={() => !hasLowBalance && onPlaceBid(encryption, bidCount)}
              disabled={hasLowBalance}
              title={hasLowBalance ? 'Insufficient balance (minimum 2 ADA)' : undefined}
              className={`w-full mt-[var(--space-md)] px-[var(--space-md)] py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base ${hasLowBalance ? 'cursor-not-allowed bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]' : 'btn-primary'}`}
            >
              {hasLowBalance ? 'Insufficient Balance' : 'Place Bid'}
            </button>
            {hasLowBalance && (
              <p className="mt-[var(--space-1)] text-center text-xs text-[var(--error)]">Insufficient balance</p>
            )}
          </>
        )}

        {hasBid && encryption.status === 'active' && !isOwnListing && (
          <div className="mt-[var(--space-md)] text-center text-xs text-[var(--text-muted)]">
            You have a bid on this listing
          </div>
        )}

        {isOwnListing && (
          <div className="mt-[var(--space-md)] text-center text-xs text-[var(--text-muted)]">
            This is your listing
          </div>
        )}

        {encryption.status === 'pending' && (
          <div className="mt-[var(--space-md)] p-[var(--space-3)] bg-[var(--warning-muted)] rounded-[var(--radius-md)] text-center">
            <p className="text-xs text-[var(--warning)]">Sale in progress</p>
          </div>
        )}

        {encryption.status === 'completed' && (
          <div className="mt-[var(--space-md)] p-[var(--space-3)] bg-[var(--success-muted)] rounded-[var(--radius-md)] text-center">
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

function arePropsEqual(prev: EncryptionCardProps, next: EncryptionCardProps): boolean {
  return (
    prev.encryption.tokenName === next.encryption.tokenName &&
    prev.encryption.status === next.encryption.status &&
    prev.encryption.suggestedPrice === next.encryption.suggestedPrice &&
    prev.encryption.imageLink === next.encryption.imageLink &&
    prev.encryption.description === next.encryption.description &&
    prev.encryption.category === next.encryption.category &&
    prev.encryption.createdAt === next.encryption.createdAt &&
    prev.bidCount === next.bidCount &&
    prev.compact === next.compact &&
    prev.isOwnListing === next.isOwnListing &&
    prev.hasBid === next.hasBid &&
    prev.isFavorite === next.isFavorite &&
    prev.searchQuery === next.searchQuery &&
    prev.lovelace === next.lovelace &&
    prev.initialCached === next.initialCached &&
    prev.initialBanned === next.initialBanned &&
    prev.onPlaceBid === next.onPlaceBid &&
    prev.onToggleFavorite === next.onToggleFavorite
  );
}

export default memo(EncryptionCard, arePropsEqual);
