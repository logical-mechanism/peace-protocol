import { formatAda } from './formatAda';

/** Format a lovelace price for display, with fallback for missing/invalid values. */
export function formatPrice(lovelace?: number): string {
  if (lovelace === undefined || lovelace === null || isNaN(lovelace) || lovelace < 0) {
    return 'No suggested price';
  }
  return `${formatAda(lovelace)} ADA`;
}

/** Get a display label for a listing category, defaulting to "Text". */
export function getCategoryLabel(category?: string): string {
  if (!category) return 'Text';
  return category.charAt(0).toUpperCase() + category.slice(1);
}
