import { useState, useEffect, useRef } from 'react';
import type { EncryptionDisplay } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getFriendlyError, type FriendlyError } from '../services/errorMessages';
import { formatAda } from '../utils/formatAda';

interface UpdatePriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (encryption: EncryptionDisplay, newPriceLovelace: number) => Promise<void>;
  encryption: EncryptionDisplay | null;
}

export default function UpdatePriceModal({
  isOpen,
  onClose,
  onSubmit,
  encryption,
}: UpdatePriceModalProps) {
  const [priceAda, setPriceAda] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FriendlyError | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSubmitError(null);
      // Pre-fill with current price
      const currentAda = encryption?.suggestedPrice != null
        ? (encryption.suggestedPrice / 1_000_000).toString()
        : '';
      setPriceAda(currentAda);
      setTimeout(() => priceInputRef.current?.focus(), 50);
    }
  }, [isOpen, encryption]);

  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('update-price', isOpen, onClose, isSubmitting);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen);

  const currentPriceAda = encryption?.suggestedPrice != null
    ? encryption.suggestedPrice / 1_000_000
    : undefined;

  const validateForm = (): boolean => {
    const trimmed = priceAda.trim();
    if (!trimmed) {
      setError('Price is required');
      return false;
    }
    const parsed = parseFloat(trimmed.replace(/,/g, ''));
    if (isNaN(parsed)) {
      setError('Price must be a valid number');
      return false;
    }
    if (parsed < 0) {
      setError('Price cannot be negative');
      return false;
    }
    if (parsed > 45_000_000_000) {
      setError('Price exceeds maximum (45B ADA)');
      return false;
    }
    const newLovelace = Math.floor(parsed * 1_000_000);
    if (encryption?.suggestedPrice !== undefined && newLovelace === encryption.suggestedPrice) {
      setError('New price is the same as the current price');
      return false;
    }
    setError(null);
    return true;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/,/g, '');
    // Cap at 6 decimal places (1 lovelace = 0.000001 ADA)
    const dotIndex = value.indexOf('.');
    if (dotIndex !== -1 && value.length - dotIndex - 1 > 6) return;
    // Clamp to Cardano max supply (45 billion ADA)
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed > 45_000_000_000) value = '45000000000';
    setPriceAda(value);
    if (error) setError(null);
    if (submitError) setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!encryption) {
      setSubmitError(getFriendlyError('No encryption selected'));
      return;
    }

    if (!validateForm()) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const newPriceLovelace = Math.floor(parseFloat(priceAda.replace(/,/g, '')) * 1_000_000);
      await onSubmit(encryption, newPriceLovelace);
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
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Update Price</h2>
          </div>

          {/* Body */}
          <div className="p-[var(--space-lg)] space-y-[var(--space-md)]">
            {/* Current price display */}
            {currentPriceAda !== undefined && (
              <div className="flex items-center justify-between p-[var(--space-3)] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                <span className="text-sm text-[var(--text-muted)]">Current price</span>
                <span className="text-sm font-medium text-[var(--text-secondary)]">
                  {formatAda(encryption!.suggestedPrice!)} ADA
                </span>
              </div>
            )}

            {/* New price input */}
            <div>
              <label htmlFor="update-price-input" className="block text-sm font-medium text-[var(--text-secondary)] mb-[var(--space-1)]">
                New Price (ADA)
              </label>
              <input
                ref={priceInputRef}
                id="update-price-input"
                type="text"
                inputMode="decimal"
                value={priceAda}
                onChange={handleInputChange}
                onBlur={() => { if (priceAda.trim()) validateForm(); }}
                disabled={isSubmitting}
                placeholder="0"
                className={`w-full px-[var(--space-3)] py-[var(--space-2)] text-sm rounded-[var(--radius-md)] border bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 ${
                  error
                    ? 'border-[var(--error)] focus:border-[var(--error)]'
                    : 'border-[var(--border-default)] focus:border-[var(--accent)]'
                }`}
              />
              {error && (
                <p className="mt-[var(--space-1)] text-xs text-[var(--error)]">{error}</p>
              )}
              {/* Lovelace preview */}
              {priceAda.trim() && !isNaN(parseFloat(priceAda)) && parseFloat(priceAda) >= 0 && (
                <p className="mt-[var(--space-1)] text-xs text-[var(--text-muted)]">
                  = {Math.floor(parseFloat(priceAda.replace(/,/g, '')) * 1_000_000).toLocaleString()} lovelace
                </p>
              )}
            </div>

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
              {isSubmitting ? 'Updating...' : 'Update Price'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
