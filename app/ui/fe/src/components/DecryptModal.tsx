import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@meshsdk/react';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { decryptBid, decryptEncryption, getDecryptionExplanation, isStubMode } from '../services/crypto/decrypt';
import { copyToClipboard } from '../utils/clipboard';
import LoadingSpinner from './LoadingSpinner';

interface DecryptModalProps {
  isOpen: boolean;
  onClose: () => void;
  bid: BidDisplay | null;
  encryption: EncryptionDisplay | null;
}

type DecryptState = 'idle' | 'decrypting' | 'success' | 'error';

export default function DecryptModal({
  isOpen,
  onClose,
  bid,
  encryption,
}: DecryptModalProps) {
  const { wallet } = useWallet();
  const [state, setState] = useState<DecryptState>('idle');
  const [decryptedMessage, setDecryptedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStub, setIsStub] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setState('idle');
      setDecryptedMessage(null);
      setError(null);
      setIsStub(false);
      setCopied(false);
    }
  }, [isOpen]);

  const handleDecrypt = useCallback(async () => {
    if (!wallet || !encryption) return;

    setState('decrypting');
    setError(null);

    try {
      // Use bid-based decryption if bid is available, otherwise decrypt directly from encryption
      const result = bid
        ? await decryptBid(wallet, bid, encryption)
        : await decryptEncryption(wallet, encryption);

      if (result.success && result.message) {
        setState('success');
        setDecryptedMessage(result.message);
        setIsStub(result.isStub || false);
      } else {
        setState('error');
        setError(result.error || 'Unknown error occurred');
      }
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to decrypt');
    }
  }, [wallet, bid, encryption]);

  const handleCopy = useCallback(async () => {
    if (!decryptedMessage) return;
    const success = await copyToClipboard(decryptedMessage);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [decryptedMessage]);

  const handleClose = useCallback(() => {
    setState('idle');
    setDecryptedMessage(null);
    setError(null);
    setIsStub(false);
    onClose();
  }, [onClose]);

  const truncateToken = (token: string) => {
    if (!token) return '';
    return `${token.slice(0, 12)}...${token.slice(-8)}`;
  };

  const formatAda = (lovelace: number): string => {
    const ada = lovelace / 1_000_000;
    return ada.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={state !== 'decrypting' ? handleClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              {state === 'success' ? 'Decrypted Message' : 'Decrypt Content'}
            </h2>
            {(bid || encryption) && (
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Token: {truncateToken(bid ? bid.encryptionToken : encryption!.tokenName)}
              </p>
            )}
          </div>
          {state !== 'decrypting' && (
            <button
              onClick={handleClose}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Idle state - show info and decrypt button */}
          {state === 'idle' && (
            <div className="space-y-6">
              {/* Encryption Info */}
              {encryption && (
                <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  {encryption.description && (
                    <p className="text-sm text-[var(--text-secondary)] mb-3">
                      {encryption.description}
                    </p>
                  )}
                  {bid && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Your winning bid:</span>
                      <span className="font-semibold text-[var(--success)]">
                        {formatAda(bid.amount)} ADA
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* How it works */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">How decryption works</h3>
                <p className="text-sm text-[var(--text-muted)]">{getDecryptionExplanation()}</p>

                {isStubMode() && (
                  <div className="flex items-start gap-3 p-3 bg-[var(--warning-muted)] rounded-[var(--radius-md)]">
                    <svg
                      className="w-5 h-5 text-[var(--warning)] flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div className="text-sm">
                      <span className="font-medium text-[var(--warning)]">Development Mode</span>
                      <p className="text-[var(--text-secondary)] mt-0.5">
                        Using simulated data. Real decryption will be available when contracts are deployed on preprod.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Security note */}
              <div className="flex items-start gap-3 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                <svg
                  className="w-5 h-5 text-[var(--accent)] flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <div className="text-sm text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text-secondary)]">Secure Process</span>
                  <p className="mt-0.5">
                    Decryption happens locally in your browser. Your keys never leave your device.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Decrypting state */}
          {state === 'decrypting' && (
            <div className="py-12 text-center">
              <LoadingSpinner size="lg" className="mx-auto mb-6" />
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                Decrypting...
              </h3>
              <p className="text-sm text-[var(--text-muted)]">
                Processing encryption layers and deriving keys
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-4">
                Do not close this window
              </p>
            </div>
          )}

          {/* Success state */}
          {state === 'success' && decryptedMessage && (
            <div className="space-y-4">
              {/* Stub warning */}
              {isStub && (
                <div className="flex items-center gap-2 p-3 bg-[var(--warning-muted)] rounded-[var(--radius-md)]">
                  <svg
                    className="w-4 h-4 text-[var(--warning)] flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-sm text-[var(--warning)]">
                    Showing simulated content (development mode)
                  </span>
                </div>
              )}

              {/* Decrypted content */}
              <div className="relative">
                <div className="absolute top-3 right-3">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <svg className="w-3.5 h-3.5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-4 pt-12 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-x-auto font-mono text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words min-h-[200px] max-h-[400px] overflow-y-auto">
                  {decryptedMessage}
                </pre>
              </div>

              {/* Success message */}
              <div className="flex items-center gap-3 p-3 bg-[var(--success-muted)] rounded-[var(--radius-md)]">
                <svg
                  className="w-5 h-5 text-[var(--success)] flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm text-[var(--success)]">
                  Decryption successful! The message content is shown above.
                </span>
              </div>
            </div>
          )}

          {/* Error state */}
          {state === 'error' && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[var(--error-muted)] flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-[var(--error)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                Decryption Failed
              </h3>
              <p className="text-sm text-[var(--error)] mb-6 max-w-md mx-auto">
                {error}
              </p>
              <button
                onClick={() => setState('idle')}
                className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          {state === 'idle' && (
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDecrypt}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                  />
                </svg>
                Decrypt Now
              </button>
            </div>
          )}

          {state === 'success' && (
            <button
              onClick={handleClose}
              className="w-full px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer"
            >
              Done
            </button>
          )}

          {state === 'error' && (
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => setState('idle')}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
