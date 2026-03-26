import { useState, useEffect, useRef } from 'react';
import type { BidDisplay } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getFriendlyError, type FriendlyError } from '../services/errorMessages';
import { formatAda } from '../utils/formatAda';

interface UpdateBidModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (bid: BidDisplay, newAmountLovelace: number, newFuturePriceLovelace: number) => Promise<void>;
  bid: BidDisplay | null;
}

export default function UpdateBidModal({
  isOpen,
  onClose,
  onSubmit,
  bid,
}: UpdateBidModalProps) {
  const [amountAda, setAmountAda] = useState('');
  const [futurePriceAda, setFuturePriceAda] = useState('');
  const [futurePriceManuallyEdited, setFuturePriceManuallyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FriendlyError | null>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSubmitError(null);
      setFuturePriceManuallyEdited(false);
      const currentAmountAda = bid?.amount != null
        ? (bid.amount / 1_000_000).toString()
        : '';
      setAmountAda(currentAmountAda);
      const currentFuturePrice = bid?.datum.new_price != null
        ? (bid.datum.new_price / 1_000_000).toString()
        : '';
      setFuturePriceAda(currentFuturePrice);
      setTimeout(() => amountInputRef.current?.focus(), 50);
    }
  }, [isOpen, bid]);

  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('update-bid', isOpen, onClose, isSubmitting);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen);

  const currentAmountAda = bid?.amount != null
    ? bid.amount / 1_000_000
    : undefined;

  const currentFuturePriceAda = bid?.datum.new_price != null
    ? bid.datum.new_price / 1_000_000
    : undefined;

  const validateForm = (): boolean => {
    const trimmedAmount = amountAda.trim();
    const trimmedPrice = futurePriceAda.trim();

    if (!trimmedAmount) {
      setError('Bid amount is required');
      return false;
    }
    const parsedAmount = parseFloat(trimmedAmount.replace(/,/g, ''));
    if (isNaN(parsedAmount)) {
      setError('Bid amount must be a valid number');
      return false;
    }
    if (parsedAmount <= 0) {
      setError('Bid amount must be greater than zero');
      return false;
    }
    if (parsedAmount > 1000000000) {
      setError('Bid amount is too high');
      return false;
    }

    if (!trimmedPrice) {
      setError('Future price is required');
      return false;
    }
    const parsedPrice = parseFloat(trimmedPrice.replace(/,/g, ''));
    if (isNaN(parsedPrice)) {
      setError('Future price must be a valid number');
      return false;
    }
    if (parsedPrice < 0) {
      setError('Future price cannot be negative');
      return false;
    }
    if (parsedPrice > 1000000000) {
      setError('Future price is too high');
      return false;
    }

    const newAmountLovelace = Math.floor(parsedAmount * 1_000_000);
    const newPriceLovelace = Math.floor(parsedPrice * 1_000_000);
    if (bid && newAmountLovelace === bid.amount && newPriceLovelace === bid.datum.new_price) {
      setError('At least one value must differ from current');
      return false;
    }

    setError(null);
    return true;
  };

  const capDecimals = (value: string): string | null => {
    const cleaned = value.replace(/,/g, '');
    const dotIndex = cleaned.indexOf('.');
    if (dotIndex !== -1 && cleaned.length - dotIndex - 1 > 6) return null;
    return value;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = capDecimals(e.target.value);
    if (value === null) return;
    setAmountAda(value);
    // Auto-sync future price if not manually edited
    if (!futurePriceManuallyEdited) {
      setFuturePriceAda(value);
    }
    if (error) setError(null);
    if (submitError) setSubmitError(null);
  };

  const handleFuturePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = capDecimals(e.target.value);
    if (value === null) return;
    setFuturePriceAda(value);
    setFuturePriceManuallyEdited(true);
    if (error) setError(null);
    if (submitError) setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bid) {
      setSubmitError(getFriendlyError('No bid selected'));
      return;
    }

    if (!validateForm()) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const newAmountLovelace = Math.floor(parseFloat(amountAda.replace(/,/g, '')) * 1_000_000);
      const newPriceLovelace = Math.floor(parseFloat(futurePriceAda.replace(/,/g, '')) * 1_000_000);
      await onSubmit(bid, newAmountLovelace, newPriceLovelace);
      onClose();
    } catch (err) {
      setSubmitError(getFriendlyError(err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-[var(--space-md)] transition-opacity duration-200 ${
        animationState === 'entering' || animationState === 'exiting' ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ zIndex }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isSubmitting ? undefined : onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`relative bg-[var(--bg-card)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] border border-[var(--border-subtle)] w-full max-w-md transform transition-transform duration-200 ${
          animationState === 'entering' || animationState === 'exiting' ? 'scale-95' : 'scale-100'
        }`}
      >
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="p-[var(--space-lg)] border-b border-[var(--border-subtle)]">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Update Bid</h2>
          </div>

          {/* Body */}
          <div className="p-[var(--space-lg)] space-y-[var(--space-md)]">
            {/* Current values display */}
            <div className="space-y-[var(--space-2)]">
              {currentAmountAda !== undefined && (
                <div className="flex items-center justify-between p-[var(--space-3)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  <span className="text-sm text-[var(--text-muted)]">Current bid</span>
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {formatAda(bid!.amount)} ADA
                  </span>
                </div>
              )}
              {currentFuturePriceAda !== undefined && currentFuturePriceAda > 0 && (
                <div className="flex items-center justify-between p-[var(--space-3)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  <span className="text-sm text-[var(--text-muted)]">Current future price</span>
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {formatAda(bid!.datum.new_price)} ADA
                  </span>
                </div>
              )}
            </div>

            {/* Bid amount input */}
            <div>
              <label htmlFor="update-bid-amount-input" className="block text-sm font-medium text-[var(--text-secondary)] mb-[var(--space-1)]">
                Bid Amount (ADA)
              </label>
              <input
                ref={amountInputRef}
                id="update-bid-amount-input"
                type="text"
                inputMode="decimal"
                value={amountAda}
                onChange={handleAmountChange}
                onBlur={() => { if (amountAda.trim()) validateForm(); }}
                disabled={isSubmitting}
                placeholder="0"
                className={`w-full px-[var(--space-3)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] border bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 ${
                  error
                    ? 'border-[var(--error)] focus:border-[var(--error)]'
                    : 'border-[var(--border-default)] focus:border-[var(--accent)]'
                }`}
              />
              {amountAda.trim() && !isNaN(parseFloat(amountAda)) && parseFloat(amountAda) >= 0 && (
                <p className="mt-[var(--space-1)] text-xs text-[var(--text-muted)]">
                  = {Math.floor(parseFloat(amountAda.replace(/,/g, '')) * 1_000_000).toLocaleString()} lovelace
                </p>
              )}
            </div>

            {/* Future price input */}
            <div>
              <label htmlFor="update-bid-price-input" className="block text-sm font-medium text-[var(--text-secondary)] mb-[var(--space-1)]">
                Future Price (ADA)
              </label>
              <input
                id="update-bid-price-input"
                type="text"
                inputMode="decimal"
                value={futurePriceAda}
                onChange={handleFuturePriceChange}
                onBlur={() => { if (futurePriceAda.trim()) validateForm(); }}
                disabled={isSubmitting}
                placeholder="0"
                className={`w-full px-[var(--space-3)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] border bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 ${
                  error
                    ? 'border-[var(--error)] focus:border-[var(--error)]'
                    : 'border-[var(--border-default)] focus:border-[var(--accent)]'
                }`}
              />
              {futurePriceAda.trim() && !isNaN(parseFloat(futurePriceAda)) && parseFloat(futurePriceAda) >= 0 && (
                <p className="mt-[var(--space-1)] text-xs text-[var(--text-muted)]">
                  = {Math.floor(parseFloat(futurePriceAda.replace(/,/g, '')) * 1_000_000).toLocaleString()} lovelace
                </p>
              )}
              {!futurePriceManuallyEdited && (
                <p className="mt-[var(--space-1)] text-xs text-[var(--text-muted)] italic">
                  Auto-synced to bid amount
                </p>
              )}
            </div>

            {/* Validation error */}
            {error && (
              <p className="text-xs text-[var(--error)]">{error}</p>
            )}

            {/* Submit error */}
            {submitError && (
              <div className="p-[var(--space-3)] bg-[var(--error-muted)] rounded-[var(--radius-md)] border border-[var(--error)]/20">
                <p className="text-sm font-medium text-[var(--error)]">{submitError.title}</p>
                <p className="text-xs text-[var(--text-muted)] mt-[var(--space-1)]">{submitError.message}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-[var(--space-lg)] border-t border-[var(--border-subtle)] flex justify-end gap-[var(--space-3)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-[var(--space-md)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-[var(--space-md)] py-[var(--space-2)] text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary flex items-center gap-[var(--space-2)]"
            >
              {isSubmitting && <LoadingSpinner size="sm" />}
              {isSubmitting ? 'Updating...' : 'Update Bid'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
