import { useState, useEffect, useCallback, useRef } from 'react';
import { getTransactionUrl, isValidTxHash } from '../utils/network';
import { getToastDurationMs } from '../services/toastSettings';
import { getTypeLabel, type TransactionType } from '../services/transactionHistory';
import { copyToClipboard } from '../utils/clipboard';

export interface TransactionDetails {
  type?: TransactionType;
  amountLovelace?: number;
  message?: string;
}

const MAX_VISIBLE_TOASTS = 3;

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
}

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
  index?: number;
}

function Toast({ toast, onClose, index = 0 }: ToastProps) {
  const [copied, setCopied] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (!closing) setClosing(true);
  }, [closing]);

  const handleAnimationEnd = useCallback((e: React.AnimationEvent) => {
    if (e.animationName === 'toast-exit') {
      onClose(toast.id);
    }
  }, [onClose, toast.id]);

  useEffect(() => {
    if (toast.duration !== 0 && !closing) {
      const timer = setTimeout(() => {
        handleClose();
      }, toast.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, closing, handleClose]);

  const handleCopy = async () => {
    const text = toast.message ? `${toast.title}: ${toast.message}` : toast.title;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const getColors = () => {
    switch (toast.type) {
      case 'success':
        return {
          bg: 'bg-[var(--success)]/10',
          border: 'border-[var(--success)]/30',
          icon: 'text-[var(--success)]',
        };
      case 'error':
        return {
          bg: 'bg-[var(--error)]/10',
          border: 'border-[var(--error)]/30',
          icon: 'text-[var(--error)]',
        };
      case 'warning':
        return {
          bg: 'bg-[var(--warning)]/10',
          border: 'border-[var(--warning)]/30',
          icon: 'text-[var(--warning)]',
        };
      case 'info':
      default:
        return {
          bg: 'bg-[var(--accent)]/10',
          border: 'border-[var(--accent)]/30',
          icon: 'text-[var(--accent)]',
        };
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        );
      case 'info':
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
    }
  };

  const colors = getColors();

  return (
    <div
      className={`flex items-start gap-3 p-4 ${colors.bg} border ${colors.border} rounded-[var(--radius-lg)] shadow-lg ${closing ? 'toast-exit' : 'animate-in slide-in-from-right-full duration-[var(--transition-slow)]'}`}
      style={!closing && index > 0 ? { animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' } : undefined}
      onAnimationEnd={handleAnimationEnd}
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className={`flex-shrink-0 ${colors.icon}`}>{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">{toast.title}</p>
        {toast.message && (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{toast.message}</p>
        )}
        {toast.action && (
          <div className="mt-2">
            {toast.action.href ? (
              <a
                href={toast.action.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 text-xs font-medium ${colors.icon} hover:underline`}
              >
                {toast.action.label}
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
            ) : toast.action.onClick ? (
              <button
                onClick={toast.action.onClick}
                className={`text-xs font-medium ${colors.icon} hover:underline cursor-pointer`}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {(toast.type === 'error' || toast.type === 'warning') && (
        <button
          onClick={handleCopy}
          className="flex-shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          aria-label="Copy error to clipboard"
        >
          {copied ? (
            <svg className="w-4 h-4 text-[var(--success)] copy-check-animate" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      )}
      <button
        onClick={handleClose}
        className="flex-shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        aria-label="Dismiss notification"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
  queuedCount?: number;
  onDismissAll?: () => void;
}

export function ToastContainer({ toasts, onClose, queuedCount = 0, onDismissAll }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full" aria-live="polite" role="status">
      {toasts.length >= 2 && onDismissAll && (
        <button
          onClick={onDismissAll}
          className="self-end text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer mb-1"
        >
          Dismiss all{queuedCount > 0 ? ` (${queuedCount} queued)` : ''}
        </button>
      )}
      {toasts.map((toast, index) => (
        <Toast key={toast.id} toast={toast} onClose={onClose} index={index} />
      ))}
    </div>
  );
}

/**
 * Hook for managing toast notifications.
 * Limits visible toasts to MAX_VISIBLE_TOASTS and queues the rest.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const [visibleToasts, setVisibleToasts] = useState<ToastMessage[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const queueRef = useRef<ToastMessage[]>([]);

  const addToast = useCallback(
    (
      type: ToastType,
      title: string,
      message?: string,
      duration?: number,
      action?: ToastAction
    ) => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newToast: ToastMessage = { id, type, title, message, duration, action };
      setVisibleToasts((prev) => {
        if (prev.length < MAX_VISIBLE_TOASTS) {
          return [...prev, newToast];
        }
        queueRef.current.push(newToast);
        setQueuedCount(queueRef.current.length);
        return prev;
      });
      return id;
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setVisibleToasts((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length < MAX_VISIBLE_TOASTS && queueRef.current.length > 0) {
        const promoted = queueRef.current.splice(0, MAX_VISIBLE_TOASTS - next.length);
        setQueuedCount(queueRef.current.length);
        return [...next, ...promoted];
      }
      return next;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setVisibleToasts([]);
    queueRef.current = [];
    setQueuedCount(0);
  }, []);

  const success = useCallback(
    (title: string, message?: string, duration?: number, action?: ToastAction) => {
      return addToast('success', title, message, duration ?? getToastDurationMs(), action);
    },
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string, duration?: number, action?: ToastAction) => {
      const base = getToastDurationMs();
      return addToast('error', title, message, duration ?? (base === 0 ? 0 : Math.max(base, 8000)), action);
    },
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string, duration?: number, action?: ToastAction) => {
      const base = getToastDurationMs();
      return addToast('warning', title, message, duration ?? (base === 0 ? 0 : Math.max(base, 6000)), action);
    },
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string, duration?: number, action?: ToastAction) => {
      return addToast('info', title, message, duration ?? getToastDurationMs(), action);
    },
    [addToast]
  );

  /**
   * Shows a success toast for a submitted transaction with a CardanoScan link.
   * Accepts either a plain string message or a TransactionDetails object with
   * type and amount for richer display.
   */
  const transactionSuccess = useCallback(
    (title: string, txHash: string, messageOrDetails?: string | TransactionDetails) => {
      const base = getToastDurationMs();
      const action: ToastAction | undefined = isValidTxHash(txHash)
        ? { label: 'View on CardanoScan', href: getTransactionUrl(txHash) }
        : undefined;

      let message: string;
      if (typeof messageOrDetails === 'string') {
        message = messageOrDetails || `Transaction: ${txHash.slice(0, 16)}...`;
      } else if (messageOrDetails) {
        const parts: string[] = [];
        if (messageOrDetails.type) {
          parts.push(getTypeLabel(messageOrDetails.type));
        }
        if (messageOrDetails.amountLovelace !== undefined && messageOrDetails.amountLovelace > 0) {
          const ada = (messageOrDetails.amountLovelace / 1_000_000).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
          parts.push(`${ada} ADA`);
        }
        if (messageOrDetails.message) {
          parts.push(messageOrDetails.message);
        }
        message = parts.length > 0
          ? parts.join(' \u2014 ')
          : `Transaction: ${txHash.slice(0, 16)}...`;
      } else {
        message = `Transaction: ${txHash.slice(0, 16)}...`;
      }

      return addToast('success', title, message, base === 0 ? 0 : Math.max(base, 8000), action);
    },
    [addToast]
  );

  return {
    toasts: visibleToasts,
    queuedCount,
    addToast,
    removeToast,
    dismissAll,
    success,
    error,
    warning,
    info,
    transactionSuccess,
  };
}

export default Toast;
