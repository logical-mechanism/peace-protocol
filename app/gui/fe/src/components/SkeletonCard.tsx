/**
 * Skeleton loading placeholders that match card/row dimensions across tabs.
 * Uses skeleton-shimmer CSS class for a sweeping gradient animation.
 */

interface SkeletonCardProps {
  compact?: boolean;
}

/** Matches EncryptionCard / SalesListingCard / MyPurchaseBidCard / LibraryCard dimensions. */
export function SkeletonCard({ compact = false }: SkeletonCardProps) {
  if (compact) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-[var(--radius-md)] skeleton-shimmer" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded skeleton-shimmer" />
            <div className="h-3 w-2/3 rounded skeleton-shimmer" />
          </div>
          <div className="h-6 w-16 rounded skeleton-shimmer" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden">
      {/* Image banner placeholder — matches the new card's flush top banner */}
      <div className="w-full h-40 skeleton-shimmer" />

      {/* Content */}
      <div className="p-[var(--space-md)] flex-1 flex flex-col">
        {/* Hero row: price + badge */}
        <div className="flex items-center justify-between mb-[var(--space-2)]">
          <div className="h-7 w-24 rounded skeleton-shimmer" />
          <div className="h-4 w-12 rounded-[var(--radius-sm)] skeleton-shimmer" />
        </div>

        {/* Description lines */}
        <div className="h-3 w-full rounded skeleton-shimmer mb-[var(--space-1)]" />
        <div className="h-3 w-2/3 rounded skeleton-shimmer mb-[var(--space-3)]" />

        {/* Action button */}
        <div className="h-10 w-full rounded-[var(--radius-md)] skeleton-shimmer" />

        {/* Footer placeholder — pinned to bottom for equal-height grid */}
        <div className="mt-auto pt-[var(--space-3)] border-t border-[var(--border-subtle)] flex items-center gap-[var(--space-2)]">
          <div className="h-3 w-16 rounded skeleton-shimmer" />
          <div className="h-3 w-20 rounded skeleton-shimmer" />
          <div className="h-3 w-14 rounded skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}

/** Matches HistoryTab transaction row dimensions. */
export function SkeletonHistoryRow() {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex items-center gap-4">
      {/* Type icon */}
      <div className="w-8 h-8 rounded-full skeleton-shimmer" />
      {/* Description + timestamp */}
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 rounded skeleton-shimmer" />
        <div className="h-3 w-1/4 rounded skeleton-shimmer" />
      </div>
      {/* Status badge */}
      <div className="h-6 w-20 rounded-full skeleton-shimmer" />
    </div>
  );
}

interface SkeletonGridProps {
  count?: number;
  compact?: boolean;
}

/** Grid of skeleton cards matching the standard tab grid layout. */
export function SkeletonGrid({ count = 8, compact = false }: SkeletonGridProps) {
  if (compact) {
    return (
      <div className="space-y-3">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} compact />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Grid of skeleton history rows. */
export function SkeletonHistoryList({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonHistoryRow key={i} />
      ))}
    </div>
  );
}
