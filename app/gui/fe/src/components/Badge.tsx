import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral' | 'accent';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  dot?: boolean;
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
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-[var(--radius-sm)] ${variantClasses[variant]} ${className}`}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />
      )}
      {children}
    </span>
  );
}

// Encryption status badge helper
export function EncryptionStatusBadge({ status }: { status: 'active' | 'pending' | 'completed' }) {
  const config: Record<typeof status, { variant: BadgeVariant; label: string }> = {
    active: { variant: 'success', label: 'Active' },
    pending: { variant: 'warning', label: 'Pending' },
    completed: { variant: 'neutral', label: 'Completed' },
  };

  const { variant, label } = config[status];
  return <Badge variant={variant} dot>{label}</Badge>;
}

// Bid status badge helper
export function BidStatusBadge({ status }: { status: 'pending' | 'accepted' | 'rejected' | 'cancelled' }) {
  const config: Record<typeof status, { variant: BadgeVariant; label: string }> = {
    pending: { variant: 'warning', label: 'Pending' },
    accepted: { variant: 'success', label: 'Accepted' },
    rejected: { variant: 'error', label: 'Rejected' },
    cancelled: { variant: 'neutral', label: 'Cancelled' },
  };

  const { variant, label } = config[status];
  return <Badge variant={variant} dot>{label}</Badge>;
}
