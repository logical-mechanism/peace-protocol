import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { BidDisplay } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getFriendlyError, type FriendlyError } from '../services/errorMessages';
import { formatAda, formatWithCommas, stripCommas } from '../utils/formatAda';

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
  const { t } = useTranslation(['modals', 'common']);
  const [amountAda, setAmountAda] = useState('');
  const [futurePriceAda, setFuturePriceAda] = useState('');
  // Display strings carry thousands-separator commas at rest; the *Ada state
  // values stay comma-free so existing parseFloat calls keep working.
  const [displayAmount, setDisplayAmount] = useState('');
  const [displayFuturePrice, setDisplayFuturePrice] = useState('');
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
      setDisplayAmount(formatWithCommas(currentAmountAda));
      const currentFuturePrice = bid?.datum.new_price != null
        ? (bid.datum.new_price / 1_000_000).toString()
        : '';
      setFuturePriceAda(currentFuturePrice);
      setDisplayFuturePrice(formatWithCommas(currentFuturePrice));
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
      setError(t('modals:updateBid.errors.amountRequired'));
      return false;
    }
    const parsedAmount = parseFloat(trimmedAmount.replace(/,/g, ''));
    if (isNaN(parsedAmount)) {
      setError(t('modals:updateBid.errors.amountInvalid'));
      return false;
    }
    if (parsedAmount <= 0) {
      setError(t('modals:updateBid.errors.amountPositive'));
      return false;
    }
    if (parsedAmount > 45_000_000_000) {
      setError(t('modals:updateBid.errors.amountMax'));
      return false;
    }

    if (!trimmedPrice) {
      setError(t('modals:updateBid.errors.priceRequired'));
      return false;
    }
    const parsedPrice = parseFloat(trimmedPrice.replace(/,/g, ''));
    if (isNaN(parsedPrice)) {
      setError(t('modals:updateBid.errors.priceInvalid'));
      return false;
    }
    if (parsedPrice < 0) {
      setError(t('modals:updateBid.errors.priceNegative'));
      return false;
    }
    if (parsedPrice > 45_000_000_000) {
      setError(t('modals:updateBid.errors.priceMax'));
      return false;
    }

    const newAmountLovelace = Math.floor(parsedAmount * 1_000_000);
    const newPriceLovelace = Math.floor(parsedPrice * 1_000_000);
    if (bid && newAmountLovelace === bid.amount && newPriceLovelace === bid.datum.new_price) {
      setError(t('modals:updateBid.errors.noChange'));
      return false;
    }

    setError(null);
    return true;
  };

  // Returns { raw, display } with raw stripped of commas and clamped to the
  // 6-decimal / 45B-ADA caps; null when the value should be rejected outright.
  const sanitize = (value: string): { raw: string; display: string } | null => {
    const cleaned = stripCommas(value);
    const dotIndex = cleaned.indexOf('.');
    if (dotIndex !== -1 && cleaned.length - dotIndex - 1 > 6) return null;
    if (cleaned && !/^[0-9]*\.?[0-9]*$/.test(cleaned)) return null;
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed) && parsed > 45_000_000_000) {
      return { raw: '45000000000', display: '45000000000' };
    }
    return { raw: cleaned, display: value };
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitize(e.target.value);
    if (next === null) return;
    setAmountAda(next.raw);
    setDisplayAmount(next.display);
    // Auto-sync future price if not manually edited
    if (!futurePriceManuallyEdited) {
      setFuturePriceAda(next.raw);
      setDisplayFuturePrice(next.display);
    }
    if (error) setError(null);
    if (submitError) setSubmitError(null);
  };

  const handleAmountFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setDisplayAmount(amountAda);
    e.target.select();
  };

  const handleAmountBlur = () => {
    setDisplayAmount(formatWithCommas(amountAda));
    if (amountAda.trim()) validateForm();
  };

  const handleFuturePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitize(e.target.value);
    if (next === null) return;
    setFuturePriceAda(next.raw);
    setDisplayFuturePrice(next.display);
    setFuturePriceManuallyEdited(true);
    if (error) setError(null);
    if (submitError) setSubmitError(null);
  };

  const handleFuturePriceFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setDisplayFuturePrice(futurePriceAda);
    e.target.select();
  };

  const handleFuturePriceBlur = () => {
    setDisplayFuturePrice(formatWithCommas(futurePriceAda));
    if (futurePriceAda.trim()) validateForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bid) {
      setSubmitError(getFriendlyError(t('modals:updateBid.errors.noBid')));
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
      setSubmitError(getFriendlyError(err instanceof Error ? err.message : t('modals:updateBid.errors.unknown')));
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
        className="absolute inset-0 bg-[var(--backdrop-overlay)] backdrop-blur-sm"
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-bid-title"
        className={`relative bg-[var(--bg-card)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] border border-[var(--border-subtle)] w-full max-w-md transform transition-transform duration-200 ${
          animationState === 'entering' || animationState === 'exiting' ? 'scale-95' : 'scale-100'
        }`}
      >
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="p-[var(--space-lg)] border-b border-[var(--border-subtle)]">
            <h2 id="update-bid-title" className="text-lg font-semibold text-[var(--text-primary)]">{t('modals:updateBid.title')}</h2>
          </div>

          {/* Body */}
          <div className="p-[var(--space-lg)] space-y-[var(--space-md)]">
            {/* Current values display */}
            <div className="space-y-[var(--space-2)]">
              {currentAmountAda !== undefined && (
                <div className="flex items-center justify-between p-[var(--space-3)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  <span className="text-sm text-[var(--text-muted)]">{t('modals:updateBid.currentBid')}</span>
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {formatAda(bid!.amount)} ADA
                  </span>
                </div>
              )}
              {currentFuturePriceAda !== undefined && currentFuturePriceAda > 0 && (
                <div className="flex items-center justify-between p-[var(--space-3)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  <span className="text-sm text-[var(--text-muted)]">{t('modals:updateBid.currentFuturePrice')}</span>
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {formatAda(bid!.datum.new_price)} ADA
                  </span>
                </div>
              )}
            </div>

            {/* Bid amount input */}
            <div>
              <label htmlFor="update-bid-amount-input" className="block text-sm font-medium text-[var(--text-secondary)] mb-[var(--space-1)]">
                {t('modals:updateBid.bidAmountLabel')}
              </label>
              <input
                ref={amountInputRef}
                id="update-bid-amount-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={displayAmount}
                onChange={handleAmountChange}
                onFocus={handleAmountFocus}
                onBlur={handleAmountBlur}
                disabled={isSubmitting}
                placeholder="0"
                aria-invalid={!!error}
                aria-describedby="update-bid-amount-hint"
                className={`w-full px-[var(--space-3)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] border bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 ${
                  error
                    ? 'border-[var(--error)] focus:border-[var(--error)]'
                    : 'border-[var(--border-default)] focus:border-[var(--accent)]'
                }`}
              />
              {amountAda.trim() && !isNaN(parseFloat(amountAda)) && parseFloat(amountAda) >= 0 && (
                <p id="update-bid-amount-hint" className="mt-[var(--space-1)] text-xs text-[var(--text-muted)]">
                  {t('modals:updateBid.lovelaceSuffix', { amount: Math.floor(parseFloat(amountAda.replace(/,/g, '')) * 1_000_000).toLocaleString() })}
                </p>
              )}
            </div>

            {/* Future price input */}
            <div>
              <label htmlFor="update-bid-price-input" className="block text-sm font-medium text-[var(--text-secondary)] mb-[var(--space-1)]">
                {t('modals:updateBid.futurePriceLabel')}
              </label>
              <input
                id="update-bid-price-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={displayFuturePrice}
                onChange={handleFuturePriceChange}
                onFocus={handleFuturePriceFocus}
                onBlur={handleFuturePriceBlur}
                disabled={isSubmitting}
                placeholder="0"
                aria-invalid={!!error}
                aria-describedby="update-bid-price-hint"
                className={`w-full px-[var(--space-3)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] border bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 ${
                  error
                    ? 'border-[var(--error)] focus:border-[var(--error)]'
                    : 'border-[var(--border-default)] focus:border-[var(--accent)]'
                }`}
              />
              {futurePriceAda.trim() && !isNaN(parseFloat(futurePriceAda)) && parseFloat(futurePriceAda) >= 0 && (
                <p id="update-bid-price-hint" className="mt-[var(--space-1)] text-xs text-[var(--text-muted)]">
                  {t('modals:updateBid.lovelaceSuffix', { amount: Math.floor(parseFloat(futurePriceAda.replace(/,/g, '')) * 1_000_000).toLocaleString() })}
                </p>
              )}
              {!futurePriceManuallyEdited && (
                <p className="mt-[var(--space-1)] text-xs text-[var(--text-muted)] italic">
                  {t('modals:updateBid.autoSynced')}
                </p>
              )}
            </div>

            {/* Validation error */}
            {error && (
              <p role="alert" className="text-xs text-[var(--error)]">{error}</p>
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
              {t('common:actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-[var(--space-md)] py-[var(--space-2)] text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary flex items-center gap-[var(--space-2)]"
            >
              {isSubmitting && <LoadingSpinner size="sm" />}
              {isSubmitting ? t('modals:updateBid.submitting') : t('modals:updateBid.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
