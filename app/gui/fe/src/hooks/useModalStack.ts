import { useEffect, useState } from 'react';
import { useModal } from '../contexts/ModalContext';

export type ModalAnimationState = 'entering' | 'entered' | 'exiting';

/**
 * Registers a modal with the modal stack when open and provides
 * stack-aware Escape key handling. Only the topmost modal closes on Escape.
 *
 * Also manages enter/exit animation state:
 * - `shouldRender`: true while modal is visible or animating out
 * - `animationState`: 'entering' → 'entered' → 'exiting'
 */
export function useModalStack(
  id: string,
  isOpen: boolean,
  onClose: () => void,
  /** If true, Escape is blocked (e.g. while submitting). */
  disabled?: boolean,
) {
  const { openModal, closeModal, isTopModal, getZIndex } = useModal();
  const [exitAnimating, setExitAnimating] = useState(false);
  const [animationState, setAnimationState] = useState<ModalAnimationState>('entering');
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  // Adjust state during render when isOpen prop changes
  // (React-recommended pattern for deriving state from props)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setAnimationState('entering');
    } else {
      setExitAnimating(true);
      setAnimationState('exiting');
    }
  }

  // shouldRender derived: immediately true when isOpen, stays true during exit animation
  const shouldRender = isOpen || exitAnimating;

  // Entering → entered transition timer
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => setAnimationState('entered'), 200);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Exit animation cleanup timer
  useEffect(() => {
    if (!exitAnimating) return;
    const timer = setTimeout(() => setExitAnimating(false), 150);
    return () => clearTimeout(timer);
  }, [exitAnimating]);

  // Register/unregister with the modal stack
  useEffect(() => {
    if (isOpen) {
      openModal(id);
    }
    // Cleanup captures the current `isOpen` value from this render.
    // When isOpen was true and changes to false, cleanup removes the modal.
    // When isOpen was false, cleanup is a no-op (modal wasn't registered).
    return () => {
      if (isOpen) {
        closeModal(id);
      }
    };
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

  // Body scroll lock is managed centrally by ModalContext (based on stack size)
  // to avoid race conditions when multiple modals are open.

  return { zIndex: isOpen ? getZIndex(id) : 50, shouldRender, animationState };
}
