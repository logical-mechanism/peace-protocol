import { formatAda } from './formatAda';

/** Format a lovelace price for display, with fallback for missing/invalid values. */
export function formatPrice(lovelace?: number): string {
  if (lovelace === undefined || lovelace === null || isNaN(lovelace) || lovelace < 0) {
    return 'No suggested price';
  }
  return `${formatAda(lovelace)} ADA`;
}

/** Get the i18n key for a category label (common:categories.{id}). */
export function getCategoryLabelKey(category?: string): string {
  return `categories.${category || 'text'}`;
}

/** Get a display label for a listing category, defaulting to "Text". */
export function getCategoryLabel(category?: string): string {
  if (!category) return 'Text';
  return category.charAt(0).toUpperCase() + category.slice(1);
}
