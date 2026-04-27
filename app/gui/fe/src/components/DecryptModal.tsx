import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useWalletContext } from '../contexts/WalletContext';
import type { BidDisplay, EncryptionDisplay } from '../services/api';
import { decryptBid, decryptEncryption, getDecryptionExplanationState, isStubMode, type OnDecryptProgress } from '../services/crypto/decrypt';
import { getCategoryConfig, type FileCategory } from '../config/categories';
import { saveDecryptedContent, saveContentMetadata } from '../services/contentStorage';
import { copyToClipboard } from '../utils/clipboard';
import { truncateHex } from '../utils/truncate';
import { formatAda } from '../utils/formatAda';
import LoadingSpinner from './LoadingSpinner';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useCelebrationFlag } from '../hooks/useTxCelebration';
import { getOnboardingState } from '../services/onboardingStorage';

interface DecryptModalProps {
  isOpen: boolean;
  onClose: () => void;
  bid: BidDisplay | null;
  encryption: EncryptionDisplay | null;
  isIagonConnected?: boolean;
  onDecryptResult?: (result: { success: boolean; encryptionToken: string }) => void;
  onSaveWarning?: (message: string) => void;
  ownerPkh?: string;
}

type DecryptState = 'idle' | 'decrypting' | 'success' | 'error';

export default function DecryptModal({
  isOpen,
  onClose,
  bid,
  encryption,
  isIagonConnected = false,
  onDecryptResult,
  onSaveWarning,
  ownerPkh,
}: DecryptModalProps) {
  const { t } = useTranslation(['modals', 'common']);
  const navigate = useNavigate();
  const { wallet } = useWalletContext();
  const [state, setState] = useState<DecryptState>('idle');
  const [decryptedMessage, setDecryptedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStub, setIsStub] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [phase, setPhase] = useState<'decrypting' | 'downloading'>('decrypting');
  const [savedPath, setSavedPath] = useState<string | null>(null);

  // Stack-aware Escape key + body scroll lock + animation
  const { zIndex, shouldRender, animationState, isTopmost } = useModalStack('decrypt', isOpen, onClose, state === 'decrypting');

  // Signature motion: one restrained beat when decryption completes successfully.
  const isCelebrating = useCelebrationFlag(state === 'success');
  const modalRef = useRef<HTMLDivElement>(null);
  // Decrypt Now is first in DOM order below (flex-row-reverse keeps Cancel
  // visually on the left), so useFocusTrap's natural "first focusable"
  // fallback lands on it — no raf race with React state batching.
  useFocusTrap(modalRef, isOpen, { isTopmost });

  // Reset state when modal opens — intentional synchronous setState
  useEffect(() => {
    if (isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setState('idle');
      setDecryptedMessage(null);
      setError(null);
      setIsStub(false);
      setCopied(false);
      setProgress(null);
      setPhase('decrypting');
      setSavedPath(null);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isOpen]);

  const handleDecrypt = useCallback(async () => {
    if (!wallet || !encryption) return;

    setState('decrypting');
    setError(null);
    setProgress(null);

    const onProgress: OnDecryptProgress = (current, total, progressPhase) => {
      setProgress({ current, total });
      if (progressPhase) {
        setPhase(progressPhase);
      }
    };

    try {
      // Use bid-based decryption if bid is available, otherwise decrypt directly from encryption
      const result = bid
        ? await decryptBid(wallet, bid, encryption, onProgress)
        : await decryptEncryption(wallet, encryption, onProgress, ownerPkh);

      if (result.success && result.message) {
        // Brief pause at 100% so user sees the completed bar
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Auto-save decrypted content and metadata to library
        const category = encryption?.category || 'text';
        try {
          let path: string;
          let fileSize: number;

          if (result.savedPath) {
            // File content — already saved by Rust (no large byte arrays crossed IPC)
            path = result.savedPath;
            fileSize = result.savedSize ?? 0;
          } else {
            // Text content — save via IPC (small data, safe to serialize)
            const contentBytes = result.rawContent ?? new TextEncoder().encode(result.message);
            path = await saveDecryptedContent(encryption!.tokenName, category, contentBytes, result.fileExtension);
            fileSize = contentBytes.length;
          }

          setSavedPath(path);
          // Save metadata alongside content for library display
          await saveContentMetadata({
            tokenName: encryption!.tokenName,
            description: encryption!.description,
            suggestedPrice: encryption!.suggestedPrice,
            storageLayer: encryption!.storageLayer,
            imageLink: encryption!.imageLink,
            category,
            fileExtension: result.fileExtension,
            sellerPkh: encryption!.sellerPkh,
            createdAt: encryption!.createdAt,
            decryptedAt: new Date().toISOString(),
            fileSize,
          });
        } catch (err) {
          console.warn('Failed to save decrypted content:', err);
          onSaveWarning?.(t('modals:decrypt.saveWarning'));
        }

        setState('success');
        setDecryptedMessage(result.message);
        setIsStub(result.isStub || false);
        if (encryption) {
          onDecryptResult?.({ success: true, encryptionToken: encryption.tokenName });
        }
      } else {
        setState('error');
        setError(result.error || t('modals:decrypt.unknownError'));
        if (encryption) {
          onDecryptResult?.({ success: false, encryptionToken: encryption.tokenName });
        }
      }
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : t('modals:decrypt.failedFallback'));
      if (encryption) {
        onDecryptResult?.({ success: false, encryptionToken: encryption.tokenName });
      }
    }
  }, [wallet, bid, encryption, onDecryptResult, onSaveWarning, ownerPkh, t]);

  const handleCopy = useCallback(async () => {
    if (!decryptedMessage) return;
    const success = await copyToClipboard(decryptedMessage);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      console.warn('Clipboard copy failed for decrypted content');
    }
  }, [decryptedMessage]);

  const handleClose = useCallback(() => {
    setState('idle');
    setDecryptedMessage(null);
    setError(null);
    setIsStub(false);
    setProgress(null);
    setPhase('decrypting');
    setSavedPath(null);
    onClose();
  }, [onClose]);

  if (!shouldRender) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="decrypt-modal-title"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-[var(--backdrop-overlay)] backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={state !== 'decrypting' ? handleClose : undefined}
        aria-hidden="true"
      />

      {/* Modal — overflow-hidden moved off the panel so focus outlines on
       * edge-adjacent buttons aren't clipped in WebKit. */}
      <div className={`relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] rounded-t-[var(--radius-xl)]">
          <div>
            <h2 id="decrypt-modal-title" className="text-xl font-semibold text-[var(--text-primary)]">
              {state === 'success'
                ? (!encryption?.category || encryption.category === 'text'
                    ? t('modals:decrypt.titleSuccessText')
                    : t('modals:decrypt.titleSuccessFile'))
                : t('modals:decrypt.title')}
            </h2>
            {(bid || encryption) && (
              <p className="text-sm text-[var(--text-muted)] mt-1" title={bid ? bid.encryptionToken : encryption!.tokenName}>
                {t('modals:decrypt.tokenLabel', { token: truncateHex(bid ? bid.encryptionToken : encryption!.tokenName, 12, 8) })}
              </p>
            )}
          </div>
          {state !== 'decrypting' && (
            // tabIndex={-1}: Escape key closes the dialog per ARIA dialog
            // pattern, so this icon-only X is a mouse convenience — keeping
            // it out of the Tab cycle lets the primary affirmative button
            // (Decrypt Now) receive initial focus without timing tricks.
            <button
              onClick={handleClose}
              aria-label={t('modals:common.closeDialog')}
              tabIndex={-1}
              className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
                    <p
                      className="text-sm text-[var(--text-secondary)] mb-3 line-clamp-1"
                      title={encryption.description}
                    >
                      {encryption.description}
                    </p>
                  )}
                  {bid && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-muted)]">{t('modals:decrypt.winningBid')}</span>
                      <span className="font-semibold text-[var(--success)]">
                        {formatAda(bid.amount)} ADA
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Iagon connection required warning */}
              {encryption?.storageLayer === 'iagon' && !isIagonConnected && (
                <div className="flex items-start gap-3 p-4 bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-[var(--radius-md)]">
                  <svg className="w-5 h-5 text-[var(--warning)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--warning)]">{t('modals:decrypt.iagonRequiredTitle')}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {t('modals:decrypt.iagonRequiredBody')}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate('/settings', { state: { section: 'datalayer' } });
                      }}
                      className="mt-2 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-secondary"
                    >
                      {t('modals:decrypt.goToSettings')}
                    </button>
                  </div>
                </div>
              )}

              {/* How it works — collapses to a disclosure once the user has done their first decrypt */}
              <details
                className="group [&_summary]:list-none"
                open={!getOnboardingState().firstDecryptCompleted}
              >
                <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                  <svg className="w-3.5 h-3.5 text-[var(--text-muted)] transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {t('modals:decrypt.howItWorks')}
                </summary>
                <div className="space-y-3 mt-3">
                  {(() => {
                    const explanation = getDecryptionExplanationState();
                    if (explanation.mode === 'stub') {
                      return (
                        <p className="text-sm text-[var(--text-muted)]">{t('modals:decrypt.explanationStub')}</p>
                      );
                    }
                    const wasmStatusKey = explanation.wasmReady
                      ? 'modals:decrypt.explanationWasmReady'
                      : 'modals:decrypt.explanationWasmMissing';
                    return (
                      <div className="text-sm text-[var(--text-muted)] space-y-2">
                        <p>{t('modals:decrypt.explanationIntro')}</p>
                        <ol className="list-decimal pl-5 space-y-1">
                          <li>{t('modals:decrypt.explanationStep1')}</li>
                          <li>{t('modals:decrypt.explanationStep2')}</li>
                          <li>{t('modals:decrypt.explanationStep3')}</li>
                          <li>{t('modals:decrypt.explanationStep4')}</li>
                        </ol>
                        <p>{t(wasmStatusKey)}</p>
                      </div>
                    );
                  })()}

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
                        <span className="font-medium text-[var(--warning)]">{t('modals:decrypt.devModeTitle')}</span>
                        <p className="text-[var(--text-secondary)] mt-0.5">
                          {t('modals:decrypt.devModeBody')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </details>

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
                  <span className="font-medium text-[var(--text-secondary)]">{t('modals:decrypt.secureTitle')}</span>
                  <p className="mt-0.5">
                    {t('modals:decrypt.secureBody')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Decrypting / Downloading state */}
          {state === 'decrypting' && (
            <div className="py-12 text-center" aria-live="polite">
              <LoadingSpinner size="lg" className="mx-auto mb-6" />

              {phase === 'downloading' ? (
                <>
                  <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                    {t('modals:decrypt.downloadingTitle')}
                  </h3>
                  <p className="text-sm text-[var(--text-muted)] mb-6">
                    {t('modals:decrypt.downloadingBody')}
                  </p>

                  {/* Indeterminate progress bar */}
                  <div className="max-w-sm mx-auto space-y-2">
                    <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div className="h-full w-1/3 rounded-full bg-[var(--accent)] animate-[indeterminate_1.5s_ease-in-out_infinite]" />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                    {t('modals:decrypt.decryptingTitle')}
                  </h3>
                  <p className="text-sm text-[var(--text-muted)] mb-6">
                    {t('modals:decrypt.decryptingBody')}
                  </p>

                  {/* Progress bar */}
                  {progress && progress.total > 0 && (
                    <div className="max-w-sm mx-auto space-y-2">
                      <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ease-out ${
                            progress.current >= progress.total
                              ? 'bg-[var(--success)]'
                              : 'bg-[var(--accent)]'
                          }`}
                          style={{ width: `${(progress.current / progress.total) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-[var(--text-muted)]">
                        <span>
                          {t('modals:decrypt.layerProgress', { current: progress.current, total: progress.total })}
                        </span>
                        <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              <p className="text-xs text-[var(--text-muted)] mt-4">
                {t('modals:decrypt.doNotClose')}
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
                    {t('modals:decrypt.stubWarning')}
                  </span>
                </div>
              )}

              {/* Decrypted content — text gets inline display, non-text gets file card */}
              {!encryption?.category || encryption.category === 'text' ? (
                <div className="relative">
                  <div className="absolute top-3 right-3">
                    <button
                      onClick={handleCopy}
                      aria-label={t('modals:decrypt.copyAriaLabel')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-secondary)] rounded-[var(--radius-md)] btn-base btn-tertiary"
                    >
                      {copied ? (
                        <>
                          <svg className="w-3.5 h-3.5 text-[var(--success)] copy-check-animate" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {t('modals:decrypt.copied')}
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
                          {t('modals:decrypt.copy')}
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-4 pt-12 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-x-auto font-mono text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words min-h-[200px] max-h-[400px] overflow-y-auto">
                    {decryptedMessage}
                  </pre>
                </div>
              ) : (
                <div className="p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-center space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-full bg-[var(--accent-muted)] flex items-center justify-center">
                    <svg className="w-7 h-7 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {t('modals:decrypt.fileDecrypted', {
                      category: getCategoryConfig(encryption.category as FileCategory)
                        ? t(`common:categories.${encryption.category}`)
                        : encryption.category,
                    })}
                  </p>
                  {encryption.description && (
                    <p className="text-xs text-[var(--text-muted)]">{encryption.description}</p>
                  )}
                </div>
              )}

              {/* Success message */}
              <div className="flex items-center gap-3 p-3 bg-[var(--success-muted)] rounded-[var(--radius-md)]">
                <svg
                  className={`w-5 h-5 text-[var(--success)] flex-shrink-0 ${isCelebrating ? 'tx-celebration-icon' : ''}`}
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
                  {!encryption?.category || encryption.category === 'text'
                    ? t('modals:decrypt.successText')
                    : t('modals:decrypt.successFile')}
                </span>
              </div>

              {/* Saved to library indicator */}
              {savedPath && (
                <div className="flex items-center gap-2 p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  <svg
                    className="w-4 h-4 text-[var(--success)] flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="text-sm text-[var(--text-muted)]">
                    {t('modals:decrypt.savedToLibrary')}
                  </span>
                </div>
              )}
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
                {t('modals:decrypt.failedTitle')}
              </h3>
              <p className="text-sm text-[var(--error)] mb-6 max-w-md mx-auto">
                {error}
              </p>
              <button
                onClick={() => setState('idle')}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {t('modals:decrypt.tryAgain')}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] rounded-b-[var(--radius-xl)]">
          {state === 'idle' && (
            // flex-row-reverse: Decrypt Now is first in DOM so it receives
            // initial focus; Cancel stays visually on the left.
            <div className="flex flex-row-reverse gap-3">
              <button
                data-tutorial="decrypt-now-button"
                onClick={handleDecrypt}
                disabled={encryption?.storageLayer === 'iagon' && !isIagonConnected}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-2 btn-base btn-primary"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                  />
                </svg>
                {t('modals:decrypt.decryptNow')}
              </button>
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {t('common:actions.cancel')}
              </button>
            </div>
          )}

          {state === 'success' && (
            <button
              onClick={handleClose}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
            >
              {t('modals:decrypt.done')}
            </button>
          )}

          {state === 'error' && (
            // flex-row-reverse: Try Again first in DOM (primary retry path),
            // Close visually on the left.
            <div className="flex flex-row-reverse gap-3">
              <button
                onClick={() => setState('idle')}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary"
              >
                {t('modals:decrypt.tryAgain')}
              </button>
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {t('common:actions.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
