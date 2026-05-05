import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryItem } from '../services/libraryService';
import { truncateHex } from '../utils/truncate';
import { formatBytes } from '../utils/formatBytes';
import Badge from './Badge';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';
import { getContentType } from '../utils/contentType';
import { getTopLevelCategory } from '../config/categories';
import { formatDate } from '../utils/formatDate';
import { copyToClipboard } from '../utils/clipboard';
import ListingImage from './ListingImage';
import HighlightText from './HighlightText';
import type { CardSize } from '../hooks/useTabFilterState';

interface LibraryCardProps {
  item: LibraryItem;
  onView: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
  onRelist?: (item: LibraryItem) => void;
  searchQuery?: string;
  compact?: boolean;
  cardSize?: CardSize;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (tokenName: string) => void;
}


// Category labels are resolved via i18n in the component below


function CategoryIcon({ category, fileExtension, size = 'md' }: { category: string; fileExtension?: string; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';
  const contentType = getContentType(category, fileExtension);

  switch (contentType) {
    case 'text':
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'pdf':
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          <text x="12" y="17.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="5.5" fontWeight="bold" fontFamily="sans-serif">PDF</text>
        </svg>
      );
    case 'document':
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'audio':
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
        </svg>
      );
    case 'image':
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
      );
    case 'video':
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9.75a2.25 2.25 0 002.25-2.25V7.5a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
        </svg>
      );
    default:
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
  }
}

function LibraryCard({
  item,
  onView,
  onDelete,
  onRelist,
  searchQuery = '',
  compact = false,
  cardSize = 'medium',
  selectMode = false,
  selected = false,
  onToggleSelect,
}: LibraryCardProps) {
  const { t } = useTranslation('common');
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [copiedSeller, setCopiedSeller] = useState(false);

  const sellerPkh = item.sellerPkh ?? '';

  const handleCopySeller = async () => {
    if (!sellerPkh) return;
    const success = await copyToClipboard(sellerPkh);
    if (success) {
      setCopiedSeller(true);
      setTimeout(() => setCopiedSeller(false), 1500);
    }
  };

  if (compact) {
    return (
      <>
        <article
          className={`bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-4 transition-all duration-[var(--transition-fast)] ${
            selected
              ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
              : 'border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)]'
          } ${selectMode ? 'cursor-pointer' : ''}`}
          onClick={selectMode ? () => onToggleSelect?.(item.tokenName) : undefined}
        >
          <div className="flex items-center justify-between gap-4">
            {/* Left: Checkbox + Icon + Info */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect?.(item.tokenName)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer flex-shrink-0"
                  aria-label={t('library.selectItem', { name: item.tokenName })}
                />
              )}
              {item.imageLink ? (
                <ListingImage
                  tokenName={item.tokenName}
                  imageLink={item.imageLink}
                  size="sm"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[var(--accent-muted)] flex items-center justify-center text-[var(--accent)] flex-shrink-0">
                  <CategoryIcon category={item.category} fileExtension={item.fileExtension} size="sm" />
                </div>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-xs font-mono text-[var(--text-muted)]" title={item.tokenName}>
                    {truncateHex(item.tokenName, 8, 4)}
                  </span>
                  <Badge variant="neutral">{t(`common:categories.${getTopLevelCategory(item.category || 'text')}`)}</Badge>
                  {item.contentMissing && (
                    <Badge variant="warning">{t('library.missingBadge')}</Badge>
                  )}
                </div>
                {item.description && (
                  <p
                    className="text-sm font-medium text-[var(--text-secondary)] truncate cursor-pointer hover:text-[var(--text-primary)] max-w-md relative z-10"
                    onClick={() => setDescriptionModalOpen(true)}
                    title={item.description}
                  >
                    {searchQuery ? (
                      <HighlightText text={truncateDescription(item.description)} query={searchQuery} />
                    ) : (
                      truncateDescription(item.description)
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Middle: Seller, Date, Size */}
            <div className="flex items-center gap-6 flex-shrink-0">
              <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs text-right">
                {sellerPkh && (
                  <>
                    <span className="text-[var(--text-muted)]">{t('card.seller')}</span>
                    <span className="font-mono text-[var(--text-muted)] flex items-center justify-end gap-1" title={sellerPkh}>
                      {truncateHex(sellerPkh, 8, 4)}
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
                  </>
                )}
                <span className="text-[var(--text-muted)]">{t('library.date')}</span>
                <span className="text-[var(--text-muted)]">{formatDate(item.decryptedAt)}</span>
                {item.fileSize != null && (
                  <>
                    <span className="text-[var(--text-muted)]">{t('library.size')}</span>
                    <span className="text-[var(--text-muted)]">{formatBytes(item.fileSize)}</span>
                  </>
                )}
              </div>

              {/* Actions */}
              {!selectMode && (
                <div className="flex gap-2">
                  <button
                    onClick={() => onView(item)}
                    className="px-3 py-1.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
                  >
                    {t('library.view')}
                  </button>
                  {onRelist && !item.contentMissing && (
                    <button
                      onClick={() => onRelist(item)}
                      className="p-1.5 rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] btn-base"
                      title={t('library.createListingFromItem')}
                      aria-label={t('library.createListingFromItem')}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(item)}
                    className="p-1.5 rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-muted)] btn-base"
                    title={t('library.deleteFromLibrary')}
                    aria-label={t('library.deleteFromLibrary')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </article>

        <DescriptionModal
          isOpen={descriptionModalOpen}
          onClose={() => setDescriptionModalOpen(false)}
          description={item.description || ''}
          tokenName={item.tokenName}
        />
      </>
    );
  }

  const innerPadClass = cardSize === 'small' ? 'p-[var(--space-sm)]' : cardSize === 'large' ? 'p-[var(--space-lg)]' : 'p-[var(--space-md)]';
  const descClamp = cardSize === 'small' ? 'line-clamp-1' : cardSize === 'large' ? 'line-clamp-3' : 'line-clamp-2';
  // Image height/margin must match ListingImage size="md" (h-40 + my-4 + rounded-md)
  // exactly, otherwise cards-with-images render 32px taller than cards-without
  // and the grid loses equal-height rows. cardSize only controls inner content
  // density (padding, line-clamp), never the banner height.

  return (
    <>
      <article
        className={`h-full flex flex-col bg-[var(--bg-card)] border rounded-[var(--radius-lg)] overflow-hidden transition-all duration-[var(--transition-base)] ${
          selected
            ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
            : 'border-[var(--border-subtle)] hover:border-[var(--accent)] hover:shadow-[var(--shadow-glow)]'
        } ${selectMode ? 'cursor-pointer' : ''}`}
        onClick={selectMode ? () => onToggleSelect?.(item.tokenName) : undefined}
      >
        {/* Image banner (or category-icon panel) — pure visual, no overlays */}
        {item.imageLink ? (
          <ListingImage
            tokenName={item.tokenName}
            imageLink={item.imageLink}
            size="md"
          />
        ) : (
          <div className="w-full h-40 my-4 rounded-[var(--radius-md)] flex items-center justify-center bg-[var(--bg-secondary)]">
            <div className="w-14 h-14 rounded-full bg-[var(--accent-muted)] flex items-center justify-center text-[var(--accent)]">
              <CategoryIcon category={item.category} fileExtension={item.fileExtension} size="md" />
            </div>
          </div>
        )}

        {/* Content */}
        <div className={`${innerPadClass} flex-1 flex flex-col`}>
          {/* Status row: badges (left) + select checkbox (right, when in selectMode) */}
          <div className="flex items-center gap-[var(--space-1)] mb-[var(--space-3)] min-w-0">
            <Badge variant="neutral">{t(`common:categories.${getTopLevelCategory(item.category || 'text')}`)}</Badge>
            {item.contentMissing && (
              <Badge variant="warning">{t('library.missingBadge')}</Badge>
            )}
            {selectMode && (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect?.(item.tokenName)}
                onClick={(e) => e.stopPropagation()}
                className="ml-auto w-4 h-4 accent-[var(--accent)] cursor-pointer"
                aria-label={t('library.selectItem', { name: item.tokenName })}
              />
            )}
          </div>

          {/* Hero: token name + file size */}
          <div className="flex items-baseline justify-between mb-[var(--space-3)] gap-[var(--space-2)]">
            <span
              className="font-mono text-sm text-[var(--text-primary)] truncate"
              title={item.tokenName}
            >
              {searchQuery ? (
                <HighlightText text={truncateHex(item.tokenName, 12, 8)} query={searchQuery} />
              ) : (
                truncateHex(item.tokenName, 12, 8)
              )}
            </span>
            {item.fileSize != null && (
              <span className="text-xs text-[var(--text-muted)] flex-shrink-0 whitespace-nowrap">
                {formatBytes(item.fileSize)}
              </span>
            )}
          </div>

          {/* Description (no sub-card frame) */}
          {item.description && (
            <p
              onClick={() => setDescriptionModalOpen(true)}
              className={`text-sm text-[var(--text-secondary)] ${descClamp} mb-[var(--space-3)] cursor-pointer hover:text-[var(--text-primary)] transition-colors duration-[var(--transition-fast)]`}
              title={item.description}
            >
              {searchQuery ? (
                <HighlightText text={truncateDescription(item.description)} query={searchQuery} />
              ) : (
                truncateDescription(item.description)
              )}
            </p>
          )}

          {/* Action row — View hero + relist + delete icons */}
          {!selectMode && (
            <div className="flex items-center gap-[var(--space-2)]">
              <button
                onClick={() => onView(item)}
                className="flex-1 px-[var(--space-md)] py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
              >
                {t('library.viewContent')}
              </button>
              {onRelist && !item.contentMissing && (
                <button
                  onClick={() => onRelist(item)}
                  className="p-2 rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] btn-base"
                  title={t('library.createListingFromItem')}
                  aria-label={t('library.createListingFromItem')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => onDelete(item)}
                className="p-2 rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-muted)] btn-base"
                title={t('library.deleteFromLibrary')}
                aria-label={t('library.deleteFromLibrary')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}

          {/* Footer — dot-separated meta, pinned to card bottom for equal-height grid */}
          <div className="mt-auto pt-[var(--space-3)] border-t border-[var(--border-subtle)] flex items-center gap-[var(--space-2)] text-xs text-[var(--text-muted)] flex-wrap">
            <span>{t('card.decrypted', { date: formatDate(item.decryptedAt) })}</span>
            {sellerPkh && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono" title={sellerPkh}>
                  {truncateHex(sellerPkh, 8, 4)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopySeller(); }}
                  className="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-all duration-[var(--transition-fast)] cursor-pointer"
                  title={t('card.copySellerAddress')}
                  aria-label={t('card.copySellerAddress')}
                >
                  {copiedSeller ? (
                    <svg className="w-3.5 h-3.5 text-[var(--success)] copy-check-animate" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </article>

      <DescriptionModal
        isOpen={descriptionModalOpen}
        onClose={() => setDescriptionModalOpen(false)}
        description={item.description || ''}
        tokenName={item.tokenName}
      />
    </>
  );
}

function arePropsEqual(prev: LibraryCardProps, next: LibraryCardProps): boolean {
  return (
    prev.item.tokenName === next.item.tokenName &&
    prev.item.category === next.item.category &&
    prev.item.description === next.item.description &&
    prev.item.contentMissing === next.item.contentMissing &&
    prev.item.fileSize === next.item.fileSize &&
    prev.item.fileExtension === next.item.fileExtension &&
    prev.item.sellerPkh === next.item.sellerPkh &&
    prev.item.decryptedAt === next.item.decryptedAt &&
    prev.searchQuery === next.searchQuery &&
    prev.compact === next.compact &&
    prev.cardSize === next.cardSize &&
    prev.selectMode === next.selectMode &&
    prev.selected === next.selected &&
    prev.onView === next.onView &&
    prev.onDelete === next.onDelete &&
    prev.onRelist === next.onRelist &&
    prev.onToggleSelect === next.onToggleSelect
  );
}

export default memo(LibraryCard, arePropsEqual);
