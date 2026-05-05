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

/**
 * Format a numeric input string with thousands separators on the integer part,
 * preserving the user's decimal portion verbatim (so trailing zeros and a bare
 * trailing dot survive). Returns the input unchanged if the integer part isn't
 * a finite number — keeps partial input like ".5" usable while typing.
 *
 * Always uses en-US grouping so the parsed display round-trips with parseFloat,
 * which only understands period-decimals + ASCII digits regardless of locale.
 */
export function formatWithCommas(raw: string): string {
  if (!raw) return '';
  const dotIdx = raw.indexOf('.');
  const intPart = dotIdx === -1 ? raw : raw.slice(0, dotIdx);
  const decPart = dotIdx === -1 ? undefined : raw.slice(dotIdx + 1);
  const intNum = parseInt(intPart, 10);
  if (isNaN(intNum)) return raw;
  const formatted = intNum.toLocaleString('en-US');
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
}

/**
 * Strip thousands-separator commas from a formatted numeric string so it can be
 * passed to parseFloat / parseInt. Inverse of {@link formatWithCommas}.
 */
export function stripCommas(formatted: string): string {
  return formatted.replace(/,/g, '');
}
