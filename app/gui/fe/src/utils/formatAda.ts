/**
 * Format a lovelace amount (number) as ADA with up to 6 decimal places.
 * Trailing zeros are omitted (e.g., 1_500_000 → "1.5", 2_000_000 → "2").
 */
export function formatAda(lovelace: number): string {
  const ada = lovelace / 1_000_000;
  return ada.toLocaleString(undefined, {
    minimumFractionDigits: 0,
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
  return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
