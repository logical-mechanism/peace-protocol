import { createContext, useContext, useCallback, useState } from 'react';

/**
 * Modal stacking management — tracks open modals in a stack so only the
 * topmost modal handles Escape and receives the correct z-index.
 *
 * Base z-index: 50 (matches existing modals). Each stacked modal gets +2.
 * Media viewer fullscreen overlays at z-[60] remain above all modals.
 */

const BASE_Z = 50;
const Z_STEP = 2;

interface ModalContextValue {
  /** Register a modal as open. */
  openModal: (id: string) => void;
  /** Remove a modal from the stack. */
  closeModal: (id: string) => void;
  /** Whether this modal is the topmost in the stack. */
  isTopModal: (id: string) => boolean;
  /** Whether any modal is currently open. */
  hasOpenModal: boolean;
  /** Get the z-index for a currently open modal (or BASE_Z if not found). */
  getZIndex: (id: string) => number;
}

const ModalContext = createContext<ModalContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<string[]>([]);

  const openModal = useCallback((id: string) => {
    setStack((prev) => {
      const filtered = prev.filter((m) => m !== id);
      return [...filtered, id];
    });
  }, []);

  const closeModal = useCallback((id: string) => {
    setStack((prev) => {
      if (!prev.includes(id)) {
        console.warn('Attempted to close unregistered modal:', id);
        return prev;
      }
      return prev.filter((m) => m !== id);
    });
  }, []);

  const isTopModal = useCallback(
    (id: string): boolean => stack.length > 0 && stack[stack.length - 1] === id,
    [stack],
  );

  const getZIndex = useCallback(
    (id: string): number => {
      const idx = stack.indexOf(id);
      return idx === -1 ? BASE_Z : BASE_Z + idx * Z_STEP;
    },
    [stack],
  );

  const value: ModalContextValue = {
    openModal,
    closeModal,
    isTopModal,
    hasOpenModal: stack.length > 0,
    getZIndex,
  };

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}
