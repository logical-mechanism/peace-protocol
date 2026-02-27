import { memo } from 'react';

interface RefreshIndicatorProps {
  visible: boolean;
}

function RefreshIndicator({ visible }: RefreshIndicatorProps) {
  if (!visible) return null;

  return (
    <div
      className="w-full h-0.5 mb-4 rounded-full overflow-hidden bg-[var(--accent-muted)]"
      role="status"
      aria-label="Refreshing data"
    >
      <div className="h-full bg-[var(--accent)] rounded-full animate-refresh-bar" />
    </div>
  );
}

export default memo(RefreshIndicator);
