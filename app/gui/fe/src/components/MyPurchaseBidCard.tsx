import { useState, memo } from 'react';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { truncateHex } from '../utils/truncate';
import { formatAda } from '../utils/formatAda';
import { BidStatusBadge } from './Badge';
import BidTimeline from './BidTimeline';
import InfoTooltip from './InfoTooltip';
import type { PurchaseStage } from './BidTimeline';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';

interface MyPurchaseBidCardProps {
  bid: BidDisplay;
  encryption?: EncryptionDisplay;
  onCancel?: (bid: BidDisplay) => void;
  onDecrypt?: (bid: BidDisplay) => void;
  compact?: boolean;
  purchaseStage?: PurchaseStage;
  decryptFailed?: boolean;
}

function MyPurchaseBidCard({
  bid,
  encryption,
  onCancel,
  onDecrypt,
  compact = false,
  purchaseStage,
  decryptFailed = false,
}: MyPurchaseBidCardProps) {
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isPending = bid.status === 'pending';
  const isAccepted = bid.status === 'accepted';
  const isRejected = bid.status === 'rejected';
  const isCancelled = bid.status === 'cancelled';

  // Get status message for non-pending states
  const getStatusMessage = () => {
    if (decryptFailed && isAccepted) return 'Decryption failed. Click Retry to try again.';
    if (isAccepted) return 'Your bid was accepted! You can now decrypt the message.';
    if (isRejected) return 'Your bid was not accepted.';
    if (isCancelled) return 'This bid was cancelled.';
    return null;
  };

  const getStatusTooltip = () => {
    if (isPending) return 'Waiting for the seller to accept or reject your bid. You can cancel at any time.';
    if (isAccepted) return 'The seller accepted your bid. Decrypt to claim the content.';
    if (isRejected) return 'The seller did not accept your bid.';
    if (isCancelled) return 'You cancelled this bid.';
    return '';
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
                  Bid on {truncateHex(bid.encryptionToken, 8, 4)}
                </span>
                <BidStatusBadge status={bid.status} />
                <InfoTooltip text={getStatusTooltip()} position="bottom" />
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

          {/* Timeline (compact) */}
          {purchaseStage && (
            <div className="flex-shrink-0 w-40 hidden lg:block">
              <BidTimeline stage={purchaseStage} bidStatus={bid.status} compact />
            </div>
          )}

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
                  Seller: {truncateHex(encryption.seller, 12, 8)}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {isPending && (
                <button
                  onClick={() => onCancel?.(bid)}
                  className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
                >
                  Cancel
                </button>
              )}
              {isAccepted && (
                <button
                  onClick={() => onDecrypt?.(bid)}
                  className={`px-3 py-1.5 text-sm font-medium text-white rounded-[var(--radius-md)] btn-base ${
                    decryptFailed
                      ? 'bg-[var(--warning)] hover:bg-[var(--warning)]/90'
                      : 'btn-success'
                  }`}
                >
                  {decryptFailed ? 'Retry' : 'Decrypt'}
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
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] hover:translate-y-[-1px] hover:shadow-[var(--shadow-md)] transition-all duration-150">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-[var(--text-muted)]">Bid on</span>
            <span className="text-xs font-mono text-[var(--text-secondary)] truncate">
              {truncateHex(bid.encryptionToken, 8, 4)}
            </span>
            <BidStatusBadge status={bid.status} />
            <InfoTooltip text={getStatusTooltip()} position="bottom" />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {isPending ? 'Placed' : isAccepted ? 'Won' : 'Placed'} {formatDate(bid.createdAt)}
          </p>
        </div>
      </div>

      {/* Bid Status Timeline */}
      {purchaseStage && (
        <div className="mb-4 px-2">
          <BidTimeline stage={purchaseStage} bidStatus={bid.status} />
        </div>
      )}

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
            {truncateHex(encryption.seller, 12, 8)}
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
          decryptFailed && isAccepted
            ? 'bg-[var(--warning-muted)]'
            : isAccepted
            ? 'bg-[var(--success-muted)]'
            : isRejected
            ? 'bg-[var(--error-muted)]'
            : 'bg-[var(--bg-secondary)]'
        }`}>
          <p className={`text-xs font-medium ${
            decryptFailed && isAccepted
              ? 'text-[var(--warning)]'
              : isAccepted
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
            className="w-full px-4 py-2 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
          >
            Cancel Bid
          </button>
        )}
        {isAccepted && (
          <button
            onClick={() => onDecrypt?.(bid)}
            className={`w-full px-4 py-2.5 text-sm font-medium text-white rounded-[var(--radius-md)] flex items-center justify-center gap-2 btn-base ${
              decryptFailed
                ? 'bg-[var(--warning)] hover:bg-[var(--warning)]/90'
                : 'btn-success'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {decryptFailed ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                />
              )}
            </svg>
            {decryptFailed ? 'Retry Decrypt' : 'Decrypt Message'}
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

function arePropsEqual(prev: MyPurchaseBidCardProps, next: MyPurchaseBidCardProps): boolean {
  return (
    prev.bid.tokenName === next.bid.tokenName &&
    prev.bid.status === next.bid.status &&
    prev.bid.amount === next.bid.amount &&
    prev.bid.encryptionToken === next.bid.encryptionToken &&
    prev.bid.createdAt === next.bid.createdAt &&
    prev.encryption?.tokenName === next.encryption?.tokenName &&
    prev.encryption?.status === next.encryption?.status &&
    prev.encryption?.description === next.encryption?.description &&
    prev.encryption?.seller === next.encryption?.seller &&
    prev.encryption?.suggestedPrice === next.encryption?.suggestedPrice &&
    prev.compact === next.compact &&
    prev.purchaseStage === next.purchaseStage &&
    prev.decryptFailed === next.decryptFailed &&
    prev.onCancel === next.onCancel &&
    prev.onDecrypt === next.onDecrypt
  );
}

export default memo(MyPurchaseBidCard, arePropsEqual);
