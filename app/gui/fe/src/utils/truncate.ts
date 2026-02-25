/**
 * Shared truncation utilities for hex strings (token names, addresses, tx hashes).
 *
 * Presets preserve the existing per-context truncation lengths:
 * - Cards show shorter strings (space constrained)
 * - Modals show longer strings (more room)
 */

export type TruncatePreset =
  | 'token-card'    // 8 + 4 chars
  | 'token-modal'   // 12 + 6 chars
  | 'token-detail'  // 12 + 8 chars
  | 'address-card'  // 10 + 6 chars
  | 'address-modal' // 12 + 8 chars
  | 'seller'        // 8 + 4 chars
  | 'seller-modal'  // 10 + 6 chars
  | 'tx-hash';      // 8 + 8 chars

const PRESETS: Record<TruncatePreset, [start: number, end: number]> = {
  'token-card':    [8, 4],
  'token-modal':   [12, 6],
  'token-detail':  [12, 8],
  'address-card':  [10, 6],
  'address-modal': [12, 8],
  'seller':        [8, 4],
  'seller-modal':  [10, 6],
  'tx-hash':       [8, 8],
};

/**
 * Truncate a hex string with "..." in the middle.
 * Returns the original string if it's short enough.
 */
export function truncateHex(value: string, start: number, end: number): string {
  if (!value) return '';
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

/**
 * Truncate using a named preset.
 */
export function truncateWithPreset(value: string, preset: TruncatePreset): string {
  const [start, end] = PRESETS[preset];
  return truncateHex(value, start, end);
}
