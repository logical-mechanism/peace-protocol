import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Badge — semantic label primitive.
 *
 * Variant color rule (also used by tab badge counts in Dashboard):
 *   success — completed / verified / "ready" states
 *   warning — pending / "needs your action" states
 *   error   — rejected / failed / destructive states
 *   accent  — neutral count or callout, no implied urgency
 *   neutral — count-only or de-emphasized metadata
 *
 * Status badges should use a glyph alongside the color so colorblind users
 * still parse the state. Pass `glyph` to render a leading icon character
 * (e.g. "✓", "•", "✗") inline before the label.
 */
type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral' | 'accent';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  glyph?: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-[var(--success-muted)] text-[var(--success)]',
  warning: 'bg-[var(--warning-muted)] text-[var(--warning)]',
  error: 'bg-[var(--error-muted)] text-[var(--error)]',
  neutral: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
  accent: 'bg-[var(--accent-muted)] text-[var(--accent)]',
};

const dotColors: Record<BadgeVariant, string> = {
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  error: 'bg-[var(--error)]',
  neutral: 'bg-[var(--text-muted)]',
  accent: 'bg-[var(--accent)]',
};

export default function Badge({
  variant = 'neutral',
  children,
  className = '',
  dot = false,
  glyph,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap ${variantClasses[variant]} ${className}`}
    >
      {dot && (
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />
      )}
      {glyph && (
        <span aria-hidden="true" className="inline-flex items-center justify-center text-[10px] leading-none font-bold">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}

// Encryption status badge helper — color + glyph for colorblind support
export function EncryptionStatusBadge({ status }: { status: 'active' | 'pending' | 'completed' }) {
  const { t } = useTranslation('common');
  const config: Record<typeof status, { variant: BadgeVariant; labelKey: string; glyph: string }> = {
    active:    { variant: 'success', labelKey: 'badge.active',    glyph: '●' },
    pending:   { variant: 'warning', labelKey: 'badge.pending',   glyph: '◐' },
    completed: { variant: 'neutral', labelKey: 'badge.completed', glyph: '✓' },
  };

  const { variant, labelKey, glyph } = config[status];
  return <Badge variant={variant} glyph={glyph}>{t(labelKey)}</Badge>;
}

// Bid status badge helper — color + glyph for colorblind support
export function BidStatusBadge({ status }: { status: 'pending' | 'accepted' | 'rejected' | 'cancelled' }) {
  const { t } = useTranslation('common');
  const config: Record<typeof status, { variant: BadgeVariant; labelKey: string; glyph: string }> = {
    pending:   { variant: 'warning', labelKey: 'badge.pending',   glyph: '◐' },
    accepted:  { variant: 'success', labelKey: 'badge.accepted',  glyph: '✓' },
    rejected:  { variant: 'error',   labelKey: 'badge.rejected',  glyph: '✗' },
    cancelled: { variant: 'neutral', labelKey: 'badge.cancelled', glyph: '−' },
  };

  const { variant, labelKey, glyph } = config[status];
  return <Badge variant={variant} glyph={glyph}>{t(labelKey)}</Badge>;
}
