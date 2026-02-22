import { useState } from 'react';
import type { LibraryItem } from '../services/libraryService';
import Badge from './Badge';
import DescriptionModal from './DescriptionModal';
import { truncateDescription } from './descriptionUtils';

interface LibraryCardProps {
  item: LibraryItem;
  onView: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
  compact?: boolean;
}

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

const getCategoryLabel = (category: string): string => {
  if (!category) return 'Text';
  return category.charAt(0).toUpperCase() + category.slice(1);
};

const truncateSeller = (seller: string) => {
  if (!seller) return '';
  if (seller.length <= 16) return seller;
  return `${seller.slice(0, 8)}...${seller.slice(-4)}`;
};

function CategoryIcon({ category, size = 'md' }: { category: string; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';

  switch (category) {
    case 'text':
      return (
        <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
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

export default function LibraryCard({
  item,
  onView,
  onDelete,
  compact = false,
}: LibraryCardProps) {
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);

  if (compact) {
    return (
      <>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-default)] transition-all duration-150">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Icon + Info */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] flex-shrink-0">
                <CategoryIcon category={item.category} size="sm" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    {truncateToken(item.tokenName)}
                  </span>
                  <Badge variant="neutral">{getCategoryLabel(item.category)}</Badge>
                  {item.contentMissing && (
                    <Badge variant="warning">Missing</Badge>
                  )}
                </div>
                {item.description && (
                  <p
                    className="text-sm text-[var(--text-secondary)] truncate cursor-pointer hover:text-[var(--text-primary)]"
                    onClick={() => setDescriptionModalOpen(true)}
                  >
                    {truncateDescription(item.description)}
                  </p>
                )}
              </div>
            </div>

            {/* Middle: Seller & Date */}
            <div className="flex items-center gap-6 flex-shrink-0">
              <div className="text-right">
                {item.seller && (
                  <p className="text-xs font-mono text-[var(--text-muted)]">
                    {truncateSeller(item.seller)}
                  </p>
                )}
                <p className="text-xs text-[var(--text-muted)]">
                  {formatDate(item.decryptedAt)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => onView(item)}
                  className="px-3 py-1.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
                >
                  View
                </button>
                <button
                  onClick={() => onDelete(item)}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-muted)] rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer"
                  title="Delete from library"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <DescriptionModal
          isOpen={descriptionModalOpen}
          onClose={() => setDescriptionModalOpen(false)}
          description={item.description || ''}
          tokenName={item.tokenName}
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
                {truncateToken(item.tokenName)}
              </span>
              <Badge variant="neutral">{getCategoryLabel(item.category)}</Badge>
              {item.contentMissing && (
                <Badge variant="warning">Content Missing</Badge>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Decrypted {formatDate(item.decryptedAt)}
            </p>
          </div>
        </div>

        {/* Description */}
        {item.description && (
          <div
            className="mb-4 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-elevated)] hover:border-[var(--border-default)]"
            onClick={() => setDescriptionModalOpen(true)}
          >
            <p
              className="text-sm text-[var(--text-secondary)] line-clamp-1"
              title={item.description}
            >
              {truncateDescription(item.description)}
            </p>
          </div>
        )}

        {/* Category Icon */}
        <div className="flex items-center justify-center py-6 mb-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          <div className="w-14 h-14 rounded-full bg-[var(--accent-muted)] flex items-center justify-center text-[var(--accent)]">
            <CategoryIcon category={item.category} size="md" />
          </div>
        </div>

        {/* Seller Info */}
        {item.seller && (
          <div className="flex items-center justify-between py-3 border-t border-[var(--border-subtle)]">
            <span className="text-xs text-[var(--text-muted)]">Seller</span>
            <span className="text-xs font-mono text-[var(--text-secondary)]">
              {truncateSeller(item.seller)}
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-4 space-y-2">
          <button
            onClick={() => onView(item)}
            className="w-full px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-all duration-150 cursor-pointer"
          >
            View Content
          </button>
          <button
            onClick={() => onDelete(item)}
            className="w-full px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--error-muted)] hover:text-[var(--error)] hover:border-[var(--error)] transition-all duration-150 cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>

      <DescriptionModal
        isOpen={descriptionModalOpen}
        onClose={() => setDescriptionModalOpen(false)}
        description={item.description || ''}
        tokenName={item.tokenName}
      />
    </>
  );
}
