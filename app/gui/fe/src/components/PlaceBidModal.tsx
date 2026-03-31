import { useState, useEffect, useRef } from 'react';
import type { EncryptionDisplay } from '../services/api';
import { truncateHex } from '../utils/truncate';
import LoadingSpinner from './LoadingSpinner';
import InfoTooltip from './InfoTooltip';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { copyToClipboard } from '../utils/clipboard';
import { saveBidFormDraft, getBidFormDraft, clearBidFormDraft } from '../services/bidFormDraftStorage';
import { getFriendlyError, type FriendlyError } from '../services/errorMessages';
import { formatAda } from '../utils/formatAda';

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
  const [formData, setFormData] = useState<PlaceBidFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FriendlyError | null>(null);
  const [copiedError, setCopiedError] = useState(false);
  const [showFuturePrice, setShowFuturePrice] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const bidAmountRef = useRef<HTMLInputElement>(null);

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
      newErrors.bidAmount = 'Bid amount is required';
    } else {
      const amount = parseFloat(formData.bidAmount.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        newErrors.bidAmount = 'Bid amount must be a positive number';
      } else if (amount < MIN_BID_ADA) {
        newErrors.bidAmount = `Minimum bid is ${MIN_BID_ADA} ADA`;
      } else if (amount > 1000000000) {
        newErrors.bidAmount = 'Bid amount is too high';
      } else if (balanceAda !== undefined && amount > balanceAda) {
        newErrors.bidAmount = 'Bid exceeds your wallet balance';
      }
    }

    // Future price validation (only if section is open and value provided)
    if (showFuturePrice && formData.futurePrice.trim()) {
      const price = parseFloat(formData.futurePrice.replace(/,/g, ''));
      if (isNaN(price) || price < 0) {
        newErrors.futurePrice = 'Future price must be a non-negative number';
      } else if (price > 1000000000) {
        newErrors.futurePrice = 'Future price is too high';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Strip commas from ADA amounts so "1,000" parses as 1000, not 1
    const sanitized = (name === 'bidAmount' || name === 'futurePrice')
      ? value.replace(/,/g, '')
      : value;
    // Cap price fields at 6 decimal places (1 lovelace = 0.000001 ADA)
    if (name === 'bidAmount' || name === 'futurePrice') {
      const dotIndex = sanitized.indexOf('.');
      if (dotIndex !== -1 && sanitized.length - dotIndex - 1 > 6) return;
    }
    setFormData((prev) => ({ ...prev, [name]: sanitized }));
    // Clear error when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setSubmitError(null);
  };

  // Validate bid amount on blur for immediate feedback (only if user entered a value)
  const handleBidAmountBlur = () => {
    if (formData.bidAmount.trim()) {
      validateForm();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!encryption) {
      setSubmitError(getFriendlyError('No encryption selected'));
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
      const rawMsg = error instanceof Error ? error.message : 'Failed to place bid. Please try again.';
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
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className={`relative w-full max-w-2xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden flex flex-col mx-4 ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="place-bid-title" className="text-lg font-semibold text-[var(--text-primary)]">Place Bid</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Bid on encrypted data listing
            </p>
            {bidCount > 0 && (
              <p className="text-xs text-[var(--accent)] mt-0.5">
                {bidCount} {bidCount === 1 ? 'bid' : 'bids'} on this listing
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
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
                Listing Details
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Token</span>
                  <span className="text-xs font-mono text-[var(--text-secondary)]" title={encryption.tokenName}>
                    {truncateHex(encryption.tokenName, 8, 4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Seller</span>
                  <span className="text-xs font-mono text-[var(--text-secondary)]" title={encryption.seller}>
                    {truncateHex(encryption.seller, 10, 6)}
                  </span>
                </div>
                {encryption.suggestedPrice !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Suggested Price</span>
                    <span className="text-xs font-medium text-[var(--accent)]">
                      {formatAda(encryption.suggestedPrice)} ADA
                    </span>
                  </div>
                )}
                {encryption.description && (
                  <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                    <span className="text-xs text-[var(--text-muted)]">Description</span>
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
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-[var(--radius-md)] text-xs text-[var(--accent)]">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Restored from previous attempt
              </div>
            )}

            {/* Bid Amount */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="bidAmount"
                  className="text-sm font-medium text-[var(--text-primary)]"
                >
                  Your Bid Amount (ADA) <span className="text-[var(--error)]">*</span>
                </label>
                {suggestedPriceAda !== undefined && suggestedPriceAda > 0 && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, bidAmount: suggestedPriceAda!.toString() }))
                      }
                      disabled={isSubmitting}
                      className="px-2 py-1 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                    >
                      Suggested ({formatAda(encryption.suggestedPrice!)} ADA)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          bidAmount: (Math.floor(encryption.suggestedPrice! * 1.1) / 1_000_000).toString(),
                        }))
                      }
                      disabled={isSubmitting}
                      className="px-2 py-1 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                    >
                      +10%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          bidAmount: (Math.floor(encryption.suggestedPrice! * 1.25) / 1_000_000).toString(),
                        }))
                      }
                      disabled={isSubmitting}
                      className="px-2 py-1 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                    >
                      +25%
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-1.5">Minimum bid: {MIN_BID_ADA} ADA</p>
              <div className="relative">
                <input
                  ref={bidAmountRef}
                  type="number"
                  inputMode="decimal"
                  id="bidAmount"
                  name="bidAmount"
                  value={formData.bidAmount}
                  onChange={handleInputChange}
                  onBlur={handleBidAmountBlur}
                  disabled={isSubmitting}
                  placeholder="0.00"
                  min={MIN_BID_ADA}
                  max={balanceAda !== undefined ? balanceAda - FEE_RESERVE_ADA : undefined}
                  step="0.1"
                  aria-invalid={!!errors.bidAmount}
                  aria-describedby={errors.bidAmount ? 'bidAmount-error' : 'bidAmount-hint'}
                  className={`w-full px-3 py-2.5 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 pr-12 ${
                    errors.bidAmount ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                  ADA
                </span>
              </div>
              {errors.bidAmount && (
                <p id="bidAmount-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.bidAmount}</p>
              )}
              {!errors.bidAmount && isBelowSuggested && (
                <p className="mt-1 text-xs text-[var(--warning)]">
                  Your bid is below the seller's suggested price of{' '}
                  {formatAda(encryption.suggestedPrice!)} ADA
                </p>
              )}
              <div className="mt-1 space-y-1">
                <p id="bidAmount-hint" className="text-xs text-[var(--text-muted)]">
                  Your bid will be locked until the seller accepts or you cancel.{' '}
                  Why {MIN_BID_ADA} ADA minimum?
                  <InfoTooltip text="The Cardano network requires each piece of on-chain data (UTxO) to hold a minimum amount of ADA. Your bid is stored on-chain, so it must meet this minimum." />
                </p>
                {balanceAda !== undefined ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">
                      Balance: {balanceAda.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const maxBid = Math.max(
                          Math.floor(balanceAda - FEE_RESERVE_ADA),
                          MIN_BID_ADA
                        );
                        setFormData((prev) => ({ ...prev, bidAmount: maxBid.toString() }));
                        if (errors.bidAmount) {
                          setErrors((prev) => ({ ...prev, bidAmount: undefined }));
                        }
                        setSubmitError(null);
                      }}
                      disabled={isSubmitting || balanceAda <= FEE_RESERVE_ADA}
                      className="px-1.5 py-0.5 text-xs rounded-[var(--radius-sm)] btn-base btn-tertiary"
                    >
                      Max
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">
                    Balance: loading...
                  </span>
                )}
              </div>
            </div>

            {/* Future Listing Price (collapsible) */}
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFuturePrice(!showFuturePrice)}
                disabled={isSubmitting}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm btn-base btn-tertiary border-0"
              >
                <span>Set Future Listing Price</span>
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
                      Future Listing Price (ADA){' '}
                      <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                      <InfoTooltip text="The price you intend to re-list this data for after you win the bid. Recorded on-chain as metadata for future buyers." />
                    </label>
                    {suggestedPriceAda !== undefined && suggestedPriceAda > 0 && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({ ...prev, futurePrice: suggestedPriceAda!.toString() }))
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                        >
                          Same Price
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              futurePrice: (Math.floor(encryption.suggestedPrice! * 1.1) / 1_000_000).toString(),
                            }))
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                        >
                          +10%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              futurePrice: (Math.floor(encryption.suggestedPrice! * 1.25) / 1_000_000).toString(),
                            }))
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs rounded-[var(--radius-md)] btn-base btn-tertiary"
                        >
                          +25%
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      id="futurePrice"
                      name="futurePrice"
                      value={formData.futurePrice}
                      onChange={handleInputChange}
                      disabled={isSubmitting}
                      placeholder="0.00"
                      min={0}
                      step="0.1"
                      aria-invalid={!!errors.futurePrice}
                      aria-describedby={errors.futurePrice ? 'futurePrice-error' : undefined}
                      className={`w-full px-3 py-2.5 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 pr-12 ${
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
                    The suggested price for the next listing after you win. Defaults to the current price.
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
                  aria-label="Copy error to clipboard"
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
          <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            {/* Info box about what happens next */}
            <div className="mb-4 p-3 bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-[var(--radius-md)]">
              <p className="text-xs text-[var(--accent)]">
                <strong>Note:</strong> Placing a bid will generate a unique encryption key and lock
                your ADA in the contract. You can cancel the bid anytime before the seller accepts.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-2 btn-base btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Placing Bid...
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
                    Place Bid
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
