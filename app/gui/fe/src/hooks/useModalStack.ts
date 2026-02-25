import { useEffect } from 'react';
import { useModal } from '../contexts/ModalContext';

/**
 * Registers a modal with the modal stack when open and provides
 * stack-aware Escape key handling. Only the topmost modal closes on Escape.
 *
 * Replaces the manual Escape useEffect in each modal with a single hook call.
 */
export function useModalStack(
  id: string,
  isOpen: boolean,
  onClose: () => void,
  /** If true, Escape is blocked (e.g. while submitting). */
  disabled?: boolean,
) {
  const { openModal, closeModal, isTopModal, getZIndex } = useModal();

  // Register/unregister with the modal stack
  useEffect(() => {
    if (isOpen) {
      openModal(id);
    } else {
      closeModal(id);
    }
    return () => closeModal(id);
  }, [isOpen, id, openModal, closeModal]);

  // Escape key: only close if this is the topmost modal and not disabled
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disabled && isTopModal(id)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, disabled, id, isTopModal, onClose]);

  // Body scroll lock (only lock/unlock based on this modal's own state)
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  return { zIndex: isOpen ? getZIndex(id) : 50 };
}
