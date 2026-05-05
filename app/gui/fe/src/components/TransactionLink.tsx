import { useTranslation } from 'react-i18next';
import { getTransactionUrl, isValidTxHash } from '../utils/network';

interface TransactionLinkProps {
  txHash: string;
  truncate?: boolean;
  className?: string;
}

/**
 * A link to view a transaction on CardanoScan.
 * Opens in a new tab with security attributes.
 */
export default function TransactionLink({
  txHash,
  truncate = true,
  className = '',
}: TransactionLinkProps) {
  const { t } = useTranslation('common');
  if (!txHash || !isValidTxHash(txHash)) {
    return (
      <span className={`font-mono text-[var(--text-muted)] ${className}`}>
        {truncate && txHash ? `${txHash.slice(0, 16)}...` : txHash || 'N/A'}
      </span>
    );
  }

  const url = getTransactionUrl(txHash);

  const icon = (
    <svg
      className="w-3 h-3 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );

  if (!truncate) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 font-mono text-[var(--link)] hover:text-[var(--link-hover)] underline underline-offset-2 transition-colors ${className}`}
        title={t('ui.viewTxOnCardanoScan', { txHash })}
      >
        {txHash}
        {icon}
      </a>
    );
  }

  // Responsive truncation: show more of the hash as screen widens
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-mono text-[var(--accent)] hover:text-[var(--accent)]/80 underline underline-offset-2 transition-colors ${className}`}
      title={t('ui.viewTxOnCardanoScan', { txHash })}
    >
      {/* sm: 8...4 */}
      <span className="md:hidden">{txHash.slice(0, 8)}...{txHash.slice(-4)}</span>
      {/* md: 16...8 */}
      <span className="hidden md:inline lg:hidden">{txHash.slice(0, 16)}...{txHash.slice(-8)}</span>
      {/* lg: 24...12 */}
      <span className="hidden lg:inline xl:hidden">{txHash.slice(0, 24)}...{txHash.slice(-12)}</span>
      {/* xl+: full hash */}
      <span className="hidden xl:inline">{txHash}</span>
      {icon}
    </a>
  );
}

/**
 * Inline transaction link for use in text content.
 */
export function TransactionLinkInline({
  txHash,
  className = '',
}: {
  txHash: string;
  className?: string;
}) {
  const { t } = useTranslation('common');
  if (!txHash || !isValidTxHash(txHash)) {
    return <span className="font-mono">{txHash || 'N/A'}</span>;
  }

  const url = getTransactionUrl(txHash);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[var(--link)] hover:text-[var(--link-hover)] hover:underline ${className}`}
      title={t('ui.viewOnCardanoScan')}
    >
      {txHash.slice(0, 8)}...{txHash.slice(-8)}
    </a>
  );
}
