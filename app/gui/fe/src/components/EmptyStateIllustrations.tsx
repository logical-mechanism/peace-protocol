/**
 * Larger SVG illustrations for empty states.
 * Themed with CSS variables for consistency with the dark theme.
 */

/** Marketplace: storefront with lock icon */
export function MarketplaceEmptyIllustration() {
  return (
    <svg className="w-20 h-20" viewBox="0 0 80 80" fill="none">
      {/* Storefront base */}
      <rect x="14" y="36" width="52" height="32" rx="3" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" />
      {/* Awning */}
      <path d="M10 36h60l-4-12H14L10 36z" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" />
      <path d="M10 36c0 4 4 7 8 7s8-3 8-7" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.4" />
      <path d="M26 36c0 4 4 7 8 7s8-3 8-7" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.4" />
      <path d="M42 36c0 4 4 7 8 7s8-3 8-7" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.4" />
      <path d="M58 36c0 4 4 7 8 7s4-3 4-7" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.4" />
      {/* Door */}
      <rect x="32" y="50" width="16" height="18" rx="2" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.4" />
      {/* Lock */}
      <rect x="35" y="54" width="10" height="8" rx="2" fill="var(--accent-muted)" stroke="var(--accent)" strokeWidth="1.5" opacity="0.7" />
      <path d="M38 54v-3a2 2 0 014 0v3" stroke="var(--accent)" strokeWidth="1.5" opacity="0.7" />
      <circle cx="40" cy="58" r="1" fill="var(--accent)" opacity="0.7" />
    </svg>
  );
}

/** No search results: magnifying glass with question mark */
export function NoResultsIllustration() {
  return (
    <svg className="w-20 h-20" viewBox="0 0 80 80" fill="none">
      {/* Magnifying glass */}
      <circle cx="34" cy="34" r="18" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" />
      <circle cx="34" cy="34" r="14" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.3" />
      <line x1="48" y1="48" x2="64" y2="64" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      {/* Question mark inside */}
      <path d="M30 29c0-3 2-5 5-5s5 2 5 5c0 2-2 3-4 4v2" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <circle cx="35" cy="41" r="1" fill="var(--accent)" opacity="0.6" />
    </svg>
  );
}

/** No purchases: empty shopping bag */
export function NoPurchasesIllustration() {
  return (
    <svg className="w-20 h-20" viewBox="0 0 80 80" fill="none">
      {/* Bag body */}
      <path d="M18 30h44l-4 38H22L18 30z" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" />
      {/* Handles */}
      <path d="M28 30v-6a12 12 0 0124 0v6" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" strokeLinecap="round" />
      {/* Empty indicator - dashed circle */}
      <circle cx="40" cy="50" r="10" stroke="var(--accent-muted)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.5" />
      {/* Minus sign */}
      <line x1="35" y1="50" x2="45" y2="50" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

/** No sales: empty shelf/tag */
export function NoSalesIllustration() {
  return (
    <svg className="w-20 h-20" viewBox="0 0 80 80" fill="none">
      {/* Price tag */}
      <path d="M20 16l28 0a4 4 0 013 1.2L64 32a4 4 0 010 5.6L50.6 51a4 4 0 01-5.6 0L18 24a4 4 0 01-1.2-3L20 16z" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" />
      {/* Tag hole */}
      <circle cx="30" cy="26" r="3" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.4" />
      {/* Empty shelf lines */}
      <line x1="12" y1="60" x2="68" y2="60" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <line x1="16" y1="66" x2="64" y2="66" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
      {/* Dashed circle for empty */}
      <circle cx="40" cy="42" r="6" stroke="var(--accent-muted)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.5" />
    </svg>
  );
}

/** Empty library: open book */
export function LibraryEmptyIllustration() {
  return (
    <svg className="w-20 h-20" viewBox="0 0 80 80" fill="none">
      {/* Book spine */}
      <path d="M40 18v48" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.4" />
      {/* Left page */}
      <path d="M40 18C36 16 28 14 16 16v44c12-2 20 0 24 2V18z" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" fill="var(--accent-muted)" fillOpacity="0.15" />
      {/* Right page */}
      <path d="M40 18c4-2 12-4 24-2v44c-12-2-20 0-24 2V18z" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" fill="var(--accent-muted)" fillOpacity="0.15" />
      {/* Page lines (left) */}
      <line x1="22" y1="28" x2="36" y2="26" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
      <line x1="22" y1="34" x2="36" y2="32" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
      <line x1="22" y1="40" x2="36" y2="38" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
      {/* Page lines (right) */}
      <line x1="44" y1="26" x2="58" y2="28" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
      <line x1="44" y1="32" x2="58" y2="34" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
      <line x1="44" y1="38" x2="58" y2="40" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
    </svg>
  );
}

/** History: empty clock/inbox */
export function HistoryEmptyIllustration() {
  return (
    <svg className="w-20 h-20" viewBox="0 0 80 80" fill="none">
      {/* Clock face */}
      <circle cx="40" cy="38" r="22" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.5" />
      <circle cx="40" cy="38" r="18" stroke="var(--text-muted)" strokeWidth="1" opacity="0.2" />
      {/* Clock hands */}
      <line x1="40" y1="38" x2="40" y2="24" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <line x1="40" y1="38" x2="50" y2="38" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      {/* Center dot */}
      <circle cx="40" cy="38" r="2" fill="var(--accent-muted)" stroke="var(--accent)" strokeWidth="1" opacity="0.6" />
      {/* Hour markers */}
      <circle cx="40" cy="20" r="1" fill="var(--text-muted)" opacity="0.3" />
      <circle cx="58" cy="38" r="1" fill="var(--text-muted)" opacity="0.3" />
      <circle cx="40" cy="56" r="1" fill="var(--text-muted)" opacity="0.3" />
      <circle cx="22" cy="38" r="1" fill="var(--text-muted)" opacity="0.3" />
      {/* Bottom line */}
      <line x1="20" y1="68" x2="60" y2="68" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
    </svg>
  );
}
