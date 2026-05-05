import i18n from 'i18next';

// Reads from the i18next singleton so number grouping/decimal style follows
// the user's selected app language. Falls back to `undefined` (the runtime
// default) when i18next hasn't been initialized — keeps unit tests stable.
function activeLocale(): string | undefined {
  return i18n.language || undefined;
}

/**
 * Format a lovelace amount (number) as ADA with 2–6 decimal places.
 * Always shows at least 2 decimals for visual consistency (e.g., 2_000_000 → "2.00").
 */
export function formatAda(lovelace: number): string {
  const ada = lovelace / 1_000_000;
  return ada.toLocaleString(activeLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/**
 * Format a lovelace string (from wallet balance) as ADA with exactly 2 decimal places.
 * Returns '...' for undefined/empty values (loading state).
 */
export function formatAdaDisplay(lovelaceAmount: string | undefined): string {
  if (!lovelaceAmount) return '...';
  const ada = parseInt(lovelaceAmount) / 1_000_000;
  return ada.toLocaleString(activeLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
