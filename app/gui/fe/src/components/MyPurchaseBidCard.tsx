import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { truncateHex } from '../utils/truncate';
import { formatAda } from '../utils/formatAda';
import { BidStatusBadge } from './Badge';
import BidTimeline from './BidTimeline';
import InfoTooltip from './InfoTooltip';
import type { PurchaseStage } from './BidTimeline';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';
import { formatDate } from '../utils/formatDate';
import ListingImage from './ListingImage';
import TransactionLink, { TransactionLinkInline } from './TransactionLink';
import { copyToClipboard } from '../utils/clipboard';

interface MyPurchaseBidCardProps {
  bid: BidDisplay;
  encryption?: EncryptionDisplay;
  onCancel?: (bid: BidDisplay) => void;
  onDecrypt?: (bid: BidDisplay) => void;
  onUpdateBid?: (bid: BidDisplay) => void;
  compact?: boolean;
  purchaseStage?: PurchaseStage;
  decryptFailed?: boolean;
}

function MyPurchaseBidCard({
  bid,
  encryption,
  onCancel,
  onDecrypt,
  onUpdateBid,
  compact = false,
  purchaseStage,
  decryptFailed = false,
}: MyPurchaseBidCardProps) {
  const { t } = useTranslation('common');
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [copiedSeller, setCopiedSeller] = useState(false);

  const handleCopySeller = async () => {
    if (!encryption?.sellerPkh) return;
    const success = await copyToClipboard(encryption.sellerPkh);
    if (success) {
      setCopiedSeller(true);
      setTimeout(() => setCopiedSeller(false), 1500);
    }
  };

  const isOptimistic = bid._optimistic === true;
  const isPending = bid.status === 'pending';
  const isAccepted = bid.status === 'accepted';
  const isRejected = bid.status === 'rejected';
  const isCancelled = bid.status === 'cancelled';
  const [now] = useState(Date.now);
  const isLocked = isPending && bid.lockedUntil > now;

  // Get status message for non-pending states
  const getStatusMessage = () => {
    if (decryptFailed && isAccepted) return t('card.statusDecryptFailed');
    if (isAccepted) return t('card.statusAccepted');
    if (isRejected) return t('card.statusRejected');
    if (isCancelled) return t('card.statusCancelled');
    return null;
  };

  const getStatusTooltip = () => {
    if (isPending && isLocked) {
      const unlockDate = new Date(bid.lockedUntil).toLocaleString();
      return t('card.tooltipPendingLocked', { date: unlockDate });
    }
    if (isPending) return t('card.tooltipPending');
    if (isAccepted) return t('card.tooltipAccepted');
    if (isRejected) return t('card.tooltipRejected');
    if (isCancelled) return t('card.tooltipCancelled');
    return '';
  };

  const statusMessage = getStatusMessage();

  if (compact) {
    return (
      <>
      <article className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-[var(--transition-fast)]">
        {/* Row 1: Info Icon + Tx Hash + Status */}
        <div className="flex items-center gap-2 mb-[var(--space-2)] min-w-0">
          <InfoTooltip text={getStatusTooltip()} position="bottom" />
          <TransactionLink txHash={bid.utxo.txHash} className="text-xs" />
          <span className="ml-auto" />
          <BidStatusBadge status={bid.status} />
          {isOptimistic && (
            <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20 animate-pulse flex-shrink-0">
              {t('card.awaitingConfirmation')}
            </span>
          )}
        </div>
        {/* Row 2: Description or date */}
        {encryption?.description ? (
          <p
            className="text-sm font-medium text-[var(--text-secondary)] truncate cursor-pointer hover:text-[var(--text-primary)] mb-[var(--space-2)] max-w-md relative z-10"
            onClick={() => setDescriptionModalOpen(true)}
            title={encryption.description}
          >
            {truncateDescription(encryption.description)}
          </p>
        ) : (
          <p className="text-xs text-[var(--text-muted)] mb-[var(--space-2)]">
            {isPending ? t('card.waitingForSeller') : formatDate(bid.createdAt)}
          </p>
        )}
        {/* Row 3: Price + Seller + Actions */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className={`text-lg font-semibold inline-flex items-center gap-[var(--space-1)] ${
              isAccepted ? 'text-[var(--success)]' : 'text-[var(--accent)]'
            }`}>
              {formatAda(bid.amount)} ADA
              {isPending && !isOptimistic && onUpdateBid && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUpdateBid(bid); }}
                  className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
                  title={t('card.updateBid')}
                    aria-label={t('card.updateBid')}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                  </svg>
                </button>
              )}
            </span>
            {encryption && (
              <span className="text-xs text-[var(--text-muted)] flex items-center gap-1" title={encryption.sellerPkh}>
                {truncateHex(encryption.sellerPkh, 8, 4)}
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopySeller(); }}
                  className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                  title={t('card.copySellerAddress')}
                  aria-label={t('card.copySellerAddress')}
                >
                  <svg className={`w-3 h-3${copiedSeller ? ' copy-check-animate' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {copiedSeller ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    )}
                  </svg>
                </button>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {isPending && !isOptimistic && (
              <button
                onClick={() => onCancel?.(bid)}
                disabled={isLocked}
                title={isLocked ? t('card.lockedUntil', { date: new Date(bid.lockedUntil).toLocaleString() }) : undefined}
                className={`px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary ${
                  isLocked
                    ? 'opacity-50 cursor-not-allowed text-[var(--text-muted)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)]'
                }`}
              >
                {isLocked ? t('card.locked') : t('card.cancel')}
              </button>
            )}
            {isAccepted && (
              <button
                data-tutorial="decrypt-button"
                onClick={() => onDecrypt?.(bid)}
                className={`px-3 py-1.5 text-sm font-medium text-white rounded-[var(--radius-md)] btn-base ${
                  decryptFailed
                    ? 'bg-[var(--warning)] hover:bg-[var(--warning)]/90'
                    : 'btn-success'
                }`}
              >
                {decryptFailed ? t('card.retry') : t('card.decrypt')}
              </button>
            )}
          </div>
        </div>
      </article>

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
    <article className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] hover:translate-y-[-1px] hover:shadow-[var(--shadow-md)] transition-all duration-[var(--transition-fast)]">
      {/* Header */}
      <div className="mb-4 space-y-1">
        {/* Row 1: Transaction Hash + Status */}
        <div className="flex items-center gap-2 min-w-0">
          <InfoTooltip text={getStatusTooltip()} position="bottom" />
          <TransactionLinkInline txHash={bid.utxo.txHash} className="text-xs font-mono tracking-wide truncate" />
          <BidStatusBadge status={bid.status} />
          {isOptimistic && (
            <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20 animate-pulse flex-shrink-0">
              {t('card.awaitingConfirmation')}
            </span>
          )}
        </div>
        {/* Row 2: Date */}
        <p className="text-xs text-[var(--text-muted)] text-center">
          {isPending || !isAccepted ? t('card.bidPlacedDate', { date: formatDate(bid.createdAt) }) : t('card.bidWonDate', { date: formatDate(bid.createdAt) })}
        </p>
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
            className="text-sm font-medium text-[var(--text-secondary)] line-clamp-1"
            title={encryption.description}
          >
            {truncateDescription(encryption.description)}
          </p>
        </div>
      )}

      {/* Listing Image */}
      <ListingImage
        tokenName={encryption?.tokenName ?? bid.encryptionToken}
        imageLink={encryption?.imageLink}
        size="md"
      />

      {/* Bid Amount */}
      <div className="text-center mb-4">
        <p className={`text-2xl font-semibold inline-flex items-center justify-center gap-[var(--space-1)] ${
          isAccepted ? 'text-[var(--success)]' : 'text-[var(--accent)]'
        }`}>
          {formatAda(bid.amount)} ADA
          {isPending && !isOptimistic && onUpdateBid && (
            <button
              onClick={(e) => { e.stopPropagation(); onUpdateBid(bid); }}
              className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
              title={t('card.updateBid')}
                    aria-label={t('card.updateBid')}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
              </svg>
            </button>
          )}
        </p>
      </div>

      {/* Seller Info */}
      {encryption && (
        <div className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)]">
          <span className="text-xs font-medium text-[var(--text-muted)]">{t('card.seller')}</span>
          <span className="text-sm font-mono text-[var(--text-secondary)] flex items-center gap-1" title={encryption.sellerPkh}>
            {truncateHex(encryption.sellerPkh, 12, 8)}
            <button
              onClick={(e) => { e.stopPropagation(); handleCopySeller(); }}
              className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              title={t('card.copySellerAddress')}
              aria-label={t('card.copySellerAddress')}
            >
              <svg className={`w-3 h-3${copiedSeller ? ' copy-check-animate' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {copiedSeller ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                )}
              </svg>
            </button>
          </span>
        </div>
      )}

      {/* Suggested Price Comparison */}
      {encryption?.suggestedPrice && (
        <div className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)]">
          <span className="text-xs text-[var(--text-muted)]">{t('card.suggestedPrice')}</span>
          <span className="text-sm text-[var(--text-secondary)]">
            {formatAda(encryption.suggestedPrice)} ADA
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

      {/* Lock Status */}
      {isPending && isLocked && (
        <div className="mt-4 p-3 rounded-[var(--radius-md)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          <p className="text-xs text-[var(--text-muted)]">
            {t('card.bidLockedUntil', { date: new Date(bid.lockedUntil).toLocaleString() })}
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-4 space-y-2">
        {isPending && !isOptimistic && (
          <button
            onClick={() => onCancel?.(bid)}
            disabled={isLocked}
            title={isLocked ? t('card.lockedUntil', { date: new Date(bid.lockedUntil).toLocaleString() }) : undefined}
            className={`w-full px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary ${
              isLocked
                ? 'opacity-50 cursor-not-allowed text-[var(--text-muted)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)]'
            }`}
          >
            {isLocked ? t('card.bidLocked') : t('card.cancelBid')}
          </button>
        )}
        {isAccepted && (
          <button
            data-tutorial="decrypt-button"
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
            {decryptFailed ? t('card.retryDecrypt') : t('card.decryptMessage')}
          </button>
        )}
      </div>
    </article>

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
    prev.encryption?.sellerPkh === next.encryption?.sellerPkh &&
    prev.encryption?.suggestedPrice === next.encryption?.suggestedPrice &&
    prev.compact === next.compact &&
    prev.purchaseStage === next.purchaseStage &&
    prev.decryptFailed === next.decryptFailed &&
    prev.onCancel === next.onCancel &&
    prev.onDecrypt === next.onDecrypt &&
    prev.onUpdateBid === next.onUpdateBid
  );
}

export default memo(MyPurchaseBidCard, arePropsEqual);
