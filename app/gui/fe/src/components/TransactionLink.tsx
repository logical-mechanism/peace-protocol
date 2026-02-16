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
  if (!txHash || !isValidTxHash(txHash)) {
    return (
      <span className={`font-mono text-[var(--text-muted)] ${className}`}>
        {truncate && txHash ? `${txHash.slice(0, 16)}...` : txHash || 'N/A'}
      </span>
    );
  }

  const displayHash = truncate ? `${txHash.slice(0, 16)}...` : txHash;
  const url = getTransactionUrl(txHash);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-mono text-[var(--accent)] hover:text-[var(--accent)]/80 underline underline-offset-2 transition-colors ${className}`}
      title={`View transaction ${txHash} on CardanoScan`}
    >
      {displayHash}
      <svg
        className="w-3 h-3"
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
  if (!txHash || !isValidTxHash(txHash)) {
    return <span className="font-mono">{txHash || 'N/A'}</span>;
  }

  const url = getTransactionUrl(txHash);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[var(--accent)] hover:underline ${className}`}
      title="View on CardanoScan"
    >
      {txHash.slice(0, 8)}...{txHash.slice(-8)}
    </a>
  );
}
