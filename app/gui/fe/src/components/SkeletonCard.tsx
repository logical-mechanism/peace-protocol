/**
 * Skeleton loading placeholders that match card/row dimensions across tabs.
 * Uses CSS variables and animate-pulse for the dark theme.
 */

interface SkeletonCardProps {
  compact?: boolean;
}

/** Matches EncryptionCard / SalesListingCard / MyPurchaseBidCard / LibraryCard dimensions. */
export function SkeletonCard({ compact = false }: SkeletonCardProps) {
  if (compact) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--bg-tertiary)]" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-3 w-2/3 rounded bg-[var(--bg-tertiary)]" />
          </div>
          <div className="h-6 w-16 rounded bg-[var(--bg-tertiary)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6 animate-pulse">
      {/* Header row: icon + badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--bg-tertiary)]" />
        <div className="h-5 w-16 rounded-full bg-[var(--bg-tertiary)]" />
      </div>
      {/* Title */}
      <div className="h-4 w-3/4 rounded bg-[var(--bg-tertiary)] mb-3" />
      {/* Description lines */}
      <div className="h-3 w-full rounded bg-[var(--bg-tertiary)] mb-2" />
      <div className="h-3 w-2/3 rounded bg-[var(--bg-tertiary)] mb-4" />
      {/* Footer row */}
      <div className="flex items-center justify-between">
        <div className="h-3 w-1/4 rounded bg-[var(--bg-tertiary)]" />
        <div className="h-8 w-20 rounded-[var(--radius-md)] bg-[var(--bg-tertiary)]" />
      </div>
    </div>
  );
}

/** Matches HistoryTab transaction row dimensions. */
export function SkeletonHistoryRow() {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex items-center gap-4 animate-pulse">
      {/* Type icon */}
      <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)]" />
      {/* Description + timestamp */}
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 rounded bg-[var(--bg-tertiary)]" />
        <div className="h-3 w-1/4 rounded bg-[var(--bg-tertiary)]" />
      </div>
      {/* Status badge */}
      <div className="h-6 w-20 rounded-full bg-[var(--bg-tertiary)]" />
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
