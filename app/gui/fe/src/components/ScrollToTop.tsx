import { useState, useEffect, useCallback, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../contexts/ModalContext';

interface ScrollToTopProps {
  threshold?: number;  // Scroll distance before button appears (default: 300px)
  // Optional scrollable container. When provided, listens to its scroll/scrollTo
  // instead of the window. Useful for inner scroll regions (e.g. virtualized lists)
  // that don't propagate scroll to the page.
  scrollContainer?: RefObject<HTMLElement | null>;
}

export default function ScrollToTop({ threshold = 300, scrollContainer }: ScrollToTopProps) {
  const { t } = useTranslation('common');
  const [isVisible, setIsVisible] = useState(false);
  const { hasOpenModal } = useModal();

  useEffect(() => {
    const target: EventTarget = scrollContainer?.current ?? window;
    const readScroll = () =>
      scrollContainer?.current
        ? scrollContainer.current.scrollTop
        : window.scrollY;

    const handleScroll = () => {
      setIsVisible(readScroll() > threshold);
    };

    target.addEventListener('scroll', handleScroll, { passive: true });

    // Check initial scroll position
    handleScroll();

    return () => target.removeEventListener('scroll', handleScroll);
  }, [threshold, scrollContainer]);

  const scrollToTop = useCallback(() => {
    if (scrollContainer?.current) {
      scrollContainer.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [scrollContainer]);

  if (!isVisible || hasOpenModal) return null;

  return (
    <button
      onClick={scrollToTop}
      className="fixed bottom-6 right-6 z-50 p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-full shadow-[var(--shadow-lg)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] btn-base"
      title={t('ui.scrollToTop')}
      aria-label={t('ui.scrollToTop')}
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 10l7-7m0 0l7 7m-7-7v18"
        />
      </svg>
    </button>
  );
}
