import type { EncryptionDisplay } from '../services/api';
import { EncryptionStatusBadge } from './Badge';

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

  const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return 'No suggested price';
    return `${price.toLocaleString()} ADA`;
  };

  const canBid = encryption.status === 'active' && !isOwnListing;

  const getStorageLayerLabel = (storageLayer?: string) => {
    if (!storageLayer) return null;
    if (storageLayer === 'on-chain') return 'On-chain';
    if (storageLayer.startsWith('ipfs://')) return 'IPFS';
    if (storageLayer.startsWith('arweave://')) return 'Arweave';
    return 'External';
  };

  if (compact) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-[var(--text-muted)]">
            {truncateToken(encryption.tokenName)}
          </span>
          <EncryptionStatusBadge status={encryption.status} />
        </div>
        {encryption.description && (
          <p className="text-sm text-[var(--text-secondary)] mb-2 line-clamp-1">
            {encryption.description}
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
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-[var(--text-muted)] truncate">
              {truncateToken(encryption.tokenName)}
            </span>
            <EncryptionStatusBadge status={encryption.status} />
            {encryption.storageLayer && (
              <span className="text-xs px-1.5 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-muted)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                {getStorageLayerLabel(encryption.storageLayer)}
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
        <div className="mb-4 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
            {encryption.description}
          </p>
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
          <p className="text-xs text-[var(--warning)]">
            Sale in progress
          </p>
        </div>
      )}

      {encryption.status === 'completed' && (
        <div className="mt-4 p-3 bg-[var(--success-muted)] rounded-[var(--radius-md)] text-center">
          <p className="text-xs text-[var(--success)]">
            Sale completed
          </p>
        </div>
      )}
    </div>
  );
}
