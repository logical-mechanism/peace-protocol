import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { stat } from '@tauri-apps/plugin-fs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { IWallet } from '@meshsdk/core';
import LoadingSpinner from './LoadingSpinner';
import ConfirmModal from './ConfirmModal';
import { useToast } from './Toast';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { copyToClipboard } from '../utils/clipboard';
import { formatWithCommas } from '../utils/formatAda';
import { getCategoryConfig, detectCategoryFromExtension, type FileCategory } from '../config/categories';
import SubCategorySelector from './SubCategorySelector';
import type { ListingCreationStep } from '../services/transactionBuilder';
import {
  saveListingFormDraft,
  getListingFormDraft,
  clearListingFormDraft,
} from '../services/listingFormDraftStorage';
import {
  getOnboardingState,
  markIagonPrimerCompleted,
} from '../services/onboardingStorage';
import { connectIagon } from '../services/iagonAuth';

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
  /** MeshWallet instance — required for the in-modal Iagon primer sign-in button. */
  wallet?: IWallet | null;
  /** Bech32 wallet address — required for the in-modal Iagon primer sign-in. */
  address?: string | null;
  /** Called after the primer successfully authenticates Iagon, so the parent can flip
   * its cached `isIagonConnected` flag without waiting for the next poll. */
  onIagonConnected?: () => void;
}

/** Files above this threshold show an informational upload time warning. */
const LARGE_FILE_THRESHOLD_BYTES = 1024 * 1024 * 1024; // 1 GB

/** All steps for file-based listing creation. */
const FILE_LISTING_STEPS: ListingCreationStep[] = [
  'encrypting', 'uploading', 'verifying', 'building', 'signing', 'submitting',
];

/** Steps for text-only listing creation (no file upload). */
const TEXT_LISTING_STEPS: ListingCreationStep[] = [
  'building', 'signing', 'submitting',
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

// Wraps the shared formatWithCommas helper so the existing call sites below
// keep their local name. Behavior matches the bid modals: thousands separators
// on the integer part, decimal portion preserved verbatim (so trailing zeros
// the user typed stay visible at rest).
const formatPrice = formatWithCommas;

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
  wallet,
  address,
  onIagonConnected,
}: CreateListingModalProps) {
  const { t } = useTranslation(['modals', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const [formData, setFormData] = useState<CreateListingFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  // Tracks which fields the user has actually interacted with. Blur-time
  // validation only fires for touched fields so a fresh form does not flash
  // red the moment the user tabs through it.
  const [touched, setTouched] = useState<Partial<Record<keyof FormErrors, boolean>>>({});
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
  const [primerDismissed, setPrimerDismissed] = useState<boolean>(() => getOnboardingState().iagonPrimerCompleted);
  const [iagonSigningIn, setIagonSigningIn] = useState(false);
  const [primerError, setPrimerError] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      } else {
        const savedDraft = getListingFormDraft();
        if (savedDraft && (savedDraft.description || savedDraft.secretMessage || savedDraft.suggestedPrice)) {
          setShowDraftPrompt(true);
        } else {
          setFormData(INITIAL_FORM_DATA);
          setShowDraftPrompt(false);
        }
        setDisplayPrice('');
      }
      setImagePreviewState('idle');
      setImagePreviewUrl(null);
      setErrors({});
      setTouched({});
      setSubmitError(null);
      setCreationStep(null);
      setDraftSaved(false);
      setIsDirty(false);
      setShowCloseConfirm(false);
      setPrimerDismissed(getOnboardingState().iagonPrimerCompleted);
      setPrimerError(null);
      setIagonSigningIn(false);
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
  const { zIndex, shouldRender, animationState, isTopmost } = useModalStack('create-listing', isOpen, handleClose, isSubmitting);
  const focusTrapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(focusTrapRef, isOpen, { isTopmost });

  const isFileMode = formData.category !== 'text';
  const canSubmit = (isFileMode ? isIagonConnected : true) && !isSubmitting;

  const validateField = (fieldName: keyof FormErrors): string | undefined => {
    switch (fieldName) {
      case 'secretMessage':
        if (formData.category === 'text') {
          if (!formData.secretMessage.trim()) return t('modals:createListing.errors.secretRequired');
          if (formData.secretMessage.length > 280) return t('modals:createListing.errors.secretMax');
        }
        return undefined;
      case 'file':
        if (isFileMode && !formData.filePath) return t('modals:createListing.errors.fileRequired');
        return undefined;
      case 'description':
        if (!formData.description.trim()) return t('modals:createListing.errors.descRequired');
        if (formData.description.length > 500) return t('modals:createListing.errors.descMax');
        return undefined;
      case 'suggestedPrice':
        if (formData.suggestedPrice) {
          const price = parseFloat(formData.suggestedPrice);
          if (isNaN(price) || price < 0) return t('modals:createListing.errors.pricePositive');
          if (price > 45_000_000_000) return t('modals:createListing.errors.priceMax');
        }
        return undefined;
      case 'imageLink':
        if (formData.imageLink.trim()) {
          try {
            const url = new URL(formData.imageLink.trim());
            if (!['http:', 'https:'].includes(url.protocol)) return t('modals:createListing.errors.imageInvalidProtocol');
          } catch {
            return t('modals:createListing.errors.imageInvalid');
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
    // Skip blur-time validation for fields the user has not interacted with
    // yet — tabbing through a pristine form should not trigger error styling.
    if (!touched[fieldName]) return;
    const error = validateField(fieldName);
    setErrors((prev) => ({ ...prev, [fieldName]: error }));
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setTouched((prev) => ({ ...prev, [name]: true }));
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
        setErrors((prev) => ({ ...prev, file: t('modals:createListing.errors.fileTooLarge') }));
        return;
      }

      const category = detectCategoryFromExtension(fileName);
      setFormData((prev) => ({ ...prev, file: null, filePath, fileName, fileSize, category, subcategory: '' }));
      setTouched((prev) => ({ ...prev, file: true }));
      setErrors((prev) => (prev.file ? { ...prev, file: undefined } : prev));
      setSubmitError(null);
      setIsDirty(true);
    } catch (err) {
      setErrors((prev) => ({ ...prev, file: t('modals:createListing.errors.fileSelectFailed', { message: err instanceof Error ? err.message : t('modals:createListing.errors.unknown') }) }));
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
        title: t('modals:createListing.fileDialogTitle'),
      });
      if (!selected) return; // User cancelled
      const filePath = typeof selected === 'string' ? selected : selected;
      await processSelectedFile(filePath);
    } catch (err) {
      setErrors((prev) => ({ ...prev, file: t('modals:createListing.errors.fileSelectFailed', { message: err instanceof Error ? err.message : t('modals:createListing.errors.unknown') }) }));
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
    setTouched((prev) => ({ ...prev, suggestedPrice: true }));
    if (errors.suggestedPrice) {
      setErrors((prev) => ({ ...prev, suggestedPrice: undefined }));
    }
    setSubmitError(null);
    setIsDirty(true);
  };

  const handlePriceFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setDisplayPrice(formData.suggestedPrice);
    // Select-all on focus so the user can immediately overwrite the value,
    // matching PlaceBid / UpdateBid / UpdatePrice modals.
    e.target.select();
  };

  const handlePriceBlur = () => {
    setDisplayPrice(formatPrice(formData.suggestedPrice));
    handleFieldBlur('suggestedPrice');
  };

  // ── Iagon primer (shown inline when user picks a file category without an
  // API key). Rendered instead of the full Iagon Required overlay; replaces
  // the "go to Settings" detour with an in-modal CIP-8 sign-in.
  const showIagonPrimer = isFileMode && !isIagonConnected && !primerDismissed;

  const handlePrimerSignIn = async () => {
    if (!wallet || !address) {
      setPrimerError(t('modals:createListing.iagonPrimer.errorPrefix') + t('modals:createListing.errors.unknown'));
      return;
    }
    setIagonSigningIn(true);
    setPrimerError(null);
    try {
      await connectIagon(wallet, address);
      markIagonPrimerCompleted();
      setPrimerDismissed(true);
      onIagonConnected?.();
      toast.success(
        t('modals:createListing.iagonPrimer.successToast.title'),
        t('modals:createListing.iagonPrimer.successToast.body'),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('modals:createListing.errors.unknown');
      setPrimerError(t('modals:createListing.iagonPrimer.errorPrefix') + msg);
    } finally {
      setIagonSigningIn(false);
    }
  };

  const handlePrimerSkip = () => {
    markIagonPrimerCompleted();
    setPrimerDismissed(true);
    toast.warning(
      t('modals:createListing.iagonPrimer.skipToast.title'),
      t('modals:createListing.iagonPrimer.skipToast.body'),
    );
  };

  const handlePrimerGoToSettings = () => {
    onClose();
    navigate('/settings', { state: { section: 'datalayer' } });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canSubmit) return;
    // Mark every field as touched so any errors raised by submit-time
    // validation stay visible until the user fixes them.
    setTouched({
      secretMessage: true,
      file: true,
      description: true,
      suggestedPrice: true,
      imageLink: true,
    });
    if (!validateForm()) return;

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
        error instanceof Error ? error.message : t('modals:createListing.errors.submitFailed')
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
      title={t('modals:createListing.discardTitle')}
      message={t('modals:createListing.discardMessage')}
      confirmLabel={t('modals:createListing.discardButton')}
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
        className={`absolute inset-0 bg-[var(--backdrop-overlay)] backdrop-blur-sm ${animationState === 'exiting' ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
        onClick={isSubmitting ? undefined : handleClose}
        aria-hidden="true"
      />

      {/* Modal — no overflow-hidden on panel root so focus outlines aren't clipped. */}
      <div className={`relative w-full max-w-2xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] shadow-lg flex flex-col mx-4 ${animationState === 'exiting' ? 'modal-panel-exit' : 'modal-panel-enter'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] rounded-t-[var(--radius-xl)]">
          <div>
            <h2 id="create-listing-title" className="text-lg font-semibold text-[var(--text-primary)]">
              {title ?? t('modals:createListing.title')}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {prefill ? t('modals:createListing.titleRelist') : t('modals:createListing.subtitle')}
            </p>
          </div>
          {/* tabIndex={-1}: Escape closes. */}
          <button
            onClick={handleClose}
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Draft restoration prompt */}
            {showDraftPrompt && (
              <div className="p-3 bg-[var(--accent-muted)] rounded-[var(--radius-md)]">
                <p className="text-sm text-[var(--text-primary)] mb-2">
                  {t('modals:createListing.draftPrompt')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleResumeDraft}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-secondary"
                  >
                    {t('modals:createListing.resumeDraft')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-tertiary"
                  >
                    {t('modals:createListing.startFresh')}
                  </button>
                </div>
              </div>
            )}

            {/* Iagon setup primer — one-shot contextual card shown in file mode
                when no API key is stored and the user hasn't dismissed it yet. */}
            {showIagonPrimer && (
              <div
                data-testid="iagon-primer"
                className="p-4 bg-[var(--accent-muted)] border border-[var(--accent)]/40 rounded-[var(--radius-md)] space-y-3"
              >
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-[var(--accent)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                      {t('modals:createListing.iagonPrimer.title')}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mb-1.5">
                      {t('modals:createListing.iagonPrimer.bodyWhat')}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {t('modals:createListing.iagonPrimer.bodyWhy')}
                    </p>
                  </div>
                </div>

                {primerError && (
                  <p role="alert" className="text-xs text-[var(--error)]">{primerError}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrimerSignIn}
                    disabled={iagonSigningIn || !wallet || !address}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] flex items-center gap-2 btn-base btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {iagonSigningIn ? (
                      <>
                        <LoadingSpinner size="sm" />
                        {t('modals:createListing.iagonPrimer.signingIn')}
                      </>
                    ) : (
                      t('modals:createListing.iagonPrimer.signInButton')
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrimerSkip}
                    disabled={iagonSigningIn}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('modals:createListing.iagonPrimer.skipButton')}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrimerGoToSettings}
                    disabled={iagonSigningIn}
                    className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                  >
                    {t('modals:createListing.iagonPrimer.manualLink')}
                  </button>
                </div>
              </div>
            )}

            {/* Mode Toggle: Text vs File */}
            <div id="tutorial-data-type-toggle">
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t('modals:createListing.dataType')} <span className="text-[var(--error)]">*</span>
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
                  <span className="font-medium">{t('modals:createListing.text')}</span>
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
                  <span className="font-medium">{t('modals:createListing.file')}</span>
                </button>
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                {isFileMode
                  ? t('modals:createListing.fileHint')
                  : t('modals:createListing.textHint')}
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
              title={formData.nsfw ? t('modals:createListing.nsfwUnmark') : t('modals:createListing.nsfwMark')}
              aria-pressed={formData.nsfw}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                {formData.nsfw && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.75h.007v.008H12v-.008z" />}
              </svg>
              {t('modals:createListing.nsfwLabel')}
            </button>

            {/* Content Area — Text category */}
            {formData.category === 'text' && (
              <div>
                <label
                  htmlFor="secretMessage"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  {t('modals:createListing.secretMessage')} <span className="text-[var(--error)]">*</span>
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
                  placeholder={t('modals:createListing.secretPlaceholder')}
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
                  {t('modals:createListing.charsCount', { current: formData.secretMessage.length, max: 280 })}
                </p>
              </div>
            )}

            {/* Content Area — File mode (Iagon connected) */}
            {isFileMode && isIagonConnected && (
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  {t('modals:createListing.uploadFile')} <span className="text-[var(--error)]">*</span>
                </label>
                {formData.filePath ? (
                  <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm text-[var(--text-primary)] truncate" title={formData.fileName ?? undefined}>{formData.fileName}</p>
                        <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 whitespace-nowrap">
                          {getCategoryConfig(formData.category)
                            ? t(`common:categories.${formData.category}`)
                            : t('common:categories.other')}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">{formatFileSize(formData.fileSize ?? 0)}</p>
                      {(formData.fileSize ?? 0) > LARGE_FILE_THRESHOLD_BYTES && (
                        <p className="text-xs text-[var(--warning)] mt-0.5">
                          {t('modals:createListing.largeFileWarning')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      disabled={isSubmitting}
                      aria-label={t('modals:createListing.removeFile')}
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
                      {t('modals:createListing.dragDrop')}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('modals:createListing.typeAutoDetect')}
                    </span>
                  </button>
                )}
                {errors.file && (
                  <p id="file-error" role="alert" className="mt-1 text-xs text-[var(--error)]">{errors.file}</p>
                )}
              </div>
            )}

            {/* Content Area — File mode (Iagon not connected, primer dismissed) */}
            {isFileMode && !isIagonConnected && !showIagonPrimer && (
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  {t('modals:createListing.uploadFile')}
                </label>
                <div className="relative">
                  <div className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-secondary)] opacity-40">
                    <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-[var(--text-muted)]">{t('modals:createListing.dragDrop')}</span>
                  </div>
                  {/* Iagon not connected overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="px-4 py-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-sm text-center">
                      <div className="flex items-center justify-center gap-2 mb-1">
                        <svg className="w-4 h-4 text-[var(--warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        <span className="text-sm font-medium text-[var(--text-primary)]">{t('modals:createListing.iagonRequired')}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mb-2">
                        {t('modals:createListing.iagonRequiredBody')}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate('/settings', { state: { section: 'datalayer' } });
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] btn-base btn-secondary"
                      >
                        {t('modals:createListing.goToSettings')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            <div id="tutorial-description-field">
              <label
                htmlFor="description"
                className="block text-sm font-medium text-[var(--text-primary)] mb-2"
              >
                {t('modals:createListing.description')} <span className="text-[var(--error)]">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                onBlur={() => handleFieldBlur('description')}
                disabled={isSubmitting}
                rows={2}
                maxLength={500}
                placeholder={t('modals:createListing.descriptionPlaceholder')}
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
                {t('modals:createListing.descriptionCharsCount', { current: formData.description.length, max: 500 })}
              </p>
            </div>

            {/* Price + Image Link — two-column row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Suggested Price */}
              <div id="tutorial-price-field">
                <label
                  htmlFor="suggestedPrice"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  {t('modals:createListing.suggestedPrice')}
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
                    placeholder={t('modals:createListing.pricePlaceholder')}
                    aria-invalid={!!errors.suggestedPrice}
                    aria-describedby={errors.suggestedPrice ? 'suggestedPrice-error' : undefined}
                    className={`w-full px-3 py-2 text-sm tnum bg-[var(--bg-secondary)] border rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-all duration-[var(--transition-fast)] disabled:opacity-50 pr-12 ${
                      errors.suggestedPrice ? 'field-invalid' : 'border-[var(--border-subtle)]'
                    }`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                    ADA
                  </span>
                </div>
                {errors.suggestedPrice && (
                  <p id="suggestedPrice-error" role="alert" className="field-invalid-helper">{errors.suggestedPrice}</p>
                )}
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t('modals:createListing.priceHelp')}
                </p>
              </div>

              {/* Image Link */}
              <div>
                <label
                  htmlFor="imageLink"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  {t('modals:createListing.imageLink')}
                </label>
                <input
                  type="text"
                  id="imageLink"
                  name="imageLink"
                  value={formData.imageLink}
                  onChange={handleInputChange}
                  onBlur={handleImageLinkBlur}
                  disabled={isSubmitting}
                  placeholder={t('modals:createListing.imageLinkPlaceholder')}
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
                  {t('modals:createListing.imageLinkHelp')}
                </p>
                {imagePreviewState !== 'idle' && (
                  <div className="mt-2 flex items-center gap-2">
                    {imagePreviewUrl ? (
                      <img
                        src={imagePreviewUrl}
                        alt={t('common:ui.preview')}
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
                        <span className="text-xs text-[var(--text-muted)]">{t('modals:createListing.previewFailed')}</span>
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
                  aria-label={t('modals:createListing.copyErrorLabel')}
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
                <strong>{t('modals:createListing.infoNoteLabel')}</strong> {t('modals:createListing.infoNoteCore')}
                {' '}{isFileMode
                  ? t('modals:createListing.infoNoteFile')
                  : t('modals:createListing.infoNoteText')}
                {' '}{t('modals:createListing.infoNoteSign')}
              </p>
            </div>

            {draftSaved && (
              <p className="mb-2 text-xs text-[var(--text-muted)] draft-saved-indicator text-center">
                {t('modals:createListing.draftSaved')}
              </p>
            )}

            {/* Progress stepper — shown during submission */}
            {isSubmitting && creationStep && (
              <div className="mb-4 space-y-1" role="status" aria-label={t('modals:createListing.progressLabel')}>
                {(isFileMode ? FILE_LISTING_STEPS : TEXT_LISTING_STEPS).map((stepKey) => {
                  const currentOrder = STEP_ORDER[creationStep];
                  const stepOrder = STEP_ORDER[stepKey];
                  const isCompleted = stepOrder < currentOrder;
                  const isCurrent = stepKey === creationStep;
                  const label = t(`modals:createListing.steps.${stepKey}`);

                  return (
                    <div key={stepKey} className="flex items-center gap-2.5">
                      {/* Step indicator */}
                      <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                        {isCompleted ? (
                          <svg className="w-4 h-4 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : isCurrent ? (
                          <LoadingSpinner size="sm" label={label} />
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
                        {label}{isCurrent && '...'}
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
                {t('common:actions.cancel')}
              </button>
              <button
                id="tutorial-submit-listing"
                type="submit"
                disabled={!canSubmit}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-2 btn-base btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <LoadingSpinner size="sm" />
                    {creationStep
                      ? t(`modals:createListing.submittingSteps.${creationStep}`)
                      : t('modals:createListing.creating')}
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
                    {t('modals:createListing.submit')}
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
      title={t('modals:createListing.discardTitle')}
      message={t('modals:createListing.discardMessage')}
      confirmLabel={t('modals:createListing.discardButton')}
      confirmVariant="danger"
    />
    </>
  );
}
