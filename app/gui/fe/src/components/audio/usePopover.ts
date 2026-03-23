import { useEffect } from 'react';

/**
 * Closes a popover on click-outside or Escape key.
 * Uses setTimeout(0) to defer listener attachment so the opening click/right-click
 * doesn't immediately trigger the close handler.
 */
export function usePopover(isOpen: boolean, close: () => void): void {
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const id = setTimeout(() => {
      if (!mounted) return;
      document.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      mounted = false;
      clearTimeout(id);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close]);
}
