import { useState } from 'react';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { BidStatusBadge } from './Badge';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';

interface MyPurchaseBidCardProps {
  bid: BidDisplay;
  encryption?: EncryptionDisplay;
  onCancel?: (bid: BidDisplay) => void;
  onDecrypt?: (bid: BidDisplay) => void;
  compact?: boolean;
}

export default function MyPurchaseBidCard({
  bid,
  encryption,
  onCancel,
  onDecrypt,
  compact = false,
}: MyPurchaseBidCardProps) {
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);

  const truncateToken = (token: string) => {
    if (!token) return '';
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  };

  const truncateAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatAda = (lovelace: number): string => {
    const ada = lovelace / 1_000_000;
    return ada.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  };

  const isPending = bid.status === 'pending';
  const isAccepted = bid.status === 'accepted';
  const isRejected = bid.status === 'rejected';
  const isCancelled = bid.status === 'cancelled';

  // Get status message for non-pending states
  const getStatusMessage = () => {
    if (isAccepted) return 'Your bid was accepted! You can now decrypt the message.';
    if (isRejected) return 'Your bid was not accepted.';
    if (isCancelled) return 'This bid was cancelled.';
    return null;
  };

  const statusMessage = getStatusMessage();

  if (compact) {
    return (
      <>
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Bid info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Bid icon */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              isAccepted
                ? 'bg-[var(--success-muted)]'
                : isPending
                ? 'bg-[var(--warning-muted)]'
                : 'bg-[var(--bg-secondary)]'
            }`}>
              <svg
                className={`w-5 h-5 ${
                  isAccepted
                    ? 'text-[var(--success)]'
                    : isPending
                    ? 'text-[var(--warning)]'
                    : 'text-[var(--text-muted)]'
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-xs font-mono text-[var(--text-muted)]">
                  Bid on {truncateToken(bid.encryptionToken)}
                </span>
                <BidStatusBadge status={bid.status} />
              </div>
              {encryption?.description && (
                <p
                  className="text-sm text-[var(--text-secondary)] truncate cursor-pointer hover:text-[var(--text-primary)]"
                  onClick={() => setDescriptionModalOpen(true)}
                >
                  {truncateDescription(encryption.description)}
                </p>
              )}
              {!encryption?.description && (
                <p className="text-xs text-[var(--text-muted)]">
                  {isPending ? 'Waiting for seller' : formatDate(bid.createdAt)}
                </p>
              )}
            </div>
          </div>

          {/* Middle: Amount & Seller */}
          <div className="flex items-center gap-6 flex-shrink-0">
            <div className="text-right">
              <span className={`text-lg font-semibold ${
                isAccepted ? 'text-[var(--success)]' : 'text-[var(--accent)]'
              }`}>
                {formatAda(bid.amount)} ADA
              </span>
              {encryption && (
                <p className="text-xs text-[var(--text-muted)]">
                  Seller: {truncateAddress(encryption.seller)}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {isPending && (
                <button
                  onClick={() => onCancel?.(bid)}
                  className="px-3 py-1.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
                >
                  Cancel
                </button>
              )}
              {isAccepted && (
                <button
                  onClick={() => onDecrypt?.(bid)}
                  className="px-3 py-1.5 text-sm font-medium bg-[var(--success)] text-white rounded-[var(--radius-md)] hover:bg-[var(--success)]/90 transition-all duration-150 cursor-pointer"
                >
                  Decrypt
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <DescriptionModal
        isOpen={descriptionModalOpen}
        onClose={() => setDescriptionModalOpen(false)}
        description={encryption?.description || ''}
        tokenName={encryption?.tokenName}
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
            <span className="text-xs text-[var(--text-muted)]">Bid on</span>
            <span className="text-xs font-mono text-[var(--text-secondary)] truncate">
              {truncateToken(bid.encryptionToken)}
            </span>
            <BidStatusBadge status={bid.status} />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {isPending ? 'Placed' : isAccepted ? 'Won' : 'Placed'} {formatDate(bid.createdAt)}
          </p>
        </div>
      </div>

      {/* Encryption Description (if available) */}
      {encryption?.description && (
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

      {/* Amount Icon */}
      <div className="flex justify-center py-4">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
          isAccepted
            ? 'bg-[var(--success-muted)]'
            : isPending
            ? 'bg-[var(--warning-muted)]'
            : 'bg-[var(--bg-secondary)]'
        }`}>
          <svg
            className={`w-7 h-7 ${
              isAccepted
                ? 'text-[var(--success)]'
                : isPending
                ? 'text-[var(--warning)]'
                : 'text-[var(--text-muted)]'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      </div>

      {/* Bid Amount */}
      <div className="text-center mb-4">
        <p className={`text-2xl font-semibold ${
          isAccepted ? 'text-[var(--success)]' : 'text-[var(--accent)]'
        }`}>
          {formatAda(bid.amount)} ADA
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1">Your Bid</p>
      </div>

      {/* Seller Info */}
      {encryption && (
        <div className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)]">
          <span className="text-xs text-[var(--text-muted)]">Seller</span>
          <span className="text-sm font-mono text-[var(--text-secondary)]">
            {truncateAddress(encryption.seller)}
          </span>
        </div>
      )}

      {/* Suggested Price Comparison */}
      {encryption?.suggestedPrice && (
        <div className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)]">
          <span className="text-xs text-[var(--text-muted)]">Suggested Price</span>
          <span className="text-sm text-[var(--text-secondary)]">
            {encryption.suggestedPrice.toLocaleString()} ADA
          </span>
        </div>
      )}

      {/* Status Message */}
      {statusMessage && (
        <div className={`mt-4 p-3 rounded-[var(--radius-md)] ${
          isAccepted
            ? 'bg-[var(--success-muted)]'
            : isRejected
            ? 'bg-[var(--error-muted)]'
            : 'bg-[var(--bg-secondary)]'
        }`}>
          <p className={`text-xs font-medium ${
            isAccepted
              ? 'text-[var(--success)]'
              : isRejected
              ? 'text-[var(--error)]'
              : 'text-[var(--text-muted)]'
          }`}>
            {statusMessage}
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-4 space-y-2">
        {isPending && (
          <button
            onClick={() => onCancel?.(bid)}
            className="w-full px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
          >
            Cancel Bid
          </button>
        )}
        {isAccepted && (
          <button
            onClick={() => onDecrypt?.(bid)}
            className="w-full px-4 py-2.5 text-sm font-medium bg-[var(--success)] text-white rounded-[var(--radius-md)] hover:bg-[var(--success)]/90 transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
              />
            </svg>
            Decrypt Message
          </button>
        )}
      </div>
    </div>

    <DescriptionModal
      isOpen={descriptionModalOpen}
      onClose={() => setDescriptionModalOpen(false)}
      description={encryption?.description || ''}
      tokenName={encryption?.tokenName}
    />
    </>
  );
}
