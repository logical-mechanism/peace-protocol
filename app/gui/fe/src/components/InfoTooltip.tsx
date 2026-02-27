import { useState, useRef, useCallback } from 'react';

interface InfoTooltipProps {
  /** The tooltip text content */
  text: string;
  /** Popover position relative to the icon (default 'top') */
  position?: 'top' | 'bottom';
  /** Additional className on the wrapper span */
  className?: string;
}

export default function InfoTooltip({ text, position = 'top', className = '' }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setIsVisible(true);
  }, []);

  const hide = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => setIsVisible(false), 100);
  }, []);

  const toggle = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  const positionClasses =
    position === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : 'top-full left-1/2 -translate-x-1/2 mt-2';

  const arrowClasses =
    position === 'top'
      ? 'top-full left-1/2 -translate-x-1/2 border-t-[var(--bg-elevated)] border-x-transparent border-b-transparent'
      : 'bottom-full left-1/2 -translate-x-1/2 border-b-[var(--bg-elevated)] border-x-transparent border-t-transparent';

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        onClick={toggle}
        onFocus={show}
        onBlur={hide}
        aria-label="More information"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] focus-visible:text-[var(--accent)] transition-colors duration-[var(--transition-fast)] cursor-help"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16v-4m0-4h.01" />
        </svg>
      </button>

      {isVisible && (
        <span
          role="tooltip"
          className={`absolute ${positionClasses} z-50 w-max max-w-[250px] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] tooltip-enter pointer-events-none`}
        >
          {text}
          <span
            className={`absolute ${arrowClasses} w-0 h-0 border-[5px]`}
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}
