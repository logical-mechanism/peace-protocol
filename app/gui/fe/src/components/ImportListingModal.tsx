import { useState, useEffect, useRef } from 'react';
import LoadingSpinner from './LoadingSpinner';
import InfoTooltip from './InfoTooltip';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { copyToClipboard } from '../utils/clipboard';
import { detectCategoryFromExtension, type FileCategory } from '../config/categories';
import type { ListingCreationStep } from '../services/transactionBuilder';
import type { ImportListingData } from '../services/transactionBuilder';

interface ImportFormData {
  iagonFileId: string;
  aesKeyHex: string;
  gcmNonceHex: string;
  sha256DigestHex: string;
  fileExtension: string;
  description: string;
  suggestedPrice: string;
  imageLink: string;
  category: FileCategory;
}

interface FormErrors {
  iagonFileId?: string;
  aesKeyHex?: string;
  gcmNonceHex?: string;
  sha256DigestHex?: string;
  fileExtension?: string;
  description?: string;
  suggestedPrice?: string;
  imageLink?: string;
}

interface ImportListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ImportListingData, onProgress?: (step: ListingCreationStep) => void) => Promise<void>;
}

const INITIAL_FORM_DATA: ImportFormData = {
  iagonFileId: '',
  aesKeyHex: '',
  gcmNonceHex: '',
  sha256DigestHex: '',
  fileExtension: '',
  description: '',
  suggestedPrice: '',
  imageLink: '',
  category: 'other',
};

const HEX_REGEX = /^[0-9a-fA-F]+$/;

/** Steps for import listing creation (no file upload). */
const IMPORT_LISTING_STEPS: { key: ListingCreationStep; label: string }[] = [
  { key: 'building', label: 'Building transaction' },
  { key: 'signing', label: 'Signing transaction' },
  { key: 'submitting', label: 'Submitting to chain' },
];

const STEP_ORDER: Record<ListingCreationStep, number> = {
  encrypting: 0,
  uploading: 1,
  verifying: 2,
  building: 3,
  signing: 4,
  submitting: 5,
};

function formatPrice(raw: string): string {
  if (!raw || raw.endsWith('.')) return raw;
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(num);
}

export default function ImportListingModal({
  isOpen,
  onClose,
  onSubmit,
}: ImportListingModalProps) {
  const [formData, setFormData] = useState<ImportFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedError, setCopiedError] = useState(false);
  const [creationStep, setCreationStep] = useState<ListingCreationStep | null>(null);
  const [displayPrice, setDisplayPrice] = useState('');
  const fileIdRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData(INITIAL_FORM_DATA);
      setDisplayPrice('');
      setErrors({});
      setSubmitError(null);
      setCreationStep(null);
      setTimeout(() => fileIdRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('import-listing', isOpen, onClose, isSubmitting);
  const focusTrapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(focusTrapRef, isOpen);

  const validateField = (fieldName: keyof FormErrors): string | undefined => {
    switch (fieldName) {
      case 'iagonFileId':
        if (!formData.iagonFileId.trim()) return 'File ID is required';
        return undefined;
      case 'aesKeyHex':
        if (!formData.aesKeyHex.trim()) return 'AES key is required';
        if (formData.aesKeyHex.length !== 64) return 'AES key must be 64 hex characters (32 bytes)';
        if (!HEX_REGEX.test(formData.aesKeyHex)) return 'Must be valid hexadecimal';
        return undefined;
      case 'gcmNonceHex':
        if (!formData.gcmNonceHex.trim()) return 'GCM nonce is required';
        if (formData.gcmNonceHex.length !== 24) return 'GCM nonce must be 24 hex characters (12 bytes)';
        if (!HEX_REGEX.test(formData.gcmNonceHex)) return 'Must be valid hexadecimal';
        return undefined;
      case 'sha256DigestHex':
        if (!formData.sha256DigestHex.trim()) return 'SHA-256 digest is required';
        if (formData.sha256DigestHex.length !== 64) return 'SHA-256 digest must be 64 hex characters (32 bytes)';
        if (!HEX_REGEX.test(formData.sha256DigestHex)) return 'Must be valid hexadecimal';
        return undefined;
      case 'fileExtension':
        if (formData.fileExtension && !formData.fileExtension.startsWith('.')) return 'Must start with "." (e.g. ".pdf")';
        return undefined;
      case 'description':
        if (!formData.description.trim()) return 'Description is required';
        if (formData.description.length > 500) return 'Description must be less than 500 characters';
        return undefined;
      case 'suggestedPrice':
        if (formData.suggestedPrice) {
          const price = parseFloat(formData.suggestedPrice);
          if (isNaN(price) || price < 0) return 'Price must be a positive number';
          if (price > 45_000_000_000) return 'Price exceeds maximum (45B ADA)';
        }
        return undefined;
      case 'imageLink':
        if (formData.imageLink.trim()) {
          try {
            const url = new URL(formData.imageLink.trim());
            if (!['http:', 'https:'].includes(url.protocol)) return 'Must use http:// or https://';
          } catch {
            return 'Invalid URL format';
          }
        }
        return undefined;
      default:
        return undefined;
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    const fields: (keyof FormErrors)[] = [
      'iagonFileId', 'aesKeyHex', 'gcmNonceHex', 'sha256DigestHex',
      'fileExtension', 'description', 'suggestedPrice', 'imageLink',
    ];
    for (const field of fields) {
      const error = validateField(field);
      if (error) newErrors[field] = error;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFieldBlur = (fieldName: keyof FormErrors) => {
    const error = validateField(fieldName);
    setErrors((prev) => ({ ...prev, [fieldName]: error }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setSubmitError(null);
  };

  const handleExtensionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ext = e.target.value;
    setFormData((prev) => {
      const category = ext ? detectCategoryFromExtension(`file${ext}`) : 'other';
      return { ...prev, fileExtension: ext, category };
    });
    if (errors.fileExtension) {
      setErrors((prev) => ({ ...prev, fileExtension: undefined }));
    }
    setSubmitError(null);
  };

  const handlePasteAll = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      const updates: Partial<ImportFormData> = {};

      if (parsed.fileId || parsed.iagonFileId) updates.iagonFileId = parsed.fileId || parsed.iagonFileId;
      if (parsed.key || parsed.aesKeyHex) updates.aesKeyHex = parsed.key || parsed.aesKeyHex;
      if (parsed.nonce || parsed.gcmNonceHex) updates.gcmNonceHex = parsed.nonce || parsed.gcmNonceHex;
      if (parsed.digest || parsed.sha256DigestHex) updates.sha256DigestHex = parsed.digest || parsed.sha256DigestHex;
      if (parsed.ext || parsed.fileExtension) {
        const ext = parsed.ext || parsed.fileExtension;
        updates.fileExtension = ext;
        updates.category = ext ? detectCategoryFromExtension(`file${ext}`) : 'other';
      }

      if (Object.keys(updates).length > 0) {
        setFormData((prev) => ({ ...prev, ...updates }));
        setErrors({});
        setSubmitError(null);
      }
    } catch {
      // Clipboard may not contain valid JSON — silently ignore
    }
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/,/g, '');
    // Cap at 6 decimal places (1 lovelace = 0.000001 ADA)
    const dotIndex = raw.indexOf('.');
    if (dotIndex !== -1 && raw.length - dotIndex - 1 > 6) return;
    // Clamp to Cardano max supply (45 billion ADA)
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed > 45_000_000_000) raw = '45000000000';
    setFormData((prev) => ({ ...prev, suggestedPrice: raw }));
    setDisplayPrice(raw);
    if (errors.suggestedPrice) {
      setErrors((prev) => ({ ...prev, suggestedPrice: undefined }));
    }
    setSubmitError(null);
  };

  const handlePriceFocus = () => {
    setDisplayPrice(formData.suggestedPrice);
  };

  const handlePriceBlur = () => {
    setDisplayPrice(formatPrice(formData.suggestedPrice));
    handleFieldBlur('suggestedPrice');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !validateForm()) return;

    setIsSubmitting(true);
    setSubmitError(null);
    setCreationStep(null);

    try {
      await onSubmit({
        iagonFileId: formData.iagonFileId.trim(),
        aesKeyHex: formData.aesKeyHex.trim(),
        gcmNonceHex: formData.gcmNonceHex.trim(),
        sha256DigestHex: formData.sha256DigestHex.trim(),
        fileExtension: formData.fileExtension.trim(),
        description: formData.description,
        suggestedPrice: formData.suggestedPrice,
        imageLink: formData.imageLink,
        category: formData.category,
      }, setCreationStep);
      onClose();
    } catch (error) {
      console.error('Failed to create listing from import:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to create listing. Please try again.');
    } finally {
      setIsSubmitting(false);
      setCreationStep(null);
    }
  };

  if (!shouldRender) return null;

  const inputClass = (field: keyof FormErrors) =>
    `w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 ${
      errors[field] ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
    }`;

  const monoInputClass = (field: keyof FormErrors) =>
    `${inputClass(field)} font-mono text-xs`;

  return (
    <div
      ref={focusTrapRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-listing-title"
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
            <h2 id="import-listing-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Import from Iagon
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Create a listing from a file already uploaded to Iagon
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
            className="p-2 rounded-[var(--radius-md)] btn-base btn-icon"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Section 1: Iagon File Reference */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Iagon File Reference</h3>
                <button
                  type="button"
                  onClick={handlePasteAll}
                  disabled={isSubmitting}
                  className="px-2.5 py-1 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-secondary"
                  title="Paste JSON with fileId, key, nonce, digest, ext fields"
                >
                  Paste All
                </button>
              </div>

              {/* File ID */}
              <div>
                <label htmlFor="iagonFileId" className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] mb-1.5">
                  File ID <span className="text-[var(--error)]">*</span>
                  <InfoTooltip text="The Iagon file _id returned from the upload API." />
                </label>
                <input
                  ref={fileIdRef}
                  type="text"
                  id="iagonFileId"
                  name="iagonFileId"
                  value={formData.iagonFileId}
                  onChange={handleInputChange}
                  onBlur={() => handleFieldBlur('iagonFileId')}
                  disabled={isSubmitting}
                  placeholder="e.g. 507f1f77bcf86cd799439011"
                  className={monoInputClass('iagonFileId')}
                />
                {errors.iagonFileId && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.iagonFileId}</p>}
              </div>

              {/* AES Key + Nonce row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="aesKeyHex" className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    AES Key <span className="text-[var(--error)]">*</span>
                    <InfoTooltip text="The 32-byte AES-256 encryption key (64 hex characters) used to encrypt the file." />
                  </label>
                  <input
                    type="text"
                    id="aesKeyHex"
                    name="aesKeyHex"
                    value={formData.aesKeyHex}
                    onChange={handleInputChange}
                    onBlur={() => handleFieldBlur('aesKeyHex')}
                    disabled={isSubmitting}
                    placeholder="64 hex characters"
                    maxLength={64}
                    className={monoInputClass('aesKeyHex')}
                  />
                  {errors.aesKeyHex && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.aesKeyHex}</p>}
                </div>
                <div>
                  <label htmlFor="gcmNonceHex" className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    GCM Nonce <span className="text-[var(--error)]">*</span>
                    <InfoTooltip text="The 12-byte GCM initialization vector (24 hex characters) used during encryption." />
                  </label>
                  <input
                    type="text"
                    id="gcmNonceHex"
                    name="gcmNonceHex"
                    value={formData.gcmNonceHex}
                    onChange={handleInputChange}
                    onBlur={() => handleFieldBlur('gcmNonceHex')}
                    disabled={isSubmitting}
                    placeholder="24 hex characters"
                    maxLength={24}
                    className={monoInputClass('gcmNonceHex')}
                  />
                  {errors.gcmNonceHex && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.gcmNonceHex}</p>}
                </div>
              </div>

              {/* Digest + Extension row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor="sha256DigestHex" className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    SHA-256 Digest <span className="text-[var(--error)]">*</span>
                    <InfoTooltip text="SHA-256 hash of the original (unencrypted) file (64 hex characters). Used to verify integrity after decryption." />
                  </label>
                  <input
                    type="text"
                    id="sha256DigestHex"
                    name="sha256DigestHex"
                    value={formData.sha256DigestHex}
                    onChange={handleInputChange}
                    onBlur={() => handleFieldBlur('sha256DigestHex')}
                    disabled={isSubmitting}
                    placeholder="64 hex characters"
                    maxLength={64}
                    className={monoInputClass('sha256DigestHex')}
                  />
                  {errors.sha256DigestHex && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.sha256DigestHex}</p>}
                </div>
                <div>
                  <label htmlFor="fileExtension" className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    Extension
                    <InfoTooltip text="Original file extension (e.g. .pdf, .mp3). Determines how buyers view the file." />
                  </label>
                  <input
                    type="text"
                    id="fileExtension"
                    name="fileExtension"
                    value={formData.fileExtension}
                    onChange={handleExtensionChange}
                    onBlur={() => handleFieldBlur('fileExtension')}
                    disabled={isSubmitting}
                    placeholder=".pdf"
                    className={inputClass('fileExtension')}
                  />
                  {errors.fileExtension && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.fileExtension}</p>}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[var(--border-subtle)]" />

            {/* Section 2: Listing Details */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">Listing Details</h3>

              {/* Description */}
              <div>
                <label htmlFor="import-description" className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                  Description <span className="text-[var(--error)]">*</span>
                </label>
                <textarea
                  id="import-description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  onBlur={() => handleFieldBlur('description')}
                  disabled={isSubmitting}
                  rows={2}
                  maxLength={500}
                  placeholder="Brief description of what you're selling (visible to buyers)"
                  className={`${inputClass('description')} resize-none`}
                />
                {errors.description && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.description}</p>}
                <p className={`mt-1 text-xs ${
                  formData.description.length > 500 ? 'text-[var(--error)]'
                    : formData.description.length > 400 ? 'text-[var(--warning)]'
                    : 'text-[var(--text-muted)]'
                }`}>
                  {formData.description.length}/500 characters
                </p>
              </div>

              {/* Price + Image Link */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="import-suggestedPrice" className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    Suggested Price (ADA)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      id="import-suggestedPrice"
                      name="suggestedPrice"
                      value={displayPrice}
                      onChange={handlePriceChange}
                      onFocus={handlePriceFocus}
                      onBlur={handlePriceBlur}
                      disabled={isSubmitting}
                      placeholder="0.00"
                      className={`${inputClass('suggestedPrice')} pr-12`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">ADA</span>
                  </div>
                  {errors.suggestedPrice && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.suggestedPrice}</p>}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Optional. Buyers can bid any amount.</p>
                </div>
                <div>
                  <label htmlFor="import-imageLink" className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    Image Link
                  </label>
                  <input
                    type="text"
                    id="import-imageLink"
                    name="imageLink"
                    value={formData.imageLink}
                    onChange={handleInputChange}
                    onBlur={() => handleFieldBlur('imageLink')}
                    disabled={isSubmitting}
                    placeholder="https://example.com/preview.png"
                    className={inputClass('imageLink')}
                  />
                  {errors.imageLink && <p role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.imageLink}</p>}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Optional. Public preview image URL.</p>
                </div>
              </div>

              {/* Auto-detected category */}
              {formData.category !== 'other' && (
                <p className="text-xs text-[var(--text-muted)]">
                  Category auto-detected: <span className="font-medium text-[var(--text-secondary)]">{formData.category}</span>
                </p>
              )}
            </div>

            {/* Submit Error */}
            {submitError && (
              <div className="flex items-start gap-2 p-3 bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-[var(--radius-md)]">
                <p className="flex-1 text-sm text-[var(--error)]">{submitError}</p>
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(submitError);
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
            <div className="mb-4 p-3 bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-[var(--radius-md)]">
              <p className="text-xs text-[var(--accent)]">
                <strong>Note:</strong> The file must already be encrypted and uploaded to Iagon.
                This will create an on-chain listing referencing that file. You'll need to sign a transaction with your wallet.
              </p>
            </div>

            {/* Progress stepper */}
            {isSubmitting && creationStep && (
              <div className="mb-4 space-y-1" role="status" aria-label="Import listing progress">
                {IMPORT_LISTING_STEPS.map((step) => {
                  const currentOrder = STEP_ORDER[creationStep];
                  const stepOrder = STEP_ORDER[step.key];
                  const isCompleted = stepOrder < currentOrder;
                  const isCurrent = step.key === creationStep;

                  return (
                    <div key={step.key} className="flex items-center gap-2.5">
                      <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                        {isCompleted ? (
                          <svg className="w-4 h-4 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : isCurrent ? (
                          <LoadingSpinner size="sm" label={step.label} />
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full border-2 border-[var(--border-subtle)]" aria-hidden="true" />
                        )}
                      </div>
                      <span className={`text-xs ${
                        isCompleted ? 'text-[var(--success)]'
                          : isCurrent ? 'text-[var(--text-primary)] font-medium'
                          : 'text-[var(--text-muted)]'
                      }`}>
                        {step.label}{isCurrent && '...'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

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
                    {creationStep === 'building' && 'Building transaction...'}
                    {creationStep === 'signing' && 'Waiting for signature...'}
                    {creationStep === 'submitting' && 'Submitting transaction...'}
                    {!creationStep && 'Creating...'}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
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
