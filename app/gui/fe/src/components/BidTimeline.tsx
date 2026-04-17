import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

export type PurchaseStage = 'placed' | 'accepted' | 'complete' | 'failed';

interface BidTimelineProps {
  stage: PurchaseStage;
  bidStatus: string;
  compact?: boolean;
}

const STEP_KEYS = [
  { labelKey: 'bidTimeline.bidPlaced', key: 'placed' },
  { labelKey: 'bidTimeline.accepted', key: 'accepted' },
  { labelKey: 'bidTimeline.decrypting', key: 'decrypting' },
  { labelKey: 'bidTimeline.complete', key: 'complete' },
] as const;

const STAGE_INDEX: Record<PurchaseStage, number> = {
  placed: 0,
  accepted: 1,
  failed: 2,
  complete: 3,
};

const STAGE_TEXT_KEYS: Record<PurchaseStage, string> = {
  placed: 'bidTimeline.awaitingAcceptance',
  accepted: 'bidTimeline.awaitingDecryption',
  complete: 'bidTimeline.complete',
  failed: 'bidTimeline.decryptionFailed',
};

export default function BidTimeline({ stage, bidStatus, compact = false }: BidTimelineProps) {
  const { t } = useTranslation('common');

  // Don't show timeline for terminal non-success states
  if (bidStatus === 'rejected' || bidStatus === 'cancelled') return null;

  const currentIdx = STAGE_INDEX[stage];

  return (
    <div
      role="progressbar"
      aria-label="Bid progress"
      aria-valuemin={0}
      aria-valuemax={3}
      aria-valuenow={currentIdx}
      aria-valuetext={t(STAGE_TEXT_KEYS[stage])}
      className="flex items-center w-full"
    >
      {STEP_KEYS.map((step, i) => {
        const isCompleted = stage === 'complete' ? true : i < currentIdx;
        const isCurrent = stage === 'failed' ? i === 2 : i === currentIdx;
        const isError = stage === 'failed' && i === 2;
        const isFuture = !isCompleted && !isCurrent;

        return (
          <Fragment key={step.key}>
            {i > 0 && (
              <div
                className={`flex-1 h-0.5 ${
                  isCompleted && !isFuture
                    ? 'bg-[var(--success)]'
                    : 'bg-[var(--border-subtle)]'
                }`}
              />
            )}
            <div className="flex flex-col items-center">
              <div
                className={`rounded-full flex-shrink-0 ${compact ? 'w-2 h-2' : 'w-2.5 h-2.5'} ${
                  isError
                    ? 'bg-[var(--error)]'
                    : isCompleted
                    ? 'bg-[var(--success)]'
                    : isCurrent
                    ? 'bg-[var(--accent)]'
                    : 'bg-[var(--border-subtle)]'
                }`}
              />
              {!compact && (
                <span
                  className={`text-[10px] mt-1 whitespace-nowrap ${
                    isError
                      ? 'text-[var(--error)]'
                      : isCompleted || isCurrent
                      ? 'text-[var(--text-secondary)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {isError ? t('bidTimeline.failed') : t(step.labelKey)}
                </span>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
