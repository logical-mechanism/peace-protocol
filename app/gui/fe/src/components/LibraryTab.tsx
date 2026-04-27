import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { listLibraryItems, type LibraryItem } from '../services/libraryService';
import Select from './Select';
import { FILE_CATEGORIES } from '../config/categories';
import { formatBytes } from '../utils/formatBytes';
import { fuzzyMatch } from '../utils/fuzzySearch';
import LibraryCard from './LibraryCard';
import LibraryContentModal from './LibraryContentModal';
import ConfirmModal from './ConfirmModal';
import { deleteLibraryItem } from '../services/libraryService';
import { SkeletonCard, SkeletonGrid } from './SkeletonCard';
import EmptyState, { PackageIcon } from './EmptyState';
import { LibraryEmptyIllustration, NoResultsIllustration } from './EmptyStateIllustrations';
import RefreshIndicator from './RefreshIndicator';
import type { LibraryFilters, LibraryAction, CardSize, ColumnCount } from '../hooks/useTabFilterState';
import LayoutPopover from './LayoutPopover';
import { getGridClasses } from '../hooks/useTabFilterState';
import { useDebounce } from '../hooks/useDebounce';

interface LibraryTabProps {
  refreshSignal?: number;
  onSwitchTab?: (tab: 'marketplace' | 'my-sales' | 'my-purchases' | 'history' | 'library') => void;
  onLocalRefresh?: () => void;
  filters: LibraryFilters;
  dispatch: React.Dispatch<LibraryAction>;
  onBulkDeleteResult?: (message: string, hadErrors: boolean) => void;
  onRelist?: (item: LibraryItem) => void;
}

function LibraryTab({ refreshSignal, onSwitchTab, onLocalRefresh, filters, dispatch, onBulkDeleteResult, onRelist }: LibraryTabProps) {
  const { t } = useTranslation('dashboard');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevDataCount, setPrevDataCount] = useState(0);

  // Destructure filter state from Dashboard-level reducer
  const { viewMode, sortBy, categoryFilter, searchQuery, cardSize, columnCount, currentPage } = filters;
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Modal state
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [contentModalOpen, setContentModalOpen] = useState(false);

  // Delete confirmation from card (outside modal)
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ completed: number; failed: number; total: number } | null>(null);

  const hasDataRef = useRef(false);

  const fetchItems = useCallback(async () => {
    if (hasDataRef.current) setIsRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await listLibraryItems();
      setItems(result);
      setPrevDataCount(result.length);
      hasDataRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('library.failedTitle'));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);

  // Fetch on mount and re-fetch when refreshSignal changes (background refresh after first load)
  useEffect(() => {
    fetchItems();
  }, [refreshSignal, fetchItems]);

  // Filter and sort items
  const filteredAndSorted = useMemo(() => {
    let result = [...items];

    // Filter by category
    if (categoryFilter !== 'all') {
      result = result.filter((item) => item.category === categoryFilter);
    }

    // Search filter (fuzzy matching across all metadata fields)
    const searchScores = new Map<string, number>();
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.trim();
      result = result.filter((item) => {
        const fields = [
          item.tokenName,
          item.description ?? '',
          item.sellerPkh ?? '',
          item.category ?? '',
          item.fileExtension ?? '',
          item.storageLayer ?? '',
        ];
        let bestScore = 0;
        for (const field of fields) {
          if (!field) continue;
          const { match, score } = fuzzyMatch(query, field);
          if (match && score > bestScore) bestScore = score;
        }
        if (bestScore > 0) {
          searchScores.set(item.tokenName, bestScore);
          return true;
        }
        return false;
      });
    }

    // Sort
    switch (sortBy) {
      case 'newest':
        result.sort(
          (a, b) => new Date(b.decryptedAt).getTime() - new Date(a.decryptedAt).getTime()
        );
        break;
      case 'oldest':
        result.sort(
          (a, b) => new Date(a.decryptedAt).getTime() - new Date(b.decryptedAt).getTime()
        );
        break;
      case 'name-asc':
        result.sort((a, b) =>
          (a.description || a.tokenName).localeCompare(b.description || b.tokenName)
        );
        break;
      case 'name-desc':
        result.sort((a, b) =>
          (b.description || b.tokenName).localeCompare(a.description || a.tokenName)
        );
        break;
      case 'size-desc':
        result.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
        break;
      case 'size-asc':
        result.sort((a, b) => (a.fileSize ?? 0) - (b.fileSize ?? 0));
        break;
      case 'type-asc':
        result.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
        break;
      case 'type-desc':
        result.sort((a, b) => (b.category || '').localeCompare(a.category || ''));
        break;
    }

    // When searching, use fuzzy score as tiebreaker (best matches first)
    if (searchScores.size > 0) {
      result.sort((a, b) => (searchScores.get(b.tokenName) ?? 0) - (searchScores.get(a.tokenName) ?? 0));
    }

    return result;
  }, [items, categoryFilter, debouncedSearch, sortBy]);

  // Load more pagination
  const ITEMS_PER_PAGE = 24;

  const paginatedResults = useMemo(() => {
    return filteredAndSorted.slice(0, currentPage * ITEMS_PER_PAGE);
  }, [filteredAndSorted, currentPage]);

  const hasMore = paginatedResults.length < filteredAndSorted.length;

  const sentinelRef = useInfiniteScroll({
    hasMore,
    onLoadMore: useCallback(() => dispatch({ type: 'SET_PAGE', payload: currentPage + 1 }), [currentPage, dispatch]),
  });

  // Compute storage stats from all items (not filtered)
  const libraryStats = useMemo(() => {
    const totalSize = items.reduce((sum, item) => sum + (item.fileSize ?? 0), 0);
    const byCategory: Record<string, { count: number; size: number }> = {};
    for (const item of items) {
      const cat = item.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, size: 0 };
      byCategory[cat].count++;
      byCategory[cat].size += item.fileSize ?? 0;
    }
    return { totalCount: items.length, totalSize, byCategory };
  }, [items]);

  const handleView = useCallback((item: LibraryItem) => {
    const index = filteredAndSorted.findIndex(i => i.tokenName === item.tokenName);
    setSelectedItem(item);
    setSelectedIndex(index);
    setContentModalOpen(true);
  }, [filteredAndSorted]);

  const handleDeleteFromCard = useCallback((item: LibraryItem) => {
    setDeleteTarget(item);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLibraryItem(deleteTarget.tokenName, deleteTarget.category);
      setItems((prev) => prev.filter((i) => i.tokenName !== deleteTarget.tokenName));
      setDeleteTarget(null);
    } catch (err) {
      console.error('Failed to delete library item:', err);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  const handleDeleteFromModal = useCallback((item: LibraryItem) => {
    setItems((prev) => prev.filter((i) => i.tokenName !== item.tokenName));
  }, []);

  const handleCloseModal = useCallback(() => {
    setContentModalOpen(false);
    setSelectedItem(null);
    setSelectedIndex(-1);
  }, []);

  const handleNavigate = useCallback((item: LibraryItem, index: number) => {
    setSelectedItem(item);
    setSelectedIndex(index);
  }, []);

  // Bulk select handlers
  const handleToggleSelect = useCallback((tokenName: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(tokenName)) {
        next.delete(tokenName);
      } else {
        next.add(tokenName);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedItems(new Set(filteredAndSorted.map(i => i.tokenName)));
  }, [filteredAndSorted]);

  const handleDeselectAll = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const handleExitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedItems(new Set());
  }, []);

  // Escape key exits select mode
  useEffect(() => {
    if (!selectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExitSelectMode();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectMode, handleExitSelectMode]);

  const handleBulkDelete = useCallback(async () => {
    setBulkDeleting(true);
    const toDelete = items.filter(i => selectedItems.has(i.tokenName));
    const total = toDelete.length;
    setDeleteProgress({ completed: 0, failed: 0, total });

    const succeededTokens: string[] = [];
    const failedCount = { value: 0 };

    for (let idx = 0; idx < toDelete.length; idx++) {
      const item = toDelete[idx];
      try {
        await deleteLibraryItem(item.tokenName, item.category);
        succeededTokens.push(item.tokenName);
      } catch (err) {
        console.error(`Failed to delete ${item.tokenName}:`, err);
        failedCount.value++;
      }
      setDeleteProgress({ completed: idx + 1, failed: failedCount.value, total });
    }

    // Remove only successfully deleted items from the list
    const successSet = new Set(succeededTokens);
    setItems(prev => prev.filter(i => !successSet.has(i.tokenName)));

    // Clean up state
    setSelectedItems(new Set());
    setSelectMode(false);
    setDeleteProgress(null);
    setShowBulkDeleteConfirm(false);
    setBulkDeleting(false);

    // Notify parent with summary
    if (onBulkDeleteResult) {
      if (failedCount.value === 0) {
        onBulkDeleteResult(t('library.bulkDeletedSummary', { count: total }), false);
      } else {
        onBulkDeleteResult(
          t('library.bulkDeletedPartial', { succeeded: succeededTokens.length, total, failed: failedCount.value, count: failedCount.value }),
          true
        );
      }
    }
  }, [selectedItems, items, onBulkDeleteResult, t]);

  const bulkDeleteMessage = deleteProgress
    ? (deleteProgress.failed > 0
      ? t('library.bulkDeletingMessageWithFailed', { completed: deleteProgress.completed, total: deleteProgress.total, failed: deleteProgress.failed })
      : t('library.bulkDeletingMessage', { completed: deleteProgress.completed, total: deleteProgress.total }))
    : t('library.bulkDeleteMessage', { count: selectedItems.size });

  const screenReaderMessage = loading
    ? t('library.loading')
    : error
    ? t('library.loadError')
    : t('library.loadedCount', { count: items.length });

  if (loading) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <SkeletonGrid count={Math.max(1, Math.min(prevDataCount || 8, 20))} />
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <EmptyState
          icon={<PackageIcon />}
          title={t('library.failedTitle')}
          description={error}
          action={
            <button
              onClick={() => { fetchItems(); onLocalRefresh?.(); }}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('library.tryAgain')}
            </button>
          }
        />
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
        <EmptyState
          illustration={<LibraryEmptyIllustration />}
          title={t('library.emptyTitle')}
          description={t('library.emptyDesc')}
          action={onSwitchTab && (
            <button
              onClick={() => onSwitchTab('marketplace')}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('library.browseMarketplace')}
            </button>
          )}
        />
      </>
    );
  }

  return (
    <>
    <div className="sr-only" aria-live="polite" role="status">{screenReaderMessage}</div>
    <div>
      <RefreshIndicator visible={isRefreshing} />
      {/* Storage Summary — single quiet horizontal banner */}
      <div className="mb-6 px-[var(--space-md)] py-[var(--space-3)] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] flex items-center gap-[var(--space-3)] text-sm flex-wrap">
        <span className="flex items-baseline gap-[var(--space-2)]">
          <span className="text-[var(--text-muted)]">{t('library.totalItems')}</span>
          <span className="font-semibold text-[var(--text-primary)]">{libraryStats.totalCount}</span>
        </span>
        <span aria-hidden="true" className="text-[var(--border-default)]">·</span>
        <span className="flex items-baseline gap-[var(--space-2)]">
          <span className="text-[var(--text-muted)]">{t('library.totalSize')}</span>
          <span className="font-semibold text-[var(--accent)]">{formatBytes(libraryStats.totalSize)}</span>
        </span>
        {Object.entries(libraryStats.byCategory)
          .sort(([, a], [, b]) => b.size - a.size)
          .slice(0, 3)
          .map(([cat, stats]) => (
            <span key={cat} className="flex items-baseline gap-[var(--space-2)]">
              <span aria-hidden="true" className="text-[var(--border-default)]">·</span>
              <span className="text-[var(--text-muted)]">{t(`common:categories.${cat}`)}</span>
              <span className="text-[var(--text-secondary)]">{stats.count} ({formatBytes(stats.size)})</span>
            </span>
          ))}
      </div>

      {/* Toolbar — single framed container (matches Marketplace) */}
      <div className="mb-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-[var(--space-2)]">
        <div className="flex flex-col md:flex-row gap-[var(--space-2)]">
          {/* Search */}
          <div className="flex-1 relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              placeholder={t('library.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
              aria-label={t('library.searchAria')}
              className="w-full pl-10 pr-4 py-2 text-sm bg-transparent border border-transparent rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:bg-[var(--bg-primary)] focus:border-[var(--border-default)] transition-all duration-[var(--transition-fast)]"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-[var(--space-2)]">
          {/* Category Filter */}
          <div className="w-44">
            <Select
              value={categoryFilter}
              options={[
                { value: 'all', label: t('library.allCategories') },
                ...FILE_CATEGORIES.map((cat) => ({ value: cat.id, label: t(`common:categories.${cat.id}`) })),
              ]}
              onChange={(v) => dispatch({ type: 'SET_CATEGORY', payload: v })}
              ariaLabel={t('library.filterByCategoryAria')}
            />
          </div>

          {/* Sort */}
          <div className="w-52">
            <Select
              value={sortBy}
              options={[
                { value: 'newest', label: t('filters.sortNewest') },
                { value: 'oldest', label: t('filters.sortOldest') },
                { value: 'name-asc', label: t('filters.sortNameAsc') },
                { value: 'name-desc', label: t('filters.sortNameDesc') },
                { value: 'size-desc', label: t('filters.sortSizeDesc') },
                { value: 'size-asc', label: t('filters.sortSizeAsc') },
                { value: 'type-asc', label: t('filters.sortTypeAsc') },
                { value: 'type-desc', label: t('filters.sortTypeDesc') },
              ]}
              onChange={(v) => dispatch({ type: 'SET_SORT', payload: v as LibraryFilters['sortBy'] })}
              ariaLabel={t('library.sortAria')}
            />
          </div>

          {/* Layout (view + size + columns) */}
          <LayoutPopover
            viewMode={viewMode}
            cardSize={cardSize}
            columnCount={columnCount}
            onViewModeChange={(mode) => dispatch({ type: 'SET_VIEW', payload: mode })}
            onCardSizeChange={(size: CardSize) => dispatch({ type: 'SET_CARD_SIZE', payload: size })}
            onColumnCountChange={(cols: ColumnCount) => dispatch({ type: 'SET_COLUMN_COUNT', payload: cols })}
          />

          {/* Refresh */}
          <button
            onClick={() => { fetchItems(); onLocalRefresh?.(); }}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] btn-base btn-icon"
            title={t('library.refreshTitle')}
            aria-label={t('library.refreshAria')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          {/* Select Mode Toggle */}
          <button
            onClick={() => selectMode ? handleExitSelectMode() : setSelectMode(true)}
            className={`px-3 py-2 text-sm border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
              selectMode
                ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
                : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {selectMode ? <><span>{t('library.cancelButton')}</span> <kbd className="ml-1 text-xs text-[var(--text-muted)]">{t('library.escKey')}</kbd></> : t('library.selectButton')}
          </button>
        </div>
        </div>
      </div>

      {/* Results Count */}
      <div role="status" className="mb-4 text-sm text-[var(--text-muted)]">
        {hasMore
          ? t('library.showingOf', { shown: paginatedResults.length, count: filteredAndSorted.length })
          : t('library.totalCount', { count: filteredAndSorted.length })}
        {categoryFilter !== 'all' && ` ${t('library.categorySuffix', { category: categoryFilter })}`}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || categoryFilter !== 'all' ? (
          <EmptyState
            illustration={<NoResultsIllustration />}
            title={t('library.noMatchingTitle')}
            description={t('library.noMatchingDesc')}
            action={
              <button
                onClick={() => {
                  dispatch({ type: 'SET_SEARCH', payload: '' });
                  dispatch({ type: 'SET_CATEGORY', payload: 'all' });
                }}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {t('filters.clearFilters')}
              </button>
            }
          />
        ) : (
          <EmptyState
            illustration={<LibraryEmptyIllustration />}
            title={t('library.noItemsTitle')}
            description={t('library.noItemsDesc')}
          />
        )
      ) : viewMode === 'grid' ? (
        <div className={getGridClasses(columnCount)}>
          {paginatedResults.map((item, index) => (
            <div key={item.tokenName} className="card-stagger h-full" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <LibraryCard
                item={item}
                onView={handleView}
                onDelete={handleDeleteFromCard}
                onRelist={onRelist}
                searchQuery={debouncedSearch}
                cardSize={cardSize}
                selectMode={selectMode}
                selected={selectedItems.has(item.tokenName)}
                onToggleSelect={handleToggleSelect}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedResults.map((item, index) => (
            <div key={item.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <LibraryCard
                item={item}
                onView={handleView}
                onDelete={handleDeleteFromCard}
                onRelist={onRelist}
                compact
                selectMode={selectMode}
                selected={selectedItems.has(item.tokenName)}
                onToggleSelect={handleToggleSelect}
              />
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="flex flex-col items-center gap-3 mt-6">
          <div className={`${getGridClasses(columnCount)} w-full`}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {t('library.showingOf', { shown: paginatedResults.length, count: filteredAndSorted.length })}
          </p>
          <button
            onClick={() => dispatch({ type: 'SET_PAGE', payload: currentPage + 1 })}
            className="px-6 py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            {t('filters.loadMore')}
          </button>
          <div ref={sentinelRef} className="h-1" />
        </div>
      )}

      {/* Content Modal */}
      <LibraryContentModal
        isOpen={contentModalOpen}
        onClose={handleCloseModal}
        item={selectedItem}
        onDelete={handleDeleteFromModal}
        onRelist={onRelist}
        items={filteredAndSorted}
        currentIndex={selectedIndex}
        onNavigate={handleNavigate}
      />

      {/* Floating Bulk Action Bar */}
      {selectMode && selectedItems.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 px-6 py-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-full shadow-lg">
          <span className="text-sm text-[var(--text-secondary)]">
            {t('library.itemsSelected', { count: selectedItems.size })}
          </span>
          <button
            onClick={handleSelectAll}
            className="text-sm text-[var(--accent)] hover:underline cursor-pointer"
          >
            {t('library.selectAll')}
          </button>
          <button
            onClick={handleDeselectAll}
            className="text-sm text-[var(--text-muted)] hover:underline cursor-pointer"
          >
            {t('library.deselectAll')}
          </button>
          <button
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-danger"
          >
            {t('library.deleteCount', { count: selectedItems.size })}
          </button>
        </div>
      )}

      {/* Delete Confirmation (from card delete button) */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t('library.deleteConfirmTitle')}
        message={t('library.deleteConfirmMessage')}
        confirmLabel={t('library.deleteConfirmButton')}
        confirmVariant="danger"
        loading={deleting}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmModal
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title={t('library.bulkDeleteTitle', { count: selectedItems.size })}
        message={bulkDeleteMessage}
        confirmLabel={bulkDeleting ? t('library.bulkDeletingButton') : t('library.deleteCount', { count: selectedItems.size })}
        confirmVariant="danger"
        loading={bulkDeleting}
      />
    </div>
    </>
  );
}

export default memo(LibraryTab);
