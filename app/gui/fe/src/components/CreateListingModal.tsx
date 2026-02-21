import { useState, useEffect, useRef } from 'react';
import LoadingSpinner from './LoadingSpinner';
import { FILE_CATEGORIES, isCategoryEnabled, type FileCategory } from '../config/categories';

export interface CreateListingFormData {
  category: FileCategory;
  secretMessage: string;
  file: File | null;
  description: string;
  suggestedPrice: string;
  imageLink: string;
}

interface FormErrors {
  secretMessage?: string;
  file?: string;
  description?: string;
  suggestedPrice?: string;
  imageLink?: string;
}

interface CreateListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateListingFormData) => Promise<void>;
  isIagonConnected?: boolean;
}

const INITIAL_FORM_DATA: CreateListingFormData = {
  category: 'text',
  secretMessage: '',
  file: null,
  description: '',
  suggestedPrice: '',
  imageLink: '',
};

const CATEGORY_ICONS: Record<FileCategory, JSX.Element> = {
  text: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
    </svg>
  ),
  document: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  audio: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
    </svg>
  ),
  image: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  video: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  other: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  ),
};

export default function CreateListingModal({
  isOpen,
  onClose,
  onSubmit,
  isIagonConnected = false,
}: CreateListingModalProps) {
  const [formData, setFormData] = useState<CreateListingFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const selectedCategoryConfig = FILE_CATEGORIES.find((c) => c.id === formData.category);
  const isSelectedCategoryEnabled = isCategoryEnabled(formData.category);
  // Non-text categories require Iagon connection for file upload
  const isCategoryUsable = formData.category === 'text'
    ? isSelectedCategoryEnabled
    : isSelectedCategoryEnabled && isIagonConnected;
  const canSubmit = isCategoryUsable && !isSubmitting;

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Secret message validation (text category only)
    if (formData.category === 'text') {
      if (!formData.secretMessage.trim()) {
        newErrors.secretMessage = 'Secret message is required';
      } else if (formData.secretMessage.length > 280) {
        newErrors.secretMessage = 'Message must be 280 characters or less';
      }
    }

    // File validation (non-text enabled categories)
    if (formData.category !== 'text' && isSelectedCategoryEnabled) {
      if (!formData.file) {
        newErrors.file = 'File is required';
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
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setSubmitError(null);
  };

  const handleCategoryChange = (category: FileCategory) => {
    if (isSubmitting) return;
    setFormData((prev) => ({
      ...prev,
      category,
      // Clear content fields when switching categories
      secretMessage: '',
      file: null,
    }));
    setErrors({});
    setSubmitError(null);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormData((prev) => ({ ...prev, file }));
    if (errors.file) {
      setErrors((prev) => ({ ...prev, file: undefined }));
    }
    setSubmitError(null);
  };

  const handleRemoveFile = () => {
    setFormData((prev) => ({ ...prev, file: null }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canSubmit || !validateForm()) {
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
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden flex flex-col mx-4">
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
            {/* Category Selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                Data Type <span className="text-[var(--error)]">*</span>
              </label>
              <div className="grid grid-cols-6 gap-2">
                {FILE_CATEGORIES.map((cat) => {
                  const isSelected = formData.category === cat.id;
                  const isUsable = cat.id === 'text' ? cat.enabled : cat.enabled && isIagonConnected;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handleCategoryChange(cat.id)}
                      disabled={isSubmitting}
                      className={`relative flex flex-row items-center justify-center gap-1.5 px-2 py-2 rounded-[var(--radius-md)] border text-xs transition-all duration-150 cursor-pointer disabled:cursor-not-allowed ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                          : isUsable
                            ? 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                      }`}
                    >
                      {!isUsable && (
                        <div className="absolute top-0.5 right-0.5">
                          <svg className="w-2.5 h-2.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                        </div>
                      )}
                      {CATEGORY_ICONS[cat.id]}
                      <span className="font-medium">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
              {selectedCategoryConfig && (
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  {selectedCategoryConfig.description}
                </p>
              )}
            </div>

            {/* Content Area — Text category */}
            {formData.category === 'text' && (
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
                  {formData.secretMessage.length}/280 characters
                </p>
              </div>
            )}

            {/* Content Area — Non-text category (enabled + Iagon connected) */}
            {formData.category !== 'text' && isCategoryUsable && (
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Upload File <span className="text-[var(--error)]">*</span>
                </label>
                {formData.file ? (
                  <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
                    <div className="flex-shrink-0 text-[var(--accent)]">
                      {CATEGORY_ICONS[formData.category]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">{formData.file.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{formatFileSize(formData.file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      disabled={isSubmitting}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--error)] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <label
                    className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-[var(--radius-md)] cursor-pointer transition-all duration-150 ${
                      errors.file
                        ? 'border-[var(--error)] bg-[var(--error)]/5'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'
                    }`}
                  >
                    <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-[var(--text-secondary)]">Click to select a file</span>
                    {selectedCategoryConfig && selectedCategoryConfig.acceptedExtensions.length > 0 && (
                      <span className="text-xs text-[var(--text-muted)]">
                        {selectedCategoryConfig.acceptedExtensions.join(', ')}
                      </span>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileChange}
                      disabled={isSubmitting}
                      accept={selectedCategoryConfig?.acceptedExtensions.join(',') || undefined}
                      className="hidden"
                    />
                  </label>
                )}
                {errors.file && (
                  <p className="mt-1 text-xs text-[var(--error)]">{errors.file}</p>
                )}
              </div>
            )}

            {/* Content Area — Non-text category (Iagon not connected) */}
            {formData.category !== 'text' && !isCategoryUsable && (
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Upload File
                </label>
                <div className="relative">
                  <div className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-secondary)] opacity-40">
                    <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-[var(--text-muted)]">Click to select a file</span>
                    {selectedCategoryConfig && selectedCategoryConfig.acceptedExtensions.length > 0 && (
                      <span className="text-xs text-[var(--text-muted)]">
                        {selectedCategoryConfig.acceptedExtensions.join(', ')}
                      </span>
                    )}
                  </div>
                  {/* Iagon not connected overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-sm">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-[var(--warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        <span className="text-sm font-medium text-[var(--text-primary)]">Iagon Required</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        Connect your Iagon account in Settings &gt; Data Layer
                      </p>
                    </div>
                  </div>
                </div>
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

            {/* Price + Image Link — two-column row */}
            <div className="grid grid-cols-2 gap-4">
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
                  Optional. Buyers can bid any amount.
                </p>
              </div>

              {/* Image Link */}
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
                  Optional. Public preview image URL.
                </p>
              </div>
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
                <strong>Note:</strong> Creating a listing will encrypt your data as a standardized CBOR payload.
                {formData.category === 'text'
                  ? ' Text data is stored on-chain.'
                  : ' Files are encrypted and uploaded to Iagon, with a reference stored on-chain.'}
                {' '}You'll need to sign a transaction with your wallet.
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
                disabled={!canSubmit}
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
