import i18n from 'i18next';

/**
 * Format a date as a relative time string. Output is locale-aware via
 * Intl.RelativeTimeFormat — English narrow renders as "now", "5m ago",
 * "2d ago" matching the prior hardcoded form; other locales get their
 * proper CLDR forms. Past dates only; future dates collapse to "now".
 */
export function formatRelativeTime(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  const locale = i18n.language || 'en';

  // numeric:'auto' yields "now" for the under-a-minute bucket. Above that,
  // numeric:'always' keeps "1m ago" / "1mo ago" / "1y ago" — without it,
  // English collapses -1 month → "last mo." which loses the count.
  if (seconds < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' }).format(0, 'second');
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' });
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(-Math.floor(seconds / 86400), 'day');
  if (seconds < 31536000) return rtf.format(-Math.floor(seconds / 2592000), 'month');
  return rtf.format(-Math.floor(seconds / 31536000), 'year');
}
