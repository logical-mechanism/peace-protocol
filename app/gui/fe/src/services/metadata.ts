/**
 * CIP-20 metadata utilities.
 *
 * Cardano transaction metadata strings have a 64-byte limit per text field.
 * This module provides utilities to split long strings into compliant chunks
 * and build the structured metadata object.
 */

/**
 * Split a string into chunks where each chunk is at most maxBytes bytes
 * when encoded as UTF-8. Splits on character boundaries (never mid-codepoint).
 *
 * @param str - The input string to split
 * @param maxBytes - Maximum byte length per chunk (default 64)
 * @returns Array of string chunks, each <= maxBytes when UTF-8 encoded
 */
export function splitMetadataString(str: string, maxBytes = 64): string[] {
  if (!str) return [''];

  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(str);

  if (fullBytes.length <= maxBytes) return [str];

  const chunks: string[] = [];
  let offset = 0;

  while (offset < str.length) {
    let lo = 1;
    let hi = str.length - offset;
    let best = 1;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const slice = str.slice(offset, offset + mid);
      const byteLen = encoder.encode(slice).length;

      if (byteLen <= maxBytes) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    chunks.push(str.slice(offset, offset + best));
    offset += best;
  }

  return chunks;
}

/**
 * Build CIP-20 structured metadata object for encryption transactions.
 *
 * Format:
 * {
 *   msg: [...descriptionChunks],  // CIP-20 msg field (description chunks, <=64 bytes each)
 *   p: "10",                       // price
 *   s: "on-chain",                 // storage layer
 *   i: [...imageLinkChunks],       // image link chunks (<=64 bytes each)
 *   c: "text"                      // category
 * }
 */
export function buildEncryptionMetadata(
  description: string,
  price: string,
  storageLayer: string,
  imageLink: string,
  category: string,
): Record<string, unknown> {
  return {
    msg: splitMetadataString(description || ''),
    p: price || '0',
    s: storageLayer || '',
    i: splitMetadataString(imageLink || ''),
    c: category || '',
  };
}

/**
 * Build CIP-20 metadata for bid transactions.
 * Bids only carry the future price which is always a short string.
 */
export function buildBidMetadata(futurePrice: string): Record<string, unknown> {
  return {
    msg: [futurePrice || ''],
  };
}
