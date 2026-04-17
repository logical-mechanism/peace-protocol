import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface RefreshIndicatorProps {
  visible: boolean;
}

function RefreshIndicator({ visible }: RefreshIndicatorProps) {
  const { t } = useTranslation('common');
  if (!visible) return null;

  return (
    <div
      className="w-full h-0.5 mb-4 rounded-full overflow-hidden bg-[var(--accent-muted)]"
      role="status"
      aria-label={t('ui.refreshingData')}
    >
      <div className="h-full bg-[var(--accent)] rounded-full animate-refresh-bar" />
    </div>
  );
}

export default memo(RefreshIndicator);
