import { useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface InfoTooltipProps {
  /** The tooltip text content */
  text: string;
  /** Popover position relative to the icon (default 'top') */
  position?: 'top' | 'bottom';
  /** Additional className on the wrapper span */
  className?: string;
}

const GAP = 8; // px between button and tooltip
const VIEWPORT_PADDING = 8; // px from viewport edges

export default function InfoTooltip({ text, position = 'top', className = '' }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  const tooltipStyle = useMemo((): React.CSSProperties => {
    if (!isVisible || !buttonRef.current) return {};
    const rect = buttonRef.current.getBoundingClientRect();
    const style: React.CSSProperties = { position: 'fixed' };

    if (position === 'top') {
      style.bottom = window.innerHeight - rect.top + GAP;
    } else {
      style.top = rect.bottom + GAP;
    }

    // Center on button, clamp to viewport
    const centerX = rect.left + rect.width / 2;
    style.left = Math.max(VIEWPORT_PADDING, centerX);
    style.transform = 'translateX(-50%)';

    return style;
  }, [isVisible, position]);

  const arrowStyle = useMemo((): React.CSSProperties => {
    if (!isVisible || !buttonRef.current) return {};
    return { position: 'absolute', left: '50%', transform: 'translateX(-50%)' };
  }, [isVisible]);

  const arrowPositionClasses =
    position === 'top'
      ? 'top-full border-t-[var(--bg-elevated)] border-x-transparent border-b-transparent'
      : 'bottom-full border-b-[var(--bg-elevated)] border-x-transparent border-t-transparent';

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onFocus={show}
        onBlur={hide}
        aria-label="More information"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] focus-visible:text-[var(--accent)] focus-visible:shadow-[var(--focus-ring)] transition-colors duration-[var(--transition-fast)] cursor-help"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16v-4m0-4h.01" />
        </svg>
      </button>

      {isVisible && createPortal(
        <span
          role="tooltip"
          style={tooltipStyle}
          className="fixed z-[9999] w-max max-w-[250px] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] tooltip-enter pointer-events-none"
        >
          {text}
          <span
            style={arrowStyle}
            className={`${arrowPositionClasses} w-0 h-0 border-[5px]`}
            aria-hidden="true"
          />
        </span>,
        document.body
      )}
    </span>
  );
}
