import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptionDisplay } from '../services/api';
import { truncateHex } from '../utils/truncate';
import LoadingSpinner from './LoadingSpinner';
import InfoTooltip from './InfoTooltip';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { copyToClipboard } from '../utils/clipboard';
import { saveBidFormDraft, getBidFormDraft, clearBidFormDraft } from '../services/bidFormDraftStorage';
import { getFriendlyError, type FriendlyError } from '../services/errorMessages';
import { formatAda, formatWithCommas, stripCommas } from '../utils/formatAda';

interface PlaceBidFormData {
  bidAmount: string;
  futurePrice: string;
}

interface FormErrors {
  bidAmount?: string;
  futurePrice?: string;
}

interface PlaceBidModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    encryptionTokenName: string,
    bidAmountAda: number,
    encryptionUtxo: { txHash: string; outputIndex: number },
    futurePrice: number
  ) => Promise<void>;
  encryption: EncryptionDisplay | null;
  bidCount?: number;
  balanceLovelace?: string;
}

const INITIAL_FORM_DATA: PlaceBidFormData = {
  bidAmount: '',
  futurePrice: '',
};

// Minimum bid in ADA (Cardano requires each UTxO to hold at least ~2 ADA)
const MIN_BID_ADA = 2;

// ADA reserved for transaction fees when using Max button
const FEE_RESERVE_ADA = 5;

export default function PlaceBidModal({
  isOpen,
  onClose,
  onSubmit,
  encryption,
  bidCount = 0,
  balanceLovelace,
}: PlaceBidModalProps) {
  const { t } = useTranslation(['modals', 'common']);
  const [formData, setFormData] = useState<PlaceBidFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FriendlyError | null>(null);
  const [copiedError, setCopiedError] = useState(false);
  const [showFuturePrice, setShowFuturePrice] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  // Display strings that may contain thousands-separator commas at rest;
  // formData holds the comma-stripped raw value used for parsing/submit.
  const [displayBidAmount, setDisplayBidAmount] = useState('');
  const [displayFuturePrice, setDisplayFuturePrice] = useState('');
  const bidAmountRef = useRef<HTMLInputElement>(null);
  const futurePriceRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens (only on isOpen transition)
  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setSubmitError(null);
      setRestoredFromDraft(false);

      // Try to restore from a saved draft for this encryption
      const draft = encryption ? getBidFormDraft(encryption.tokenName) : null;
      if (draft) {
        setFormData({ bidAmount: draft.bidAmount, futurePrice: draft.futurePrice });
        setDisplayBidAmount(formatWithCommas(draft.bidAmount));
        setDisplayFuturePrice(formatWithCommas(draft.futurePrice));
        setShowFuturePrice(draft.showFuturePrice);
        setRestoredFromDraft(true);
      } else {
        const suggestedAda = encryption?.suggestedPrice != null
          ? (encryption.suggestedPrice / 1_000_000).toString()
          : '';
        setFormData({
          bidAmount: suggestedAda,
          futurePrice: suggestedAda,
        });
        setDisplayBidAmount(formatWithCommas(suggestedAda));
        setDisplayFuturePrice(formatWithCommas(suggestedAda));
        setShowFuturePrice(false);
      }
      setTimeout(() => bidAmountRef.current?.focus(), 50);
    }
  }, [isOpen, encryption]);

  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('place-bid', isOpen, onClose, isSubmitting);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen);

  // Derived: check if bid is below suggested price (convert lovelace to ADA for comparison)
  const parsedBid = parseFloat(formData.bidAmount);
  const suggestedPriceAda = encryption?.suggestedPrice != null ? encryption.suggestedPrice / 1_000_000 : undefined;
  const isBelowSuggested =
    suggestedPriceAda != null &&
    !isNaN(parsedBid) &&
    parsedBid > 0 &&
    parsedBid < suggestedPriceAda;

  // Derived: wallet balance in ADA (with NaN safety for slow Kupo responses)
  const parsedLovelace = parseInt(balanceLovelace ?? '0', 10);
  const balanceAda =
    balanceLovelace !== undefined && !isNaN(parsedLovelace) ? parsedLovelace / 1_000_000 : undefined;

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Bid amount validation
    if (!formData.bidAmount.trim()) {
      newErrors.bidAmount = t('modals:placeBid.errors.bidRequired');
    } else {
      const amount = parseFloat(formData.bidAmount.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        newErrors.bidAmount = t('modals:placeBid.errors.bidPositive');
      } else if (amount < MIN_BID_ADA) {
        newErrors.bidAmount = t('modals:placeBid.errors.bidMin', { amount: MIN_BID_ADA });
      } else if (amount > 45_000_000_000) {
        newErrors.bidAmount = t('modals:placeBid.errors.bidMax');
      } else if (balanceAda !== undefined && amount > balanceAda) {
        newErrors.bidAmount = t('modals:placeBid.errors.bidExceedsBalance');
      }
    }

    // Future price validation (only if section is open and value provided)
    if (showFuturePrice && formData.futurePrice.trim()) {
      const price = parseFloat(formData.futurePrice.replace(/,/g, ''));
      if (isNaN(price) || price < 0) {
        newErrors.futurePrice = t('modals:placeBid.errors.futureNegative');
      } else if (price > 45_000_000_000) {
        newErrors.futurePrice = t('modals:placeBid.errors.futureMax');
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Strip commas from ADA amounts so "1,000" parses as 1000, not 1
    let sanitized = (name === 'bidAmount' || name === 'futurePrice')
      ? stripCommas(value)
      : value;
    let displayValue = value;
    // Cap price fields at 6 decimal places (1 lovelace = 0.000001 ADA)
    if (name === 'bidAmount' || name === 'futurePrice') {
      const dotIndex = sanitized.indexOf('.');
      if (dotIndex !== -1 && sanitized.length - dotIndex - 1 > 6) return;
      // Reject characters that aren't part of a numeric literal so users can't
      // sneak letters past the type=text input. Allow empty so they can clear.
      if (sanitized && !/^[0-9]*\.?[0-9]*$/.test(sanitized)) return;
      // Clamp to Cardano max supply (45 billion ADA). When clamped, show the
      // clamped value (without commas — focus is in the field while typing).
      const parsed = parseFloat(sanitized);
      if (!isNaN(parsed) && parsed > 45_000_000_000) {
        sanitized = '45000000000';
        displayValue = '45000000000';
      }
    }
    setFormData((prev) => ({ ...prev, [name]: sanitized }));
    if (name === 'bidAmount') setDisplayBidAmount(displayValue);
    else if (name === 'futurePrice') setDisplayFuturePrice(displayValue);
    // Clear error when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setSubmitError(null);
  };

  // Validate bid amount on blur for immediate feedback (only if user entered a value)
  const handleBidAmountBlur = () => {
    setDisplayBidAmount(formatWithCommas(formData.bidAmount));
    if (formData.bidAmount.trim()) {
      validateForm();
    }
  };

  const handleBidAmountFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setDisplayBidAmount(formData.bidAmount);
    e.target.select();
  };

  const handleFuturePriceBlur = () => {
    setDisplayFuturePrice(formatWithCommas(formData.futurePrice));
  };

  const handleFuturePriceFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setDisplayFuturePrice(formData.futurePrice);
    e.target.select();
  };

  // Quick-action buttons (Suggested / +10 / +25 / Max) need to update both the
  // raw form value and the formatted display, since the input is not focused.
  const setBidAmount = (raw: string) => {
    setFormData((prev) => ({ ...prev, bidAmount: raw }));
    setDisplayBidAmount(formatWithCommas(raw));
  };
  const setFuturePrice = (raw: string) => {
    setFormData((prev) => ({ ...prev, futurePrice: raw }));
    setDisplayFuturePrice(formatWithCommas(raw));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!encryption) {
      setSubmitError(getFriendlyError(t('modals:placeBid.errors.noEncryption')));
      return;
    }

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const bidAmountAda = parseFloat(formData.bidAmount.replace(/,/g, ''));
      const futurePrice = showFuturePrice && formData.futurePrice.trim()
        ? parseFloat(formData.futurePrice.replace(/,/g, ''))
        : (encryption?.suggestedPrice != null ? encryption.suggestedPrice / 1_000_000 : bidAmountAda);
      await onSubmit(encryption.tokenName, bidAmountAda, encryption.utxo, futurePrice);
      clearBidFormDraft();
      onClose();
    } catch (error) {
      console.error('Failed to place bid:', error);
      const rawMsg = error instanceof Error ? error.message : t('modals:placeBid.errors.submitFailed');
      setSubmitError(getFriendlyError(rawMsg));
      // Save form state so user can retry without re-entering
      saveBidFormDraft({
        encryptionTokenName: encryption.tokenName,
        bidAmount: formData.bidAmount,
        futurePrice: formData.futurePrice,
        showFuturePrice,
        savedAt: new Date().toISOString(),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!shouldRender || !encryption) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="place-bid-title"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-[var(--backdrop-overlay)] backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal — no overflow-hidden on panel root so focus outlines aren't clipped. */}
      <div className={`relative w-full max-w-2xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg flex flex-col mx-4 ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] rounded-t-[var(--radius-xl)]">
          <div>
            <h2 id="place-bid-title" className="text-lg font-semibold text-[var(--text-primary)]">{t('modals:placeBid.title')}</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t('modals:placeBid.subtitle')}
            </p>
            {bidCount > 0 && (
              <p className="text-xs text-[var(--accent)] mt-0.5">
                {t('modals:placeBid.bidsOnListing', { count: bidCount })}
              </p>
            )}
          </div>
          {/* tabIndex={-1}: Escape closes. */}
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label={t('modals:common.closeDialog')}
            tabIndex={-1}
            className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Listing Info */}
            <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)]">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
                {t('modals:placeBid.listingDetails')}
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">{t('modals:placeBid.token')}</span>
                  <span className="text-xs font-mono text-[var(--text-secondary)]" title={encryption.tokenName}>
                    {truncateHex(encryption.tokenName, 8, 4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">{t('modals:placeBid.seller')}</span>
                  <span className="text-xs font-mono text-[var(--text-secondary)]" title={encryption.sellerPkh}>
                    {truncateHex(encryption.sellerPkh, 10, 6)}
                  </span>
                </div>
                {encryption.suggestedPrice !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-xs text-[var(--text-muted)]">{t('modals:placeBid.suggestedPrice')}</span>
                    <span className="text-xs font-medium tnum text-[var(--text-primary)]">
                      {formatAda(encryption.suggestedPrice)} ADA
                    </span>
                  </div>
                )}
                {encryption.description && (
                  <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                    <span className="text-xs text-[var(--text-muted)]">{t('modals:placeBid.description')}</span>
                    <p
                      className="text-sm text-[var(--text-secondary)] mt-1 line-clamp-1"
                      title={encryption.description}
                    >
                      {encryption.description}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Restored from draft indicator */}
            {restoredFromDraft && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--accent-muted)] rounded-[var(--radius-md)] text-xs text-[var(--accent)]">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('modals:placeBid.restoredFromDraft')}
              </div>
            )}

            {/* Bid Amount */}
            <div id="tutorial-bid-amount">
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="bidAmount"
                  className="text-sm font-medium text-[var(--text-primary)]"
                >
                  {t('modals:placeBid.bidAmountLabel')} <span className="text-[var(--error)]">*</span>
                </label>
                {(suggestedPriceAda !== undefined && suggestedPriceAda > 0) || balanceAda !== undefined ? (
                  <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-secondary)]">
                    {suggestedPriceAda !== undefined && suggestedPriceAda > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setBidAmount(suggestedPriceAda!.toString())}
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-card-hover)] border-r border-[var(--border-subtle)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--transition-fast)]"
                        >
                          {t('modals:placeBid.suggestedButton', { amount: formatAda(encryption.suggestedPrice!) })}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setBidAmount((Math.floor(encryption.suggestedPrice! * 1.1) / 1_000_000).toString())
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-card-hover)] border-r border-[var(--border-subtle)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--transition-fast)]"
                        >
                          {t('modals:placeBid.plusTen')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setBidAmount((Math.floor(encryption.suggestedPrice! * 1.25) / 1_000_000).toString())
                          }
                          disabled={isSubmitting}
                          className={`px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-card-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--transition-fast)] ${balanceAda !== undefined ? 'border-r border-[var(--border-subtle)]' : ''}`}
                        >
                          {t('modals:placeBid.plusTwentyFive')}
                        </button>
                      </>
                    )}
                    {balanceAda !== undefined && (
                      <button
                        type="button"
                        onClick={() => {
                          const maxBid = Math.max(
                            Math.floor(balanceAda - FEE_RESERVE_ADA),
                            MIN_BID_ADA
                          );
                          setBidAmount(maxBid.toString());
                          if (errors.bidAmount) {
                            setErrors((prev) => ({ ...prev, bidAmount: undefined }));
                          }
                          setSubmitError(null);
                        }}
                        disabled={isSubmitting || balanceAda <= FEE_RESERVE_ADA}
                        className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-card-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--transition-fast)]"
                      >
                        {t('modals:placeBid.maxButton')}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-1.5">{t('modals:placeBid.minimumBidHint', { amount: MIN_BID_ADA })}</p>
              <div className="relative">
                <input
                  ref={bidAmountRef}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  id="bidAmount"
                  name="bidAmount"
                  value={displayBidAmount}
                  onChange={handleInputChange}
                  onFocus={handleBidAmountFocus}
                  onBlur={handleBidAmountBlur}
                  disabled={isSubmitting}
                  placeholder="0.00"
                  aria-invalid={!!errors.bidAmount}
                  aria-describedby={errors.bidAmount ? 'bidAmount-error' : 'bidAmount-hint'}
                  className={`w-full px-3 py-2.5 text-sm tnum bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 pr-12 ${
                    errors.bidAmount ? 'field-invalid' : 'border-[var(--border-subtle)]'
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                  ADA
                </span>
              </div>
              {errors.bidAmount && (
                <p id="bidAmount-error" role="alert" className="field-invalid-helper">{errors.bidAmount}</p>
              )}
              {!errors.bidAmount && isBelowSuggested && (
                <p className="mt-1 text-xs text-[var(--warning)]">
                  {t('modals:placeBid.belowSuggested', { amount: formatAda(encryption.suggestedPrice!) })}
                </p>
              )}
              <div className="mt-3 space-y-1">
                <p id="bidAmount-hint" className="text-xs text-[var(--text-muted)]">
                  {t('modals:placeBid.bidHint', { amount: MIN_BID_ADA })}
                  <InfoTooltip text={t('modals:placeBid.minimumTooltip')} />
                </p>
                {balanceAda !== undefined ? (
                  <span className="text-xs text-[var(--text-secondary)]">
                    {t('modals:placeBid.balance', { amount: balanceAda.toLocaleString(undefined, { maximumFractionDigits: 2 }) })}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">
                    {t('modals:placeBid.balanceLoading')}
                  </span>
                )}
              </div>
            </div>

            {/* Future Listing Price (collapsible) */}
            <div id="tutorial-future-price" className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFuturePrice(!showFuturePrice)}
                disabled={isSubmitting}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm btn-base btn-tertiary border-0"
              >
                <span>{t('modals:placeBid.setFuturePrice')}</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-[var(--transition-fast)] ${showFuturePrice ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showFuturePrice && (
                <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between mb-2">
                    <label
                      htmlFor="futurePrice"
                      className="text-sm font-medium text-[var(--text-primary)] inline-flex items-center gap-1"
                    >
                      {t('modals:placeBid.futurePriceLabel')}{' '}
                      <span className="text-[var(--text-muted)] font-normal">{t('modals:placeBid.futurePriceOptional')}</span>
                      <InfoTooltip text={t('modals:placeBid.futurePriceTooltip')} />
                    </label>
                    {suggestedPriceAda !== undefined && suggestedPriceAda > 0 && (
                      <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-secondary)]">
                        <button
                          type="button"
                          onClick={() => setFuturePrice(suggestedPriceAda!.toString())}
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-card-hover)] border-r border-[var(--border-subtle)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--transition-fast)]"
                        >
                          {t('modals:placeBid.samePrice')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFuturePrice((Math.floor(encryption.suggestedPrice! * 1.1) / 1_000_000).toString())
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-card-hover)] border-r border-[var(--border-subtle)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--transition-fast)]"
                        >
                          +10%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFuturePrice((Math.floor(encryption.suggestedPrice! * 1.25) / 1_000_000).toString())
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-card-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--transition-fast)]"
                        >
                          +25%
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      ref={futurePriceRef}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      id="futurePrice"
                      name="futurePrice"
                      value={displayFuturePrice}
                      onChange={handleInputChange}
                      onFocus={handleFuturePriceFocus}
                      onBlur={handleFuturePriceBlur}
                      disabled={isSubmitting}
                      placeholder="0.00"
                      aria-invalid={!!errors.futurePrice}
                      aria-describedby={errors.futurePrice ? 'futurePrice-error' : undefined}
                      className={`w-full px-3 py-2.5 text-sm tnum bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 pr-12 ${
                        errors.futurePrice ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                      }`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                      ADA
                    </span>
                  </div>
                  {errors.futurePrice && (
                    <p id="futurePrice-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.futurePrice}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {t('modals:placeBid.futurePriceHelp')}
                  </p>
                </div>
              )}
            </div>

            {/* Submit Error */}
            {submitError && (
              <div className="flex items-start gap-2 p-3 bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-[var(--radius-md)]">
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-[var(--error)]">{submitError.title}</p>
                  <p className="text-sm text-[var(--error)]">{submitError.message}</p>
                  {submitError.action && (
                    <p className="text-xs text-[var(--text-muted)]">{submitError.action}</p>
                  )}
                </div>
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(`${submitError.title}: ${submitError.message}`);
                    if (ok) { setCopiedError(true); setTimeout(() => setCopiedError(false), 1500); }
                  }}
                  className="flex-shrink-0 p-1 text-[var(--error)]/60 hover:text-[var(--error)] transition-colors cursor-pointer"
                  aria-label={t('modals:placeBid.copyErrorLabel')}
                >
                  {copiedError ? (
                    <svg className="w-4 h-4 text-[var(--success)] copy-check-animate" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] rounded-b-[var(--radius-xl)]">
            {/* Info box about what happens next */}
            <div className="mb-4 p-3 bg-[var(--accent-muted)] rounded-[var(--radius-md)]">
              <p className="text-xs text-[var(--accent)]">
                <strong>{t('modals:placeBid.infoNoteLabel')}</strong> {t('modals:placeBid.infoNote')}
              </p>
            </div>


            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {t('common:actions.cancel')}
              </button>
              <button
                id="tutorial-submit-bid"
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-2 btn-base btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <LoadingSpinner size="sm" />
                    {t('modals:placeBid.submitting')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    {t('modals:placeBid.submit')}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Export form data type for use in other components
export type { PlaceBidFormData };
