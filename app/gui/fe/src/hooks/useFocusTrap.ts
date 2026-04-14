import { useEffect, useRef, type RefObject } from 'react';

// Exclude tabindex="-1" on every element type so a button/link/input opted
// out of the Tab cycle (e.g. a mouse-convenience close X whose keyboard
// equivalent is Escape) is also skipped by the initial-focus fallback.
const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface UseFocusTrapOptions {
  /**
   * Element to focus when the trap activates. Falls back to the first
   * focusable child of the container.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * False when this trap is open but a deeper modal has stacked on top.
   * The stacked modal should own keyboard focus, so we skip both the
   * auto-focus and the Tab interception until we are topmost again.
   * Defaults to true for non-stacked callers.
   */
  isTopmost?: boolean;
}

/**
 * Traps keyboard focus within a container element while active.
 *
 * - Saves the previously focused element on activation
 * - Moves focus to `initialFocusRef` if provided, otherwise the first focusable child
 * - Wraps Tab / Shift+Tab at container boundaries
 * - Restores focus to the saved element on deactivation
 *
 * Stacked modals must pass `isTopmost` so a parent trap releases keyboard
 * focus to the topmost child trap.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  initialFocusRefOrOptions?: RefObject<HTMLElement | null> | UseFocusTrapOptions,
) {
  // Back-compat: legacy callers pass a bare RefObject as the third arg.
  const options: UseFocusTrapOptions =
    initialFocusRefOrOptions && 'current' in initialFocusRefOrOptions
      ? { initialFocusRef: initialFocusRefOrOptions }
      : (initialFocusRefOrOptions ?? {});
  const { initialFocusRef, isTopmost = true } = options;

  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save previous focus on activation, restore on deactivation. Auto-focus
  // only fires while this trap is the topmost one — otherwise a stacked
  // child would be stomped on by its parent.
  useEffect(() => {
    if (isActive && isTopmost) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;

      // Focus the requested initial element (or fall back to first focusable)
      // after the render completes. Two requestAnimationFrame ticks are used
      // so the focus call lands AFTER any sibling component (e.g. Suspense
      // children re-rendering on lazy-load) has settled and stopped fighting
      // for focus.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          const container = containerRef.current;
          if (!container) return;
          const target =
            initialFocusRef?.current ??
            container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          target?.focus();
        });
      });

      return () => {
        cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
      };
    } else if (!isActive && previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isActive, isTopmost, containerRef, initialFocusRef]);

  // Tab key trapping. Only the topmost trap intercepts Tab so a parent
  // modal cannot wrap focus while a child confirm dialog is open on top.
  useEffect(() => {
    if (!isActive || !isTopmost) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, isTopmost, containerRef]);
}
