import { useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';
import type { EncryptionDisplay } from '../services/api';

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
}

const INITIAL_FORM_DATA: PlaceBidFormData = {
  bidAmount: '',
  futurePrice: '',
};

// Minimum bid in ADA (to cover UTxO minimum)
const MIN_BID_ADA = 2;

export default function PlaceBidModal({
  isOpen,
  onClose,
  onSubmit,
  encryption,
}: PlaceBidModalProps) {
  const [formData, setFormData] = useState<PlaceBidFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showFuturePrice, setShowFuturePrice] = useState(false);

  // Reset form when modal opens (only on isOpen transition)
  useEffect(() => {
    if (isOpen) {
      setFormData({
        bidAmount: encryption?.suggestedPrice?.toString() || '',
        futurePrice: encryption?.suggestedPrice?.toString() || '',
      });
      setErrors({});
      setSubmitError(null);
      setShowFuturePrice(false);
    }
  }, [isOpen, encryption?.suggestedPrice]);

  // Handle escape key to close (separate effect to avoid resetting form)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, isSubmitting, onClose]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Bid amount validation
    if (!formData.bidAmount.trim()) {
      newErrors.bidAmount = 'Bid amount is required';
    } else {
      const amount = parseFloat(formData.bidAmount);
      if (isNaN(amount) || amount <= 0) {
        newErrors.bidAmount = 'Bid amount must be a positive number';
      } else if (amount < MIN_BID_ADA) {
        newErrors.bidAmount = `Minimum bid is ${MIN_BID_ADA} ADA (to cover UTxO minimum)`;
      } else if (amount > 1000000000) {
        newErrors.bidAmount = 'Bid amount is too high';
      }
    }

    // Future price validation (only if section is open and value provided)
    if (showFuturePrice && formData.futurePrice.trim()) {
      const price = parseFloat(formData.futurePrice);
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
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!encryption) {
      setSubmitError('No encryption selected');
      return;
    }

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const bidAmountAda = parseFloat(formData.bidAmount);
      const futurePrice = showFuturePrice && formData.futurePrice.trim()
        ? parseFloat(formData.futurePrice)
        : encryption?.suggestedPrice ?? bidAmountAda;
      await onSubmit(encryption.tokenName, bidAmountAda, encryption.utxo, futurePrice);
      onClose();
    } catch (error) {
      console.error('Failed to place bid:', error);
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to place bid. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const truncateToken = (token: string) => {
    if (!token) return '';
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  };

  const truncateAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  };

  if (!isOpen || !encryption) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="place-bid-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="place-bid-title" className="text-lg font-semibold text-[var(--text-primary)]">Place Bid</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Bid on encrypted data listing
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-[var(--radius-md)] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Listing Info */}
            <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)]">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
                Listing Details
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Token</span>
                  <span className="text-xs font-mono text-[var(--text-secondary)]">
                    {truncateToken(encryption.tokenName)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Seller</span>
                  <span className="text-xs font-mono text-[var(--text-secondary)]">
                    {truncateAddress(encryption.seller)}
                  </span>
                </div>
                {encryption.suggestedPrice !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Suggested Price</span>
                    <span className="text-xs font-medium text-[var(--accent)]">
                      {encryption.suggestedPrice.toLocaleString()} ADA
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

            {/* Bid Amount */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="bidAmount"
                  className="text-sm font-medium text-[var(--text-primary)]"
                >
                  Your Bid Amount (ADA) <span className="text-[var(--error)]">*</span>
                </label>
                {encryption.suggestedPrice !== undefined && encryption.suggestedPrice > 0 && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, bidAmount: encryption.suggestedPrice!.toString() }))
                      }
                      disabled={isSubmitting}
                      className="px-2 py-1 text-xs border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer disabled:opacity-50"
                    >
                      Suggested ({encryption.suggestedPrice} ADA)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          bidAmount: Math.floor(encryption.suggestedPrice! * 1.1).toString(),
                        }))
                      }
                      disabled={isSubmitting}
                      className="px-2 py-1 text-xs border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer disabled:opacity-50"
                    >
                      +10%
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          bidAmount: Math.floor(encryption.suggestedPrice! * 1.25).toString(),
                        }))
                      }
                      disabled={isSubmitting}
                      className="px-2 py-1 text-xs border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer disabled:opacity-50"
                    >
                      +25%
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  id="bidAmount"
                  name="bidAmount"
                  value={formData.bidAmount}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  placeholder="0.00"
                  className={`w-full px-3 py-2.5 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 pr-12 ${
                    errors.bidAmount ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                  ADA
                </span>
              </div>
              {errors.bidAmount && (
                <p className="mt-1 text-xs text-[var(--error)]">{errors.bidAmount}</p>
              )}
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Minimum bid: {MIN_BID_ADA} ADA. Your bid will be locked until the seller accepts or
                you cancel.
              </p>
            </div>

            {/* Future Listing Price (collapsible) */}
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFuturePrice(!showFuturePrice)}
                disabled={isSubmitting}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all duration-150 cursor-pointer disabled:opacity-50"
              >
                <span>Set Future Listing Price</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-150 ${showFuturePrice ? 'rotate-180' : ''}`}
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
                      className="text-sm font-medium text-[var(--text-primary)]"
                    >
                      Future Listing Price (ADA)
                    </label>
                    {encryption.suggestedPrice !== undefined && encryption.suggestedPrice > 0 && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({ ...prev, futurePrice: encryption.suggestedPrice!.toString() }))
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer disabled:opacity-50"
                        >
                          Same Price
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              futurePrice: Math.floor(encryption.suggestedPrice! * 1.1).toString(),
                            }))
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer disabled:opacity-50"
                        >
                          +10%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              futurePrice: Math.floor(encryption.suggestedPrice! * 1.25).toString(),
                            }))
                          }
                          disabled={isSubmitting}
                          className="px-2 py-1 text-xs border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer disabled:opacity-50"
                        >
                          +25%
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      id="futurePrice"
                      name="futurePrice"
                      value={formData.futurePrice}
                      onChange={handleInputChange}
                      disabled={isSubmitting}
                      placeholder="0.00"
                      className={`w-full px-3 py-2.5 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 pr-12 ${
                        errors.futurePrice ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                      }`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                      ADA
                    </span>
                  </div>
                  {errors.futurePrice && (
                    <p className="mt-1 text-xs text-[var(--error)]">{errors.futurePrice}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    The suggested price for the next listing after you win. Defaults to the current price.
                  </p>
                </div>
              )}
            </div>

            {/* Submit Error */}
            {submitError && (
              <div className="p-3 bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-[var(--radius-md)]">
                <p className="text-sm text-[var(--error)]">{submitError}</p>
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
                className="flex-1 px-4 py-2.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-md)] hover:bg-[var(--accent)]/90 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
