import { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptionDisplay } from '../services/api';
import { EncryptionStatusBadge } from './Badge';
import DescriptionModal from './DescriptionModal';
import ListingImage from './ListingImage';
import { truncateDescription } from './descriptionUtils';
import { formatRelativeTime } from '../utils/time';
import { formatPrice } from '../utils/formatListing';
import TransactionLink, { TransactionLinkInline } from './TransactionLink';
import type { CardSize } from '../hooks/useTabFilterState';

interface SalesListingCardProps {
  encryption: EncryptionDisplay;
  bidCount: number;
  onViewBids?: (encryption: EncryptionDisplay) => void;
  onRemove?: (encryption: EncryptionDisplay) => void;
  onUpdatePrice?: (encryption: EncryptionDisplay) => void;
  onCancelPending?: (encryption: EncryptionDisplay) => void;
  onCompleteSale?: (encryption: EncryptionDisplay) => void;
  compact?: boolean;
  cardSize?: CardSize;
  initialCached?: boolean;
  initialBanned?: boolean;
  nsfwEnabled?: boolean;
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
  cardSize = 'medium',
  initialCached = false,
  initialBanned = false,
  nsfwEnabled = false,
}: SalesListingCardProps) {
  const { t } = useTranslation('common');
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
    if (!storageLayer) return t('storageLayer.none');
    if (storageLayer === 'on-chain') return t('storageLayer.onChain');
    if (storageLayer === 'iagon') return t('storageLayer.iagon');
    if (storageLayer.startsWith('ipfs://')) return t('storageLayer.ipfs');
    if (storageLayer.startsWith('arweave://')) return t('storageLayer.arweave');
    return t('storageLayer.none');
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

    if (remaining <= 0) return t('card.expired');

    const minutes = Math.floor(remaining / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return t('card.timeRemainingWithHours', { hours, minutes: minutes % 60 });
    }
    return t('card.minutesRemaining', { minutes });
  };

  const pendingTTL = getPendingTTL();
  const isActive = encryption.status === 'active';
  const isPending = encryption.status === 'pending';
  const isCompleted = encryption.status === 'completed';
  if (compact) {
    return (
      <>
        <article className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-[var(--space-md)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-[var(--transition-fast)]">
          {/* Row 1: Spacer + Tx Hash + Storage + Status */}
          <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-2)] min-w-0">
            <div className="w-5 flex-shrink-0" />
            <TransactionLink txHash={encryption.utxo.txHash} className="text-xs" />
            <span
              className={`ml-auto text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border flex-shrink-0 ${
                isUnknownStorageLayer(encryption.storageLayer)
                  ? 'bg-[var(--warning-muted)] text-[var(--warning)] border-[var(--warning)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]'
              }`}
            >
              {getStorageLayerLabel(encryption.storageLayer)}
            </span>
            <EncryptionStatusBadge status={encryption.status} />
            {isOptimistic && (
              <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20 animate-pulse flex-shrink-0">
                {t('card.awaitingConfirmation')}
              </span>
            )}
          </div>
          {/* Row 2: Description */}
          {encryption.description && (
            <p
              className="text-sm font-medium text-[var(--text-secondary)] truncate cursor-pointer hover:text-[var(--text-primary)] mb-[var(--space-2)] max-w-md relative z-10"
              onClick={() => setDescriptionModalOpen(true)}
              title={encryption.description}
            >
              {truncateDescription(encryption.description)}
            </p>
          )}
          {/* Row 3: Price + Actions */}
          <div className="flex items-center justify-between gap-[var(--space-md)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <span className="text-lg font-semibold text-[var(--accent)] inline-flex items-center gap-[var(--space-1)]">
                {formatPrice(encryption.suggestedPrice)}
                {isActive && !isOptimistic && onUpdatePrice && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onUpdatePrice(encryption); }}
                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
                    title={t('card.updatePrice')}
                    aria-label={t('card.updatePrice')}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                    </svg>
                  </button>
                )}
              </span>
              {isPending && pendingTTL && (
                <span className="text-xs text-[var(--warning)]">{pendingTTL}</span>
              )}
            </div>

            <div className="flex gap-[var(--space-2)]">
                {isActive && !isOptimistic && (
                  <>
                    <button
                      onClick={() => onViewBids?.(encryption)}
                      className="px-[var(--space-3)] py-1.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                    >
                      {t('card.viewBids')}
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
                      title={t('card.removeListing')}
                    >
                      {t('card.remove')}
                    </button>
                  </>
                )}
                {isPending && (
                  <>
                    <button
                      onClick={() => onCompleteSale?.(encryption)}
                      className="px-[var(--space-3)] py-1.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-success"
                    >
                      {t('card.completeSale')}
                    </button>
                    <button
                      onClick={() => onCancelPending?.(encryption)}
                      className="px-[var(--space-3)] py-1.5 text-sm rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] btn-base btn-tertiary"
                    >
                      {t('card.cancel')}
                    </button>
                  </>
                )}
            </div>
          </div>
        </article>

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

  const innerPadClass = cardSize === 'small' ? 'p-[var(--space-sm)]' : cardSize === 'large' ? 'p-[var(--space-lg)]' : 'p-[var(--space-md)]';
  const priceClass = cardSize === 'small' ? 'text-lg' : cardSize === 'large' ? 'text-3xl' : 'text-2xl';
  const descClamp = cardSize === 'small' ? 'line-clamp-1' : cardSize === 'large' ? 'line-clamp-3' : 'line-clamp-2';

  return (
    <>
      <article className="h-full flex flex-col bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden hover:border-[var(--accent)] hover:shadow-[var(--shadow-glow)] transition-all duration-[var(--transition-base)]">
        {/* Image banner with status overlay */}
        <div className="relative">
          <ListingImage
            tokenName={encryption.tokenName}
            imageLink={encryption.imageLink}
            size="md"
            initialCached={initialCached}
            initialBanned={initialBanned}
            nsfw={encryption.nsfw}
            nsfwEnabled={nsfwEnabled}
          />
          <div className="absolute top-[var(--space-2)] right-[var(--space-2)] flex items-center gap-[var(--space-1)] px-1 py-0.5 bg-[var(--bg-card)]/70 backdrop-blur-sm rounded-[var(--radius-md)]">
            <EncryptionStatusBadge status={encryption.status} />
            {isOptimistic && (
              <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20 animate-pulse">
                {t('card.awaitingConfirmation')}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={`${innerPadClass} flex-1 flex flex-col`}>
          {/* Hero: price + storage layer */}
          <div className="flex items-center justify-between mb-[var(--space-3)] gap-[var(--space-2)]">
            <p className={`${priceClass} font-semibold text-[var(--accent)] inline-flex items-center gap-[var(--space-1)] leading-none`}>
              {formatPrice(encryption.suggestedPrice)}
              {isActive && !isOptimistic && onUpdatePrice && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUpdatePrice(encryption); }}
                  className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
                  title={t('card.updatePrice')}
                  aria-label={t('card.updatePrice')}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                  </svg>
                </button>
              )}
            </p>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] flex-shrink-0 ${
                isUnknownStorageLayer(encryption.storageLayer)
                  ? 'bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
              }`}
            >
              {getStorageLayerLabel(encryption.storageLayer)}
            </span>
          </div>

          {/* Description (no sub-card frame) */}
          {encryption.description && (
            <p
              onClick={() => setDescriptionModalOpen(true)}
              className={`text-sm text-[var(--text-secondary)] ${descClamp} mb-[var(--space-3)] cursor-pointer hover:text-[var(--text-primary)] transition-colors duration-[var(--transition-fast)]`}
              title={encryption.description}
            >
              {truncateDescription(encryption.description)}
            </p>
          )}

          {/* Pending Status Info (with TTL countdown) */}
          {isPending && (
            <div className="p-[var(--space-3)] bg-[var(--warning-muted)] rounded-[var(--radius-md)] mb-[var(--space-3)]">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--warning)]">{t('card.saleInProgress')}</p>
                {pendingTTL && (
                  <p className="text-xs text-[var(--warning)]">{pendingTTL}</p>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-[var(--space-1)]">
                {t('card.completeSaleBeforeCancel')}
              </p>
            </div>
          )}

          {/* Completed Status Info */}
          {isCompleted && (
            <div className="p-[var(--space-3)] bg-[var(--success-muted)] rounded-[var(--radius-md)] text-center mb-[var(--space-3)]">
              <p className="text-xs font-medium text-[var(--success)]">{t('card.saleCompleted')}</p>
            </div>
          )}

          {/* Action Buttons */}
          {isActive && !isOptimistic && (
            <div className="flex items-center gap-[var(--space-2)]">
              <button
                onClick={() => onViewBids?.(encryption)}
                className="flex-1 px-[var(--space-md)] py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-[var(--space-2)] btn-base btn-primary"
              >
                <span>{t('card.viewBids')}</span>
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
                className="p-2 rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-muted)] btn-base"
                title={t('card.removeListing')}
                aria-label={t('card.removeListing')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
          {isPending && (
            <div className="flex items-center gap-[var(--space-2)]">
              <button
                onClick={() => onCompleteSale?.(encryption)}
                className="flex-1 px-[var(--space-md)] py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-success"
              >
                {t('card.completeSale')}
              </button>
              <button
                onClick={() => onCancelPending?.(encryption)}
                className="p-2 rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-muted)] btn-base"
                title={t('card.cancelPendingSale')}
                aria-label={t('card.cancelPendingSale')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Footer — dot-separated meta, pinned to card bottom */}
          <div className="mt-auto pt-[var(--space-3)] border-t border-[var(--border-subtle)] flex items-center gap-[var(--space-2)] text-xs text-[var(--text-muted)] flex-wrap">
            <TransactionLinkInline txHash={encryption.utxo.txHash} className="text-xs font-mono" />
            <span aria-hidden="true">·</span>
            <span>{t('card.created', { date: formatRelativeTime(encryption.createdAt) })}</span>
          </div>
        </div>
      </article>

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
    prev.cardSize === next.cardSize &&
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
