import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { stat } from '@tauri-apps/plugin-fs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import LoadingSpinner from './LoadingSpinner';
import ConfirmModal from './ConfirmModal';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { copyToClipboard } from '../utils/clipboard';
import { getCategoryConfig, detectCategoryFromExtension, type FileCategory } from '../config/categories';
import SubCategorySelector from './SubCategorySelector';
import type { ListingCreationStep } from '../services/transactionBuilder';
import {
  saveListingFormDraft,
  getListingFormDraft,
  clearListingFormDraft,
} from '../services/listingFormDraftStorage';

export interface CreateListingFormData {
  category: FileCategory;
  subcategory: string;
  nsfw: boolean;
  secretMessage: string;
  file: File | null;
  /** Absolute path to the file on disk (from native dialog). Used by Rust for encrypt+upload. */
  filePath: string | null;
  /** File name from native dialog (for display). */
  fileName: string | null;
  /** File size in bytes from native dialog (for validation/display). */
  fileSize: number | null;
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
  /** Pre-fill form fields (e.g. when relisting from Library). Merged with defaults on open. */
  prefill?: Partial<CreateListingFormData> | null;
  /** Override modal title (e.g. "Relist from Library"). */
  title?: string;
}

/** Files above this threshold show an informational upload time warning. */
const LARGE_FILE_THRESHOLD_BYTES = 1024 * 1024 * 1024; // 1 GB

/** All steps for file-based listing creation. */
const FILE_LISTING_STEPS: { key: ListingCreationStep; label: string }[] = [
  { key: 'encrypting', label: 'Encrypting file' },
  { key: 'uploading', label: 'Uploading to Iagon' },
  { key: 'verifying', label: 'Verifying upload' },
  { key: 'building', label: 'Building transaction' },
  { key: 'signing', label: 'Signing transaction' },
  { key: 'submitting', label: 'Submitting to chain' },
];

/** Steps for text-only listing creation (no file upload). */
const TEXT_LISTING_STEPS: { key: ListingCreationStep; label: string }[] = [
  { key: 'building', label: 'Building transaction' },
  { key: 'signing', label: 'Signing transaction' },
  { key: 'submitting', label: 'Submitting to chain' },
];

/** Maps each step to its ordinal index for comparison. */
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

const INITIAL_FORM_DATA: CreateListingFormData = {
  category: 'text',
  subcategory: '',
  nsfw: false,
  secretMessage: '',
  file: null,
  filePath: null,
  fileName: null,
  fileSize: null,
  description: '',
  suggestedPrice: '',
  imageLink: '',
};

export default function CreateListingModal({
  isOpen,
  onClose,
  onSubmit,
  isIagonConnected = false,
  prefill,
  title,
}: CreateListingModalProps) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<CreateListingFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedError, setCopiedError] = useState(false);
  const [creationStep, setCreationStep] = useState<ListingCreationStep | null>(null);
  const [displayPrice, setDisplayPrice] = useState('');
  const [imagePreviewState, setImagePreviewState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  // Refs read by the drag-drop event listener so it can subscribe once per
  // open without re-running on every keystroke / state change.
  const isSubmittingRef = useRef(isSubmitting);
  const hasFileRef = useRef<boolean>(false);
  const processSelectedFileRef = useRef<(filePath: string) => Promise<void>>(async () => {});

  // Reset form when modal opens (only on isOpen transition)
  useEffect(() => {
    if (isOpen) {
      if (prefill) {
        // Pre-fill mode (e.g. relist from Library) — skip draft prompt
        setFormData({ ...INITIAL_FORM_DATA, ...prefill });
        setShowDraftPrompt(false);
        setDisplayPrice(formatPrice(prefill.suggestedPrice || ''));
        setTimeout(() => descriptionRef.current?.focus(), 50);
      } else {
        const savedDraft = getListingFormDraft();
        if (savedDraft && (savedDraft.description || savedDraft.secretMessage || savedDraft.suggestedPrice)) {
          setShowDraftPrompt(true);
        } else {
          setFormData(INITIAL_FORM_DATA);
          setShowDraftPrompt(false);
          setTimeout(() => descriptionRef.current?.focus(), 50);
        }
        setDisplayPrice('');
      }
      setImagePreviewState('idle');
      setImagePreviewUrl(null);
      setErrors({});
      setSubmitError(null);
      setCreationStep(null);
      setDraftSaved(false);
      setIsDirty(false);
      setShowCloseConfirm(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
          subcategory: formData.subcategory,
          nsfw: formData.nsfw,
          secretMessage: formData.secretMessage,
          description: formData.description,
          suggestedPrice: formData.suggestedPrice,
          imageLink: formData.imageLink,
          fileName: formData.fileName ?? formData.file?.name ?? null,
          savedAt: new Date().toISOString(),
        });
        setDraftSaved(true);
        if (draftSavedTimerRef.current) clearTimeout(draftSavedTimerRef.current);
        draftSavedTimerRef.current = setTimeout(() => setDraftSaved(false), 1500);
      }
    }, 500);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (draftSavedTimerRef.current) clearTimeout(draftSavedTimerRef.current);
    };
  }, [isOpen, showDraftPrompt, isSubmitting, formData]);

  // Keep refs in sync so the drag-drop subscription (which runs once per open)
  // can read the latest values without re-subscribing on every render.
  isSubmittingRef.current = isSubmitting;
  hasFileRef.current = formData.filePath !== null;

  // Tauri drag-and-drop file import (file mode only). Subscribes once per
  // (isOpen, isFileMode) cycle; reads latest isSubmitting / filePath via refs.
  const isFileModeForDragDrop = formData.category !== 'text';
  useEffect(() => {
    if (!isOpen) return;
    if (!isFileModeForDragDrop) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const subscribe = async () => {
      try {
        const win = getCurrentWindow();
        const fn = await win.onDragDropEvent((event) => {
          const payload = event.payload as { type: string; paths?: string[] };
          if (payload.type === 'enter' || payload.type === 'over') {
            if (isSubmittingRef.current || hasFileRef.current) return;
            setIsDragOver(true);
          } else if (payload.type === 'leave' || payload.type === 'cancel') {
            setIsDragOver(false);
          } else if (payload.type === 'drop') {
            setIsDragOver(false);
            if (isSubmittingRef.current || hasFileRef.current) return;
            const paths = payload.paths;
            if (paths && paths.length > 0) {
              processSelectedFileRef.current(paths[0]);
            }
          }
        });
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      } catch {
        // Drag-drop unsupported (non-Tauri env / test) — silently ignore.
      }
    };

    subscribe();

    return () => {
      cancelled = true;
      setIsDragOver(false);
      if (unlisten) unlisten();
    };
  }, [isOpen, isFileModeForDragDrop]);

  // Close with unsaved changes warning
  const handleClose = () => {
    if (isDirty && !isSubmitting) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleConfirmClose = () => {
    setShowCloseConfirm(false);
    onClose();
  };

  // Stack-aware Escape key + body scroll lock
  const { zIndex, shouldRender, animationState } = useModalStack('create-listing', isOpen, handleClose, isSubmitting);
  const focusTrapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(focusTrapRef, isOpen);

  const isFileMode = formData.category !== 'text';
  const canSubmit = (isFileMode ? isIagonConnected : true) && !isSubmitting;

  const validateField = (fieldName: keyof FormErrors): string | undefined => {
    switch (fieldName) {
      case 'secretMessage':
        if (formData.category === 'text') {
          if (!formData.secretMessage.trim()) return 'Secret message is required';
          if (formData.secretMessage.length > 280) return 'Message must be 280 characters or less';
        }
        return undefined;
      case 'file':
        if (isFileMode && !formData.filePath) return 'File is required';
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
            if (!['http:', 'https:'].includes(url.protocol)) return 'Image link must use http:// or https://';
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
    const fields: (keyof FormErrors)[] = ['secretMessage', 'file', 'description', 'suggestedPrice', 'imageLink'];
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

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setSubmitError(null);
    setIsDirty(true);
  };

  const handleModeToggle = (mode: 'text' | 'file') => {
    if (isSubmitting) return;
    setFormData((prev) => ({
      ...prev,
      category: mode === 'text' ? 'text' : 'other',
      subcategory: '',
      secretMessage: '',
      file: null,
      filePath: null,
      fileName: null,
      fileSize: null,
    }));
    setErrors({});
    setSubmitError(null);
  };

  const handleResumeDraft = () => {
    const draft = getListingFormDraft();
    if (draft) {
      setFormData({
        category: (draft.category as FileCategory) || 'text',
        subcategory: draft.subcategory || '',
        nsfw: draft.nsfw || false,
        secretMessage: draft.secretMessage || '',
        file: null,
        filePath: null,
        fileName: null,
        fileSize: null,
        description: draft.description || '',
        suggestedPrice: draft.suggestedPrice || '',
        imageLink: draft.imageLink || '',
      });
      setDisplayPrice(formatPrice(draft.suggestedPrice || ''));
    }
    setShowDraftPrompt(false);
    setIsDirty(false);
  };

  const handleDiscardDraft = () => {
    clearListingFormDraft();
    setFormData(INITIAL_FORM_DATA);
    setDisplayPrice('');
    setShowDraftPrompt(false);
    setIsDirty(false);
  };

  const processSelectedFile = async (filePath: string) => {
    try {
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
      const fileStat = await stat(filePath);
      const fileSize = fileStat.size;

      if (fileSize > LARGE_FILE_THRESHOLD_BYTES) {
        setErrors((prev) => ({ ...prev, file: 'File too large (max 1 GB)' }));
        return;
      }

      const category = detectCategoryFromExtension(fileName);
      setFormData((prev) => ({ ...prev, file: null, filePath, fileName, fileSize, category, subcategory: '' }));
      setErrors((prev) => (prev.file ? { ...prev, file: undefined } : prev));
      setSubmitError(null);
      setIsDirty(true);
    } catch (err) {
      setErrors((prev) => ({ ...prev, file: `Failed to select file: ${err instanceof Error ? err.message : 'Unknown error'}` }));
    }
  };

  // Keep the ref pointing at the latest closure so the drag-drop listener
  // calls the up-to-date version (which captures fresh state setters).
  processSelectedFileRef.current = processSelectedFile;

  const handleChooseFile = async () => {
    if (isSubmitting) return;
    try {
      const selected = await open({
        multiple: false,
        title: 'Select file for listing',
      });
      if (!selected) return; // User cancelled
      const filePath = typeof selected === 'string' ? selected : selected;
      await processSelectedFile(filePath);
    } catch (err) {
      setErrors((prev) => ({ ...prev, file: `Failed to select file: ${err instanceof Error ? err.message : 'Unknown error'}` }));
    }
  };

  const handleRemoveFile = () => {
    setFormData((prev) => ({ ...prev, file: null, filePath: null, fileName: null, fileSize: null, category: 'other' }));
  };

  const handleImageLinkBlur = () => {
    const url = formData.imageLink.trim();
    if (!url) {
      setImagePreviewState('idle');
      setImagePreviewUrl(null);
      handleFieldBlur('imageLink');
      return;
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setImagePreviewState('error');
        setImagePreviewUrl(null);
        handleFieldBlur('imageLink');
        return;
      }
      setImagePreviewState('loading');
      setImagePreviewUrl(url);
    } catch {
      setImagePreviewState('error');
      setImagePreviewUrl(null);
    }
    handleFieldBlur('imageLink');
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    setIsDirty(true);
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

    if (!canSubmit || !validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setCreationStep(null);

    try {
      await onSubmit(formData, setCreationStep);
      clearListingFormDraft();
      setIsDirty(false);
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

  if (!shouldRender) return (
    <ConfirmModal
      isOpen={showCloseConfirm}
      onClose={() => setShowCloseConfirm(false)}
      onConfirm={handleConfirmClose}
      title="Discard changes?"
      message="You have unsaved changes that will be lost if you close this form."
      confirmLabel="Discard"
      confirmVariant="danger"
    />
  );

  return (
    <>
    <div
      ref={focusTrapRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-listing-title"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={isSubmitting ? undefined : handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className={`relative w-full max-w-2xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg overflow-hidden flex flex-col mx-4 ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="create-listing-title" className="text-lg font-semibold text-[var(--text-primary)]">
              {title ?? 'Create New Listing'}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {prefill ? 'Re-encrypt and list content from your library' : 'Encrypt and list your data for sale'}
            </p>
          </div>
          <button
            onClick={handleClose}
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
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-secondary"
                  >
                    Resume Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
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
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)] border text-sm transition-all duration-[var(--transition-fast)] cursor-pointer disabled:cursor-not-allowed ${
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
                  className={`relative flex items-center justify-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)] border text-sm transition-all duration-[var(--transition-fast)] cursor-pointer disabled:cursor-not-allowed ${
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
                {isFileMode
                  ? 'Files are encrypted and uploaded to Iagon decentralized storage.'
                  : 'Text listings store content directly on-chain in the encrypted capsule.'}
              </p>
            </div>

            {/* Sub-category selector — in file mode, only show after file is selected */}
            {(!isFileMode || formData.filePath) && (
              <SubCategorySelector
                category={formData.category}
                selected={formData.subcategory}
                onChange={(sub) => {
                  setFormData((prev) => ({ ...prev, subcategory: sub }));
                  setIsDirty(true);
                }}
                disabled={isSubmitting}
              />
            )}

            {/* NSFW toggle */}
            <button
              type="button"
              onClick={() => {
                if (!isSubmitting) {
                  setFormData((prev) => ({ ...prev, nsfw: !prev.nsfw }));
                  setIsDirty(true);
                }
              }}
              disabled={isSubmitting}
              className={`self-start flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                formData.nsfw
                  ? 'bg-[var(--error)]/15 text-[var(--error)] border-[var(--error)]/40'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
              }`}
              title={formData.nsfw ? 'Marked as NSFW — click to remove' : 'Mark as NSFW content'}
              aria-pressed={formData.nsfw}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                {formData.nsfw && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.75h.007v.008H12v-.008z" />}
              </svg>
              NSFW
            </button>

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
                  onBlur={() => handleFieldBlur('secretMessage')}
                  disabled={isSubmitting}
                  rows={4}
                  maxLength={280}
                  placeholder="Enter the secret data you want to sell..."
                  aria-invalid={!!errors.secretMessage}
                  aria-describedby={errors.secretMessage ? 'secretMessage-error' : undefined}
                  className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] resize-none disabled:opacity-50 ${
                    errors.secretMessage ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                {errors.secretMessage && (
                  <p id="secretMessage-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.secretMessage}</p>
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
                {formData.filePath ? (
                  <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm text-[var(--text-primary)] truncate" title={formData.fileName ?? undefined}>{formData.fileName}</p>
                        <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                          {getCategoryConfig(formData.category)?.label || 'Other'}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">{formatFileSize(formData.fileSize ?? 0)}</p>
                      {(formData.fileSize ?? 0) > LARGE_FILE_THRESHOLD_BYTES && (
                        <p className="text-xs text-[var(--warning)] mt-0.5">
                          Large files take longer to encrypt and upload.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      disabled={isSubmitting}
                      aria-label="Remove selected file"
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--error)] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleChooseFile}
                    disabled={isSubmitting}
                    data-drag-over={isDragOver || undefined}
                    className={`flex flex-col items-center justify-center gap-2 p-6 w-full border-2 border-dashed rounded-[var(--radius-md)] cursor-pointer transition-all duration-[var(--transition-fast)] ${
                      errors.file
                        ? 'border-[var(--error)] bg-[var(--error)]/5'
                        : isDragOver
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 scale-[1.01]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'
                    }`}
                  >
                    <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-[var(--text-secondary)]">
                      Drag & drop or click to select
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      Type will be detected automatically
                    </span>
                  </button>
                )}
                {errors.file && (
                  <p id="file-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.file}</p>
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
                    <span className="text-sm text-[var(--text-muted)]">Drag & drop or click to select</span>
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
                        className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-secondary"
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
                ref={descriptionRef}
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                onBlur={() => handleFieldBlur('description')}
                disabled={isSubmitting}
                rows={2}
                maxLength={500}
                placeholder="Brief description of what you're selling (visible to buyers)"
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? 'description-error' : undefined}
                className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] resize-none disabled:opacity-50 ${
                  errors.description ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                }`}
              />
              {errors.description && (
                <p id="description-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.description}</p>
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
                    inputMode="decimal"
                    id="suggestedPrice"
                    name="suggestedPrice"
                    value={displayPrice}
                    onChange={handlePriceChange}
                    onFocus={handlePriceFocus}
                    onBlur={handlePriceBlur}
                    disabled={isSubmitting}
                    placeholder="0.00"
                    aria-invalid={!!errors.suggestedPrice}
                    aria-describedby={errors.suggestedPrice ? 'suggestedPrice-error' : undefined}
                    className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 pr-12 ${
                      errors.suggestedPrice ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                    }`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                    ADA
                  </span>
                </div>
                {errors.suggestedPrice && (
                  <p id="suggestedPrice-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.suggestedPrice}</p>
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
                  aria-invalid={!!errors.imageLink}
                  aria-describedby={errors.imageLink ? 'imageLink-error' : undefined}
                  className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 ${
                    errors.imageLink ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'
                  }`}
                />
                {errors.imageLink && (
                  <p id="imageLink-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.imageLink}</p>
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

            {draftSaved && (
              <p className="mb-2 text-xs text-[var(--text-muted)] draft-saved-indicator text-center">
                Draft saved
              </p>
            )}

            {/* Progress stepper — shown during submission */}
            {isSubmitting && creationStep && (
              <div className="mb-4 space-y-1" role="status" aria-label="Listing creation progress">
                {(isFileMode ? FILE_LISTING_STEPS : TEXT_LISTING_STEPS).map((step) => {
                  const currentOrder = STEP_ORDER[creationStep];
                  const stepOrder = STEP_ORDER[step.key];
                  const isCompleted = stepOrder < currentOrder;
                  const isCurrent = step.key === creationStep;

                  return (
                    <div key={step.key} className="flex items-center gap-2.5">
                      {/* Step indicator */}
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
                      {/* Step label */}
                      <span className={`text-xs ${
                        isCompleted
                          ? 'text-[var(--success)]'
                          : isCurrent
                            ? 'text-[var(--text-primary)] font-medium'
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
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-2 btn-base btn-primary"
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
    <ConfirmModal
      isOpen={showCloseConfirm}
      onClose={() => setShowCloseConfirm(false)}
      onConfirm={handleConfirmClose}
      title="Discard changes?"
      message="You have unsaved changes that will be lost if you close this form."
      confirmLabel="Discard"
      confirmVariant="danger"
    />
    </>
  );
}
