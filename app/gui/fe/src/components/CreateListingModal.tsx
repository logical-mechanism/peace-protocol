import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import { useModalStack } from '../hooks/useModalStack';
import { getCategoryConfig, detectCategoryFromExtension, type FileCategory } from '../config/categories';
import type { ListingCreationStep } from '../services/transactionBuilder';
import {
  saveListingFormDraft,
  getListingFormDraft,
  clearListingFormDraft,
} from '../services/listingFormDraftStorage';

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
  onSubmit: (data: CreateListingFormData, onProgress?: (step: ListingCreationStep) => void) => Promise<void>;
  isIagonConnected?: boolean;
}

/** Files above this threshold show an informational upload time warning. */
const LARGE_FILE_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB

function formatPrice(raw: string): string {
  if (!raw || raw.endsWith('.')) return raw;
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(num);
}

const INITIAL_FORM_DATA: CreateListingFormData = {
  category: 'text',
  secretMessage: '',
  file: null,
  description: '',
  suggestedPrice: '',
  imageLink: '',
};

export default function CreateListingModal({
  isOpen,
  onClose,
  onSubmit,
  isIagonConnected = false,
}: CreateListingModalProps) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<CreateListingFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creationStep, setCreationStep] = useState<ListingCreationStep | null>(null);
  const [displayPrice, setDisplayPrice] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [imagePreviewState, setImagePreviewState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset form when modal opens (only on isOpen transition)
  useEffect(() => {
    if (isOpen) {
      const savedDraft = getListingFormDraft();
      if (savedDraft && (savedDraft.description || savedDraft.secretMessage || savedDraft.suggestedPrice)) {
        setShowDraftPrompt(true);
      } else {
        setFormData(INITIAL_FORM_DATA);
        setShowDraftPrompt(false);
      }
      setDisplayPrice('');
      setIsDragging(false);
      setImagePreviewState('idle');
      setImagePreviewUrl(null);
      setErrors({});
      setSubmitError(null);
      setCreationStep(null);
    }
  }, [isOpen]);

  // Auto-save form state on change (debounced 500ms)
  useEffect(() => {
    if (!isOpen || showDraftPrompt || isSubmitting) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (formData.description || formData.secretMessage || formData.suggestedPrice || formData.imageLink) {
        saveListingFormDraft({
          category: formData.category,
          secretMessage: formData.secretMessage,
          description: formData.description,
          suggestedPrice: formData.suggestedPrice,
          imageLink: formData.imageLink,
          fileName: formData.file?.name ?? null,
          savedAt: new Date().toISOString(),
        });
      }
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [isOpen, showDraftPrompt, isSubmitting, formData]);

  // Stack-aware Escape key + body scroll lock
  const { zIndex } = useModalStack('create-listing', isOpen, onClose, isSubmitting);

  const isFileMode = formData.category !== 'text';
  const canSubmit = (isFileMode ? isIagonConnected : true) && !isSubmitting;

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

    // File validation (file mode)
    if (isFileMode) {
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

  const handleModeToggle = (mode: 'text' | 'file') => {
    if (isSubmitting) return;
    setFormData((prev) => ({
      ...prev,
      category: mode === 'text' ? 'text' : 'other',
      secretMessage: '',
      file: null,
    }));
    setErrors({});
    setSubmitError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleResumeDraft = () => {
    const draft = getListingFormDraft();
    if (draft) {
      setFormData({
        category: (draft.category as FileCategory) || 'text',
        secretMessage: draft.secretMessage || '',
        file: null,
        description: draft.description || '',
        suggestedPrice: draft.suggestedPrice || '',
        imageLink: draft.imageLink || '',
      });
      setDisplayPrice(formatPrice(draft.suggestedPrice || ''));
    }
    setShowDraftPrompt(false);
  };

  const handleDiscardDraft = () => {
    clearListingFormDraft();
    setFormData(INITIAL_FORM_DATA);
    setDisplayPrice('');
    setShowDraftPrompt(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    const category = file ? detectCategoryFromExtension(file.name) : 'other';
    setFormData((prev) => ({ ...prev, file, category }));
    if (errors.file) {
      setErrors((prev) => ({ ...prev, file: undefined }));
    }
    setSubmitError(null);
  };

  const handleRemoveFile = () => {
    setFormData((prev) => ({ ...prev, file: null, category: 'other' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSubmitting && isFileMode && isIagonConnected) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only unset when leaving the drop zone, not when entering a child element
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isSubmitting || !isFileMode || !isIagonConnected) return;

    const file = e.dataTransfer.files[0] || null;
    if (!file) return;

    const category = detectCategoryFromExtension(file.name);
    setFormData((prev) => ({ ...prev, file, category }));
    if (errors.file) {
      setErrors((prev) => ({ ...prev, file: undefined }));
    }
    setSubmitError(null);
  };

  const handleImageLinkBlur = () => {
    const url = formData.imageLink.trim();
    if (!url) {
      setImagePreviewState('idle');
      setImagePreviewUrl(null);
      return;
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setImagePreviewState('error');
        setImagePreviewUrl(null);
        return;
      }
      setImagePreviewState('loading');
      setImagePreviewUrl(url);
    } catch {
      setImagePreviewState('error');
      setImagePreviewUrl(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, '');
    setFormData((prev) => ({ ...prev, suggestedPrice: raw }));
    setDisplayPrice(e.target.value);
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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canSubmit || !validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setCreationStep(null);

    try {
      await onSubmit(formData, setCreationStep);
      clearListingFormDraft();
      onClose();
    } catch (error) {
      console.error('Failed to create listing:', error);
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to create listing. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
      setCreationStep(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
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
            {/* Draft restoration prompt */}
            {showDraftPrompt && (
              <div className="p-3 bg-[var(--accent-muted)] border border-[var(--accent)]/30 rounded-[var(--radius-md)]">
                <p className="text-sm text-[var(--text-primary)] mb-2">
                  You have an unsaved draft. Would you like to resume?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleResumeDraft}
                    className="px-3 py-1.5 text-xs font-medium text-[var(--accent)] border border-[var(--accent)]/30 rounded-[var(--radius-md)] hover:bg-[var(--accent)]/10 transition-colors cursor-pointer"
                  >
                    Resume Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    className="px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
                  >
                    Start Fresh
                  </button>
                </div>
              </div>
            )}

            {/* Mode Toggle: Text vs File */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                Data Type <span className="text-[var(--error)]">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleModeToggle('text')}
                  disabled={isSubmitting}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)] border text-sm transition-all duration-150 cursor-pointer disabled:cursor-not-allowed ${
                    !isFileMode
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  <span className="font-medium">Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleModeToggle('file')}
                  disabled={isSubmitting}
                  className={`relative flex items-center justify-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)] border text-sm transition-all duration-150 cursor-pointer disabled:cursor-not-allowed ${
                    isFileMode
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : isIagonConnected
                        ? 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                  }`}
                >
                  {!isIagonConnected && (
                    <div className="absolute top-1 right-1">
                      <svg className="w-2.5 h-2.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </div>
                  )}
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="font-medium">File</span>
                </button>
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                {isFileMode ? 'Upload any file — type is auto-detected' : 'On-chain text message (no file upload)'}
              </p>
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
                <p className={`mt-1 text-xs ${
                  formData.secretMessage.length > 280
                    ? 'text-[var(--error)]'
                    : formData.secretMessage.length > 224
                      ? 'text-[var(--warning)]'
                      : 'text-[var(--text-muted)]'
                }`}>
                  {formData.secretMessage.length}/280 characters
                </p>
              </div>
            )}

            {/* Content Area — File mode (Iagon connected) */}
            {isFileMode && isIagonConnected && (
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Upload File <span className="text-[var(--error)]">*</span>
                </label>
                {formData.file ? (
                  <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm text-[var(--text-primary)] truncate">{formData.file.name}</p>
                        <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                          {getCategoryConfig(formData.category)?.label || 'Other'}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">{formatFileSize(formData.file.size)}</p>
                      {formData.file.size > LARGE_FILE_THRESHOLD_BYTES && (
                        <p className="text-xs text-[var(--warning)] mt-0.5">
                          Large files take longer to encrypt and upload.
                        </p>
                      )}
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
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-[var(--radius-md)] cursor-pointer transition-all duration-150 ${
                      isDragging
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : errors.file
                          ? 'border-[var(--error)] bg-[var(--error)]/5'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'
                    }`}
                  >
                    <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-[var(--text-secondary)]">
                      {isDragging ? 'Drop file here' : 'Click or drag a file here'}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      Type will be detected automatically
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileChange}
                      disabled={isSubmitting}
                      className="hidden"
                    />
                  </label>
                )}
                {errors.file && (
                  <p className="mt-1 text-xs text-[var(--error)]">{errors.file}</p>
                )}
              </div>
            )}

            {/* Content Area — File mode (Iagon not connected) */}
            {isFileMode && !isIagonConnected && (
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
                  </div>
                  {/* Iagon not connected overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="px-4 py-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-sm text-center">
                      <div className="flex items-center justify-center gap-2 mb-1">
                        <svg className="w-4 h-4 text-[var(--warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        <span className="text-sm font-medium text-[var(--text-primary)]">Iagon Required</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mb-2">
                        Connect your Iagon account to upload files.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate('/settings', { state: { section: 'datalayer' } });
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-[var(--accent)] border border-[var(--accent)]/30 rounded-[var(--radius-md)] hover:bg-[var(--accent)]/10 transition-colors cursor-pointer"
                      >
                        Go to Settings
                      </button>
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
              <p className={`mt-1 text-xs ${
                formData.description.length > 500
                  ? 'text-[var(--error)]'
                  : formData.description.length > 400
                    ? 'text-[var(--warning)]'
                    : 'text-[var(--text-muted)]'
              }`}>
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
                    value={displayPrice}
                    onChange={handlePriceChange}
                    onFocus={handlePriceFocus}
                    onBlur={handlePriceBlur}
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
                  onBlur={handleImageLinkBlur}
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
                {imagePreviewState !== 'idle' && (
                  <div className="mt-2 flex items-center gap-2">
                    {imagePreviewUrl ? (
                      <img
                        src={imagePreviewUrl}
                        alt="Preview"
                        className="w-16 h-16 rounded-[var(--radius-sm)] object-cover border border-[var(--border-subtle)]"
                        onLoad={() => setImagePreviewState('loaded')}
                        onError={() => {
                          setImagePreviewState('error');
                          setImagePreviewUrl(null);
                        }}
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-[var(--radius-sm)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center">
                        <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0023.25 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                      </div>
                    )}
                    {imagePreviewState === 'loading' && <LoadingSpinner size="sm" />}
                    {imagePreviewState === 'loaded' && (
                      <svg className="w-4 h-4 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {imagePreviewState === 'error' && (
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-xs text-[var(--text-muted)]">Could not load preview</span>
                      </div>
                    )}
                  </div>
                )}
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
                {isFileMode
                  ? ' Files are encrypted and uploaded to Iagon, with a reference stored on-chain.'
                  : ' Text data is stored on-chain.'}
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
                    {creationStep === 'encrypting' && 'Encrypting file...'}
                    {creationStep === 'uploading' && 'Uploading to Iagon...'}
                    {creationStep === 'verifying' && 'Verifying upload...'}
                    {creationStep === 'building' && 'Building transaction...'}
                    {creationStep === 'signing' && 'Waiting for signature...'}
                    {creationStep === 'submitting' && 'Submitting transaction...'}
                    {!creationStep && 'Creating...'}
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
