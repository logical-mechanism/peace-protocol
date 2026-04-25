import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptionDisplay } from '../services/api';
import { getTopLevelCategory } from '../config/categories';
import { copyToClipboard } from '../utils/clipboard';
import { truncateHex } from '../utils/truncate';
import { EncryptionStatusBadge } from './Badge';
import DescriptionModal from './DescriptionModal';
import ListingImage from './ListingImage';
import { truncateDescription } from './descriptionUtils';
import HighlightText from './HighlightText';
import { formatDate } from '../utils/formatDate';
import { formatPrice } from '../utils/formatListing';
import TransactionLink, { TransactionLinkInline } from './TransactionLink';
import type { CardSize } from '../hooks/useTabFilterState';


interface EncryptionCardProps {
  encryption: EncryptionDisplay;
  onPlaceBid?: (encryption: EncryptionDisplay, bidCount: number) => void;
  isOwnListing?: boolean;
  hasBid?: boolean;
  compact?: boolean;
  cardSize?: CardSize;
  initialCached?: boolean;
  initialBanned?: boolean;
  bidCount?: number;
  lovelace?: string | null;
  isFavorite?: boolean;
  onToggleFavorite?: (tokenName: string) => void;
  onFilterBySeller?: (sellerPkh: string) => void;
  onFilterByCategory?: (category: string) => void;
  searchQuery?: string;
  nsfwEnabled?: boolean;
  /** When true, sets id="tutorial-place-bid" on the Place Bid button so the bid tutorial can target it. */
  tutorialTarget?: boolean;
}

function EncryptionCard({
  encryption,
  onPlaceBid,
  isOwnListing = false,
  hasBid = false,
  compact = false,
  cardSize = 'medium',
  initialCached = false,
  initialBanned = false,
  bidCount = 0,
  lovelace,
  isFavorite = false,
  onToggleFavorite,
  onFilterBySeller,
  onFilterByCategory,
  searchQuery = '',
  nsfwEnabled = false,
  tutorialTarget = false,
}: EncryptionCardProps) {
  const { t } = useTranslation('common');
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [initialBidCount] = useState(bidCount);
  const [copied, setCopied] = useState(false);
  const [favPulseKey, setFavPulseKey] = useState(0);

  const hasBidPulse = bidCount > initialBidCount;

  const hasLowBalance = lovelace !== undefined && (lovelace === null || parseInt(lovelace) < 2_000_000);
  const isOptimistic = encryption._optimistic === true;
  const canBid = encryption.status === 'active' && !isOwnListing && !hasBid && !isOptimistic;

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

  const handleFilterBySeller = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFilterBySeller?.(encryption.sellerPkh);
  };

  const handleFilterByCategory = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFilterByCategory?.(encryption.category || 'text');
  };

  if (compact) {
    return (
      <>
        <article className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-[var(--space-md)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-[var(--transition-fast)] relative z-0">
          {/* Row 1: Star + Tx Hash + Category + Status */}
          <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-2)] min-w-0">
            {onToggleFavorite && (
              <button
                onClick={handleToggleFavorite}
                className="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer flex-shrink-0"
                title={isFavorite ? t('card.removeFromFavorites') : t('card.addToFavorites')}
                aria-label={isFavorite ? t('card.removeFromFavorites') : t('card.addToFavorites')}
                aria-pressed={isFavorite}
              >
                <svg key={favPulseKey} className={`w-3.5 h-3.5${favPulseKey > 0 ? ' fav-pulse' : ''}`} fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
            )}
            <TransactionLink txHash={encryption.utxo.txHash} className="text-xs" />
            {onFilterByCategory ? (
              <button
                type="button"
                onClick={handleFilterByCategory}
                title={t('card.filterByCategory', { category: t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`) })}
                aria-label={t('card.filterByCategoryAria', { category: t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`) })}
                className="ml-auto text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors duration-[var(--transition-fast)] cursor-pointer flex-shrink-0"
              >
                {t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`)}
              </button>
            ) : (
              <span className="ml-auto text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)] flex-shrink-0">
                {t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`)}
              </span>
            )}
            {encryption.nsfw && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--error)] text-white flex-shrink-0">{t('card.nsfwBadge')}</span>
            )}
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
              className="text-sm font-medium text-[var(--text-secondary)] line-clamp-1 mb-[var(--space-2)] cursor-pointer hover:text-[var(--text-primary)] relative z-10 max-w-md"
              onClick={() => setDescriptionModalOpen(true)}
              title={encryption.description}
            >
              <HighlightText text={truncateDescription(encryption.description)} query={searchQuery} />
            </p>
          )}
          {/* Row 3: Price + Action */}
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-[var(--accent)]">
              {formatPrice(encryption.suggestedPrice)}
            </span>
            {canBid && onPlaceBid && (
              <div className="flex items-center gap-[var(--space-2)]">
                <button
                  id={tutorialTarget ? 'tutorial-place-bid' : undefined}
                  onClick={() => !hasLowBalance && onPlaceBid(encryption, bidCount)}
                  disabled={hasLowBalance}
                  title={hasLowBalance ? t('card.insufficientBalanceMinimum') : undefined}
                  className={`px-[var(--space-3)] py-1.5 text-sm font-medium rounded-[var(--radius-md)] btn-base ${hasLowBalance ? 'cursor-not-allowed bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]' : 'btn-primary'}`}
                >
                  {t('card.bid')}
                </button>
                {hasLowBalance && (
                  <span className="text-xs text-[var(--error)]">{t('card.insufficientBalance')}</span>
                )}
              </div>
            )}
            {hasBid && encryption.status === 'active' && !isOwnListing && (
              <span className="px-[var(--space-3)] py-1.5 text-sm font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                {t('card.bidPlaced')}
              </span>
            )}
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

  const padClass = cardSize === 'small' ? 'p-[var(--space-sm)]' : cardSize === 'large' ? 'p-[var(--space-xl)]' : 'p-[var(--space-lg)]';
  const mbClass = cardSize === 'small' ? 'mb-[var(--space-sm)]' : cardSize === 'large' ? 'mb-[var(--space-lg)]' : 'mb-[var(--space-md)]';
  const priceClass = cardSize === 'small' ? 'text-lg' : cardSize === 'large' ? 'text-3xl' : 'text-2xl';
  const descClamp = cardSize === 'small' ? 'line-clamp-1' : cardSize === 'large' ? 'line-clamp-3' : 'line-clamp-1';
  const imgSize = 'md' as const;

  return (
    <>
      <article className={`bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] ${padClass} hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] hover:translate-y-[-1px] hover:shadow-[var(--shadow-md)] transition-all duration-[var(--transition-fast)]`}>
        {/* Header */}
        <div className={`${mbClass} space-y-[var(--space-1)]`}>
          {/* Row 1: Star + Status + Transaction Hash */}
          <div className="flex items-center gap-[var(--space-2)] min-w-0">
            {onToggleFavorite && (
              <button
                onClick={handleToggleFavorite}
                className="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer flex-shrink-0"
                title={isFavorite ? t('card.removeFromFavorites') : t('card.addToFavorites')}
                aria-label={isFavorite ? t('card.removeFromFavorites') : t('card.addToFavorites')}
                aria-pressed={isFavorite}
              >
                <svg key={favPulseKey} className={`w-4 h-4${favPulseKey > 0 ? ' fav-pulse' : ''}`} fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
            )}
            <TransactionLinkInline txHash={encryption.utxo.txHash} className="text-xs font-mono tracking-wide truncate" />
            <EncryptionStatusBadge status={encryption.status} />
            {isOptimistic && (
              <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-muted)] text-[var(--warning)] border border-[var(--warning)]/20 animate-pulse flex-shrink-0">
                {t('card.awaitingConfirmation')}
              </span>
            )}
          </div>
          {/* Row 2: Category (left) + Bid Count (right) */}
          <div className="flex items-center justify-between">
            {onFilterByCategory ? (
              <button
                type="button"
                onClick={handleFilterByCategory}
                title={t('card.filterByCategory', { category: t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`) })}
                aria-label={t('card.filterByCategoryAria', { category: t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`) })}
                className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
              >
                {t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`)}
              </button>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] border bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)]">
                {t(`common:categories.${getTopLevelCategory(encryption.category || 'text')}`)}
              </span>
            )}
            {bidCount > 0 ? (
              <span
                key={bidCount}
                className={`text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-muted)] text-[var(--accent)] font-medium${hasBidPulse ? ' bid-pulse' : ''}`}
              >
                {t('card.bid', { count: bidCount })}
              </span>
            ) : (
              <span className="text-xs text-[var(--text-muted)]">{t('card.noBids')}</span>
            )}
          </div>
          {/* Row 3: Listed Date */}
          <p className="text-xs text-[var(--text-muted)] text-center">
            {t('card.listed', { date: formatDate(encryption.createdAt) })}
          </p>
        </div>

        {/* Description */}
        {encryption.description && (
          <div
            className={`${mbClass} p-[var(--space-3)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-elevated)] hover:border-[var(--border-default)]`}
            onClick={() => setDescriptionModalOpen(true)}
          >
            <p
              className={`text-sm font-medium text-[var(--text-secondary)] ${descClamp}`}
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
          size={imgSize}
          initialCached={initialCached}
          initialBanned={initialBanned}
          nsfw={encryption.nsfw}
          nsfwEnabled={nsfwEnabled}
        />

        {/* Price */}
        <div className={`text-center ${mbClass}`}>
          <p className={`${priceClass} font-semibold text-[var(--accent)]`}>
            {formatPrice(encryption.suggestedPrice)}
          </p>
        </div>

        {/* Seller Info */}
        <div className="flex items-center justify-between py-[var(--space-3)] border-t border-[var(--border-subtle)]">
          <span className="text-xs font-medium text-[var(--text-muted)]">{t('card.seller')}</span>
          <div className="flex items-center gap-1.5">
            {onFilterBySeller ? (
              <button
                type="button"
                onClick={handleFilterBySeller}
                title={t('card.filterBySeller')}
                aria-label={t('card.filterBySellerAria')}
                className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--accent)] hover:underline transition-colors duration-[var(--transition-fast)] cursor-pointer"
              >
                <HighlightText text={truncateHex(encryption.sellerPkh, 10, 6)} query={searchQuery} />
              </button>
            ) : (
              <span className="text-xs font-mono text-[var(--text-secondary)]">
                <HighlightText text={truncateHex(encryption.sellerPkh, 10, 6)} query={searchQuery} />
              </span>
            )}
            <button
              onClick={handleCopySeller}
              className="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer"
              title={t('card.copySellerAddress')}
              aria-label={t('card.copySellerAddress')}
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
              id={tutorialTarget ? 'tutorial-place-bid' : undefined}
              onClick={() => !hasLowBalance && onPlaceBid(encryption, bidCount)}
              disabled={hasLowBalance}
              title={hasLowBalance ? t('card.insufficientBalanceMinimum') : undefined}
              className={`w-full mt-[var(--space-md)] px-[var(--space-md)] py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base ${hasLowBalance ? 'cursor-not-allowed bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]' : 'btn-primary'}`}
            >
              {hasLowBalance ? t('card.insufficientBalanceButton') : t('card.placeBid')}
            </button>
            {hasLowBalance && (
              <p className="mt-[var(--space-1)] text-center text-xs text-[var(--error)]">{t('card.insufficientBalance')}</p>
            )}
          </>
        )}

        {hasBid && encryption.status === 'active' && !isOwnListing && (
          <div className="mt-[var(--space-md)] text-center text-xs text-[var(--text-muted)]">
            {t('card.youHaveBidOnListing')}
          </div>
        )}

        {isOwnListing && (
          <div className="mt-[var(--space-md)] text-center text-xs text-[var(--text-muted)]">
            {t('card.thisIsYourListing')}
          </div>
        )}

        {encryption.status === 'pending' && (
          <div className="mt-[var(--space-md)] p-[var(--space-3)] bg-[var(--warning-muted)] rounded-[var(--radius-md)] text-center">
            <p className="text-xs text-[var(--warning)]">{t('card.saleInProgress')}</p>
          </div>
        )}

        {encryption.status === 'completed' && (
          <div className="mt-[var(--space-md)] p-[var(--space-3)] bg-[var(--success-muted)] rounded-[var(--radius-md)] text-center">
            <p className="text-xs text-[var(--success)]">{t('card.saleCompleted')}</p>
          </div>
        )}
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

function arePropsEqual(prev: EncryptionCardProps, next: EncryptionCardProps): boolean {
  return (
    prev.encryption.tokenName === next.encryption.tokenName &&
    prev.encryption.status === next.encryption.status &&
    prev.encryption.suggestedPrice === next.encryption.suggestedPrice &&
    prev.encryption.imageLink === next.encryption.imageLink &&
    prev.encryption.description === next.encryption.description &&
    prev.encryption.category === next.encryption.category &&
    prev.encryption.nsfw === next.encryption.nsfw &&
    prev.encryption.createdAt === next.encryption.createdAt &&
    prev.nsfwEnabled === next.nsfwEnabled &&
    prev.bidCount === next.bidCount &&
    prev.compact === next.compact &&
    prev.cardSize === next.cardSize &&
    prev.isOwnListing === next.isOwnListing &&
    prev.hasBid === next.hasBid &&
    prev.isFavorite === next.isFavorite &&
    prev.searchQuery === next.searchQuery &&
    prev.lovelace === next.lovelace &&
    prev.initialCached === next.initialCached &&
    prev.initialBanned === next.initialBanned &&
    prev.onPlaceBid === next.onPlaceBid &&
    prev.onToggleFavorite === next.onToggleFavorite &&
    prev.onFilterBySeller === next.onFilterBySeller &&
    prev.onFilterByCategory === next.onFilterByCategory &&
    prev.tutorialTarget === next.tutorialTarget
  );
}

export default memo(EncryptionCard, arePropsEqual);
