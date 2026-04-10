import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { listLibraryItems, type LibraryItem } from '../services/libraryService';
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
import { useWalletContext } from '../contexts/WalletContext';

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
  const { address } = useWalletContext();
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
      setError(err instanceof Error ? err.message : 'Failed to load library');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

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
          item.seller ?? '',
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
        onBulkDeleteResult(`Deleted ${total} ${total === 1 ? 'item' : 'items'} from library`, false);
      } else {
        onBulkDeleteResult(
          `Deleted ${succeededTokens.length} of ${total} items. ${failedCount.value} ${failedCount.value === 1 ? 'item' : 'items'} could not be removed.`,
          true
        );
      }
    }
  }, [selectedItems, items, onBulkDeleteResult]);

  const bulkDeleteMessage = deleteProgress
    ? `Deleting ${deleteProgress.completed} of ${deleteProgress.total}...${deleteProgress.failed > 0 ? ` (${deleteProgress.failed} failed)` : ''}`
    : `This will permanently remove ${selectedItems.size} ${selectedItems.size === 1 ? 'item' : 'items'} from your local library. You can re-download them by decrypting again.`;

  const screenReaderMessage = loading
    ? 'Loading your library…'
    : error
    ? 'Error loading your library'
    : `${items.length} ${items.length === 1 ? 'item' : 'items'} loaded`;

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
          title="Failed to load your library"
          description={error}
          action={
            <button
              onClick={() => { fetchItems(); onLocalRefresh?.(); }}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              Try Again
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
          title="Your library is empty"
          description="Purchase and decrypt a listing to see it here"
          action={onSwitchTab && (
            <button
              onClick={() => onSwitchTab('marketplace')}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              Browse Marketplace
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
      {/* Storage Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">Total Items</p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">
            {libraryStats.totalCount}
          </p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--text-muted)] mb-1">Total Size</p>
          <p className="text-xl font-semibold text-[var(--accent)]">
            {formatBytes(libraryStats.totalSize)}
          </p>
        </div>
        {Object.entries(libraryStats.byCategory)
          .sort(([, a], [, b]) => b.size - a.size)
          .slice(0, 2)
          .map(([cat, stats]) => (
            <div key={cat} className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
              <p className="text-xs text-[var(--text-muted)] mb-1">
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </p>
              <p className="text-xl font-semibold text-[var(--text-primary)]">
                {stats.count}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {formatBytes(stats.size)}
              </p>
            </div>
          ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
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
            placeholder="Search library..."
            value={searchQuery}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
            aria-label="Search library"
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] transition-all duration-[var(--transition-fast)]"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => dispatch({ type: 'SET_CATEGORY', payload: e.target.value })}
            aria-label="Filter by category"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Categories</option>
            {FILE_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => dispatch({ type: 'SET_SORT', payload: e.target.value as LibraryFilters['sortBy'] })}
            aria-label="Sort items"
            className="px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name-asc">Name: A to Z</option>
            <option value="name-desc">Name: Z to A</option>
            <option value="size-desc">Size: Largest First</option>
            <option value="size-asc">Size: Smallest First</option>
            <option value="type-asc">Type: A to Z</option>
            <option value="type-desc">Type: Z to A</option>
          </select>

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
            title="Refresh library"
            aria-label="Refresh library"
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
            {selectMode ? <><span>Cancel</span> <kbd className="ml-1 text-xs text-[var(--text-muted)]">Esc</kbd></> : 'Select'}
          </button>
        </div>
      </div>

      {/* Results Count */}
      <div role="status" className="mb-4 text-sm text-[var(--text-muted)]">
        {hasMore
          ? `Showing ${paginatedResults.length} of ${filteredAndSorted.length} ${filteredAndSorted.length === 1 ? 'item' : 'items'}`
          : `${filteredAndSorted.length} ${filteredAndSorted.length === 1 ? 'item' : 'items'}`}
        {categoryFilter !== 'all' && ` (${categoryFilter})`}
      </div>

      {/* Content */}
      {filteredAndSorted.length === 0 ? (
        searchQuery || categoryFilter !== 'all' ? (
          <EmptyState
            illustration={<NoResultsIllustration />}
            title="No matching items"
            description="Try adjusting your search or filters"
            action={
              <button
                onClick={() => {
                  dispatch({ type: 'SET_SEARCH', payload: '' });
                  dispatch({ type: 'SET_CATEGORY', payload: 'all' });
                }}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                Clear Filters
              </button>
            }
          />
        ) : (
          <EmptyState
            illustration={<LibraryEmptyIllustration />}
            title="No items found"
            description="Your library items will appear here"
          />
        )
      ) : viewMode === 'grid' ? (
        <div className={getGridClasses(columnCount)}>
          {paginatedResults.map((item, index) => (
            <div key={item.tokenName} className="card-stagger" style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}>
              <LibraryCard
                item={item}
                walletAddress={address ?? undefined}
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
                walletAddress={address ?? undefined}
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
            Showing {paginatedResults.length} of {filteredAndSorted.length}
          </p>
          <button
            onClick={() => dispatch({ type: 'SET_PAGE', payload: currentPage + 1 })}
            className="px-6 py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            Load More
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
            {selectedItems.size} {selectedItems.size === 1 ? 'item' : 'items'} selected
          </span>
          <button
            onClick={handleSelectAll}
            className="text-sm text-[var(--accent)] hover:underline cursor-pointer"
          >
            Select All
          </button>
          <button
            onClick={handleDeselectAll}
            className="text-sm text-[var(--text-muted)] hover:underline cursor-pointer"
          >
            Deselect All
          </button>
          <button
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-danger"
          >
            Delete {selectedItems.size}
          </button>
        </div>
      )}

      {/* Delete Confirmation (from card delete button) */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete from Library"
        message="This will permanently remove the decrypted content and metadata from your device. This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmModal
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedItems.size} ${selectedItems.size === 1 ? 'item' : 'items'}`}
        message={bulkDeleteMessage}
        confirmLabel={bulkDeleting ? 'Deleting...' : `Delete ${selectedItems.size}`}
        confirmVariant="danger"
        loading={bulkDeleting}
      />
    </div>
    </>
  );
}

export default memo(LibraryTab);
