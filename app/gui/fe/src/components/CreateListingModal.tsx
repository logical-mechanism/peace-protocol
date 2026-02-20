import { useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface CreateListingFormData {
  secretMessage: string;
  description: string;
  suggestedPrice: string;
  storageLayer: 'on-chain' | 'ipfs' | 'arweave';
  ipfsHash: string;
  arweaveId: string;
  contentKey: string;
  contentHash: string;
  imageLink: string;
}

interface FormErrors {
  secretMessage?: string;
  description?: string;
  suggestedPrice?: string;
  ipfsHash?: string;
  arweaveId?: string;
  contentKey?: string;
  contentHash?: string;
  imageLink?: string;
}

interface CreateListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateListingFormData) => Promise<void>;
}

const INITIAL_FORM_DATA: CreateListingFormData = {
  secretMessage: '',
  description: '',
  suggestedPrice: '',
  storageLayer: 'on-chain',
  ipfsHash: '',
  arweaveId: '',
  contentKey: '',
  contentHash: '',
  imageLink: '',
};

export default function CreateListingModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateListingModalProps) {
  const [formData, setFormData] = useState<CreateListingFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset form when modal opens (only on isOpen transition)
  useEffect(() => {
    if (isOpen) {
      setFormData(INITIAL_FORM_DATA);
      setErrors({});
      setSubmitError(null);
    }
  }, [isOpen]);

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

    // Secret message validation (only for on-chain storage)
    if (formData.storageLayer === 'on-chain') {
      if (!formData.secretMessage.trim()) {
        newErrors.secretMessage = 'Secret message is required';
      } else if (formData.secretMessage.length > 10000) {
        newErrors.secretMessage = 'Message must be less than 10,000 characters';
      }
    }

    // Description validation
    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    } else if (formData.description.length > 500) {
      newErrors.description = 'Description must be less than 500 characters';
    }

    // Suggested price validation
    if (formData.suggestedPrice) {
      const price = parseFloat(formData.suggestedPrice);
      if (isNaN(price) || price < 0) {
        newErrors.suggestedPrice = 'Price must be a positive number';
      } else if (price > 1000000000) {
        newErrors.suggestedPrice = 'Price is too high';
      }
    }

    // Storage layer specific validation
    if (formData.storageLayer === 'ipfs') {
      if (!formData.ipfsHash.trim()) {
        newErrors.ipfsHash = 'IPFS hash is required when using IPFS storage';
      } else if (!formData.ipfsHash.startsWith('Qm') && !formData.ipfsHash.startsWith('bafy')) {
        newErrors.ipfsHash = 'Invalid IPFS hash format (should start with Qm or bafy)';
      }
    }

    if (formData.storageLayer === 'arweave') {
      if (!formData.arweaveId.trim()) {
        newErrors.arweaveId = 'Arweave ID is required when using Arweave storage';
      } else if (formData.arweaveId.length !== 43) {
        newErrors.arweaveId = 'Arweave ID should be 43 characters';
      }
    }

    // Optional hex field validation (content key and content hash)
    if (formData.contentKey.trim()) {
      if (!/^[0-9a-fA-F]*$/.test(formData.contentKey) || formData.contentKey.length % 2 !== 0) {
        newErrors.contentKey = 'Must be valid hex (even number of 0-9, a-f characters)';
      }
    }
    if (formData.contentHash.trim()) {
      if (!/^[0-9a-fA-F]*$/.test(formData.contentHash) || formData.contentHash.length % 2 !== 0) {
        newErrors.contentHash = 'Must be valid hex (even number of 0-9, a-f characters)';
      }
    }

    // Image link validation (optional)
    if (formData.imageLink.trim()) {
      try {
        const url = new URL(formData.imageLink.trim());
        if (!['http:', 'https:'].includes(url.protocol)) {
          newErrors.imageLink = 'Image link must use http:// or https://';
        }
      } catch {
        newErrors.imageLink = 'Invalid URL format';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
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

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      console.error('Failed to create listing:', error);
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to create listing. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-listing-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="create-listing-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Create New Listing
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Encrypt and list your data for sale
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
            {/* Secret Message (on-chain only) */}
            {formData.storageLayer === 'on-chain' && (
              <div>
                <label
                  htmlFor="secretMessage"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Secret Message <span className="text-[var(--error)]">*</span>
                </label>
                <textarea
                  id="secretMessage"
                  name="secretMessage"
                  value={formData.secretMessage}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  rows={4}
                  placeholder="Enter the secret data you want to sell..."
                  className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 resize-none disabled:opacity-50 ${
                    errors.secretMessage ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                {errors.secretMessage && (
                  <p className="mt-1 text-xs text-[var(--error)]">{errors.secretMessage}</p>
                )}
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {formData.secretMessage.length}/10,000 characters
                </p>
              </div>
            )}

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-[var(--text-primary)] mb-2"
              >
                Description <span className="text-[var(--error)]">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                disabled={isSubmitting}
                rows={2}
                placeholder="Brief description of what you're selling (visible to buyers)"
                className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 resize-none disabled:opacity-50 ${
                  errors.description ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                }`}
              />
              {errors.description && (
                <p className="mt-1 text-xs text-[var(--error)]">{errors.description}</p>
              )}
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {formData.description.length}/500 characters (stored in CIP-20 metadata)
              </p>
            </div>

            {/* Suggested Price */}
            <div>
              <label
                htmlFor="suggestedPrice"
                className="block text-sm font-medium text-[var(--text-primary)] mb-2"
              >
                Suggested Price (ADA)
              </label>
              <div className="relative">
                <input
                  type="text"
                  id="suggestedPrice"
                  name="suggestedPrice"
                  value={formData.suggestedPrice}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 pr-12 ${
                    errors.suggestedPrice ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                  ADA
                </span>
              </div>
              {errors.suggestedPrice && (
                <p className="mt-1 text-xs text-[var(--error)]">{errors.suggestedPrice}</p>
              )}
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Optional. Buyers can bid any amount regardless of this price.
              </p>
            </div>

            {/* Storage Layer */}
            <div>
              <label
                htmlFor="storageLayer"
                className="block text-sm font-medium text-[var(--text-primary)] mb-2"
              >
                Data Storage Layer
              </label>
              <select
                id="storageLayer"
                name="storageLayer"
                value={formData.storageLayer}
                onChange={handleInputChange}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 cursor-pointer"
              >
                <option value="on-chain">On-chain (included in datum)</option>
                <option value="ipfs">IPFS (decentralized storage)</option>
                <option value="arweave">Arweave (permanent storage)</option>
              </select>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                On-chain storage includes data directly in the transaction.
              </p>
            </div>

            {/* IPFS Hash (conditional) */}
            {formData.storageLayer === 'ipfs' && (
              <div>
                <label
                  htmlFor="ipfsHash"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  IPFS Hash <span className="text-[var(--error)]">*</span>
                </label>
                <input
                  type="text"
                  id="ipfsHash"
                  name="ipfsHash"
                  value={formData.ipfsHash}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  placeholder="QmYwAPJzv5CZsnA625..."
                  className={`w-full px-3 py-2 text-sm font-mono bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 ${
                    errors.ipfsHash ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                {errors.ipfsHash && (
                  <p className="mt-1 text-xs text-[var(--error)]">{errors.ipfsHash}</p>
                )}
              </div>
            )}

            {/* Arweave ID (conditional) */}
            {formData.storageLayer === 'arweave' && (
              <div>
                <label
                  htmlFor="arweaveId"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Arweave Transaction ID <span className="text-[var(--error)]">*</span>
                </label>
                <input
                  type="text"
                  id="arweaveId"
                  name="arweaveId"
                  value={formData.arweaveId}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  placeholder="43 character base64 ID..."
                  className={`w-full px-3 py-2 text-sm font-mono bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 ${
                    errors.arweaveId ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                {errors.arweaveId && (
                  <p className="mt-1 text-xs text-[var(--error)]">{errors.arweaveId}</p>
                )}
              </div>
            )}

            {/* Content Key (optional, for off-chain storage) */}
            {formData.storageLayer !== 'on-chain' && (
              <div>
                <label
                  htmlFor="contentKey"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Content Key
                </label>
                <input
                  type="text"
                  id="contentKey"
                  name="contentKey"
                  value={formData.contentKey}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  placeholder="Hex-encoded decryption key for off-chain content..."
                  className={`w-full px-3 py-2 text-sm font-mono bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 ${
                    errors.contentKey ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                {errors.contentKey && (
                  <p className="mt-1 text-xs text-[var(--error)]">{errors.contentKey}</p>
                )}
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Optional. Access/decryption key for the off-chain content (hex).
                </p>
              </div>
            )}

            {/* Content Hash (optional, for off-chain storage) */}
            {formData.storageLayer !== 'on-chain' && (
              <div>
                <label
                  htmlFor="contentHash"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Content Hash
                </label>
                <input
                  type="text"
                  id="contentHash"
                  name="contentHash"
                  value={formData.contentHash}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  placeholder="Hex-encoded integrity hash of the content..."
                  className={`w-full px-3 py-2 text-sm font-mono bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 ${
                    errors.contentHash ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                {errors.contentHash && (
                  <p className="mt-1 text-xs text-[var(--error)]">{errors.contentHash}</p>
                )}
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Optional. Integrity hash for verifying the off-chain content (hex).
                </p>
              </div>
            )}

            {/* Image Link (optional, always shown) */}
            <div>
              <label
                htmlFor="imageLink"
                className="block text-sm font-medium text-[var(--text-primary)] mb-2"
              >
                Image Link
              </label>
              <input
                type="text"
                id="imageLink"
                name="imageLink"
                value={formData.imageLink}
                onChange={handleInputChange}
                disabled={isSubmitting}
                placeholder="https://example.com/preview.png"
                className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 ${
                  errors.imageLink ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                }`}
              />
              {errors.imageLink && (
                <p className="mt-1 text-xs text-[var(--error)]">{errors.imageLink}</p>
              )}
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Optional. Public preview image URL for your listing.
              </p>
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
                <strong>Note:</strong> Creating a listing will encrypt your data as a standardized CBOR payload and store it on-chain.
                You'll need to sign a transaction with your wallet.
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
                    Creating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                    Create Listing
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
export type { CreateListingFormData };
