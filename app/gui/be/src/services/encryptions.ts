import { getNetworkConfig } from '../config/index.js';
import { apiCache } from './cache.js';
import { getKupoClient } from './kupo.js';
import { getKoiosClient, type KoiosUtxo } from './koios.js';
import { logger } from './logger.js';
import { parseEncryptionDatum, parseHalfEncryptionLevel, parseOptionalFullLevel } from './parsers.js';
import { MetadataDiskCache } from './metadataDiskCache.js';
import type { EncryptionDisplay, EncryptionDatum, EncryptionLevel, ResponseWarnings } from '../types/index.js';

export interface ServiceResult<T> {
  data: T;
  warnings: ResponseWarnings;
}

export interface ParsedCip20 {
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  imageLink?: string;
  category?: string;
}

/**
 * Disk-backed cache: tx_hash → parsed CIP-20 metadata.
 * Metadata is immutable (never changes after tx creation), so entries
 * never need to be re-fetched. Persisted to disk so the cache survives
 * Express process restarts, avoiding expensive Koios re-fetches.
 */
const metadataCache = new MetadataDiskCache<ParsedCip20>('metadata_cache.json');

/** Clear the persistent metadata cache (for testing only). */
export function clearMetadataCache(): void {
  metadataCache.clear();
}

/**
 * Parse CIP-20 metadata into structured fields.
 *
 * Supports two formats:
 * - New (structured): { msg: [...descChunks], p: "price", s: "storage", i: [...urlChunks], c: "category" }
 * - Old (flat array):  { msg: [description, suggestedPrice, storageLayer, imageLink, category] }
 *
 * Detection: if the object has a `p` key, it's the new format.
 */
export function parseCip20Fields(msg: string[], fullJson?: Record<string, unknown>): ParsedCip20 {
  // New structured format: detect by presence of `p` key
  if (fullJson && 'p' in fullJson) {
    const descChunks = Array.isArray(fullJson.msg) ? (fullJson.msg as string[]) : [];
    const description = descChunks.join('') || undefined;

    const priceStr = typeof fullJson.p === 'string' ? fullJson.p : '';
    const suggestedPrice = priceStr ? parseFloat(priceStr) : undefined;

    const storageLayer = (typeof fullJson.s === 'string' ? fullJson.s : '') || undefined;

    const imageChunks = Array.isArray(fullJson.i) ? (fullJson.i as string[]) : [];
    const imageLink = imageChunks.join('') || undefined;

    const category = (typeof fullJson.c === 'string' ? fullJson.c : '') || undefined;

    return {
      description,
      suggestedPrice: suggestedPrice !== undefined && !isNaN(suggestedPrice) ? suggestedPrice : undefined,
      storageLayer,
      imageLink,
      category,
    };
  }

  // Old flat-array format (backward compatibility)
  const [description, priceStr, storageLayer, imageLink, category] = msg;
  const suggestedPrice = priceStr ? parseFloat(priceStr) : undefined;

  return {
    description: description || undefined,
    suggestedPrice: suggestedPrice !== undefined && !isNaN(suggestedPrice) ? suggestedPrice : undefined,
    storageLayer: storageLayer || undefined,
    imageLink: imageLink || undefined,
    category: category || undefined,
  };
}

/** Extract CIP-20 fields from pre-fetched metadata entries. */
export function extractCip20FromMetadata(entries: Array<{ key: string; json: unknown }>): ParsedCip20 {
  const cip20 = entries.find(m => m.key === '674');
  if (!cip20?.json || typeof cip20.json !== 'object') return {};

  const json = cip20.json as Record<string, unknown>;
  const msgArray = Array.isArray(json.msg) ? (json.msg as string[]) : [];

  return parseCip20Fields(msgArray, json);
}

function utxoToEncryptionDisplay(utxo: KoiosUtxo, datum: EncryptionDatum, cip20: ParsedCip20): EncryptionDisplay {
  // Map on-chain status to display status
  let status: EncryptionDisplay['status'];
  if (datum.status.type === 'Pending') {
    status = 'pending';
  } else {
    status = 'active';
  }

  // Find the encryption token in the asset list
  const { contracts } = getNetworkConfig();
  const encAsset = utxo.asset_list?.find(
    a => a.policy_id === contracts.encryptionPolicyId
  );
  const tokenName = encAsset?.asset_name || datum.token;

  return {
    tokenName,
    seller: utxo.address,
    sellerPkh: datum.owner_vkh,
    status,
    description: cip20.description,
    suggestedPrice: cip20.suggestedPrice,
    storageLayer: cip20.storageLayer,
    imageLink: cip20.imageLink,
    category: cip20.category,
    createdAt: utxo.block_time > 0 ? new Date(utxo.block_time * 1000).toISOString() : null,
    utxo: {
      txHash: utxo.tx_hash,
      outputIndex: utxo.tx_index,
    },
    datum,
  };
}

const CACHE_KEY_ALL_ENCRYPTIONS = 'all_encryptions';

/** Fetch all encryption UTxOs from Kupo and enrich with CIP-20 metadata (batch). */
export async function getAllEncryptions(skipCache = false): Promise<ServiceResult<EncryptionDisplay[]>> {
  if (!skipCache) {
    const cached = apiCache.get<EncryptionDisplay[]>(CACHE_KEY_ALL_ENCRYPTIONS);
    if (cached) return { data: cached, warnings: {} };
  }

  try {
    const { contracts } = getNetworkConfig();
    const kupo = getKupoClient();
    const koios = getKoiosClient();

    const utxos = await kupo.getAddressUtxos(contracts.encryptionAddress);

    // Phase 1: Parse datums, collecting tx hashes for batch metadata fetch
    const parsed: Array<{ utxo: KoiosUtxo; datum: EncryptionDatum }> = [];
    let skippedDatums = 0;
    for (const utxo of utxos) {
      if (!utxo.inline_datum?.value) continue;
      try {
        const datum = parseEncryptionDatum(utxo.inline_datum.value);
        parsed.push({ utxo, datum });
      } catch (err) {
        skippedDatums++;
        logger.warn('Failed to parse encryption datum', {
          txHash: utxo.tx_hash,
          txIndex: utxo.tx_index,
          error: String(err),
          datumPreview: JSON.stringify(utxo.inline_datum)?.slice(0, 200),
        });
      }
    }

    // Phase 2: Fetch CIP-20 metadata — only for tx_hashes not already in the persistent cache
    const allTxHashes = [...new Set(parsed.map(p => p.utxo.tx_hash))];
    const uncachedHashes = allTxHashes.filter(h => !metadataCache.has(h));

    if (uncachedHashes.length > 0) {
      try {
        const metadataMap = await koios.getTxMetadataBatch(uncachedHashes);
        const missingHashes = uncachedHashes.filter(h => !metadataMap.has(h));
        if (missingHashes.length > 0) {
          logger.warn('Missing metadata for tx hashes in batch fetch', {
            missing: missingHashes,
            count: missingHashes.length,
            requested: uncachedHashes.length,
          });
        }
        for (const hash of uncachedHashes) {
          const cip20 = extractCip20FromMetadata(metadataMap.get(hash) || []);
          metadataCache.set(hash, cip20);
        }
      } catch (err) {
        logger.warn('Failed to batch fetch CIP-20 metadata; using cached data for known tx hashes', {
          error: String(err),
          uncachedCount: uncachedHashes.length,
          cachedCount: allTxHashes.length - uncachedHashes.length,
        });
      }
    }

    // Phase 3: Assemble results (read from persistent cache)
    const encryptions: EncryptionDisplay[] = [];
    for (const { utxo, datum } of parsed) {
      const cip20 = metadataCache.get(utxo.tx_hash) || {};
      encryptions.push(utxoToEncryptionDisplay(utxo, datum, cip20));
    }

    apiCache.set(CACHE_KEY_ALL_ENCRYPTIONS, encryptions, 15_000);
    const warnings: ResponseWarnings = skippedDatums > 0 ? { skippedDatums } : {};
    return { data: encryptions, warnings };
  } catch (err) {
    // If fetching fails (Kupo down, Koios circuit open), return stale cached data
    const stale = apiCache.getStale<EncryptionDisplay[]>(CACHE_KEY_ALL_ENCRYPTIONS);
    if (stale) {
      logger.warn('Returning stale cache for encryptions', { error: String(err) });
      return { data: stale, warnings: { stale: true } };
    }
    throw err;
  }
}

/** Find a single encryption by its token name, or null if not found. */
export async function getEncryptionByToken(tokenName: string): Promise<ServiceResult<EncryptionDisplay | null>> {
  const result = await getAllEncryptions();
  return {
    data: result.data.find(e => e.tokenName === tokenName) || null,
    warnings: result.warnings,
  };
}

/** Filter encryptions by seller payment key hash (case-insensitive substring match). */
export async function getEncryptionsByUser(pkh: string): Promise<ServiceResult<EncryptionDisplay[]>> {
  const result = await getAllEncryptions();
  return {
    data: result.data.filter(e => e.sellerPkh.toLowerCase().includes(pkh.toLowerCase())),
    warnings: result.warnings,
  };
}

/** Filter encryptions by display status (active, pending, or completed). */
export async function getEncryptionsByStatus(
  status: 'active' | 'pending' | 'completed'
): Promise<ServiceResult<EncryptionDisplay[]>> {
  const result = await getAllEncryptions();
  return {
    data: result.data.filter(e => e.status === status),
    warnings: result.warnings,
  };
}

/**
 * Get all encryption levels for a token by querying its full transaction history.
 *
 * This implements the same logic as commands/08_decryptMessage.sh:
 * 1. Get all tx hashes for the encryption token (asset_txs with _history=true)
 * 2. Get tx_info for those hashes to access inline datums
 * 3. Sort by block_height descending (newest first)
 * 4. From newest tx: extract half_level + full_level (if Some)
 * 5. From older txs: extract full_level (if Some)
 * 6. Return ordered array for recursive decryption
 */
export async function getEncryptionLevels(tokenName: string): Promise<EncryptionLevel[]> {
  const { contracts } = getNetworkConfig();
  const koios = getKoiosClient();

  // Step 1: Get all transaction hashes for this encryption token.
  // Primary: asset_txs (efficient, token-specific).
  // Fallback: address_txs (all txs at encryption address — filtered by token in step 4).
  let assetTxs: Array<{ tx_hash: string; block_height: number }>;
  let usedFallback = false;
  try {
    assetTxs = await koios.getAssetTxs(contracts.encryptionPolicyId, tokenName);
  } catch (err) {
    logger.warn('asset_txs failed, falling back to address_txs', { error: String(err), tokenName });
    usedFallback = true;
    assetTxs = await koios.getAddressTxs(contracts.encryptionAddress);
  }
  logger.info('getEncryptionLevels: fetched tx hashes', {
    tokenName,
    usedFallback,
    txCount: assetTxs.length,
  });
  if (assetTxs.length === 0) {
    throw new Error(`No transactions found for encryption token ${tokenName}`);
  }

  const txHashes = assetTxs.map(tx => tx.tx_hash);

  // Step 2: Get transaction info with inline datums
  const txInfos = await koios.getTxInfoBatch(txHashes);
  logger.info('getEncryptionLevels: fetched tx info batch', {
    tokenName,
    requestedCount: txHashes.length,
    returnedCount: txInfos.length,
    txs: txInfos.map(tx => ({
      hash: tx.tx_hash.slice(0, 16) + '...',
      blockHeight: tx.block_height,
      blockIndex: tx.tx_block_index,
    })),
  });

  // Step 3: Sort by block_height descending (newest first).
  // Use tx_block_index as tiebreaker for chained txs in the same block
  // (e.g., acceptBidAndReEncrypt chains 12e→12f in one block).
  txInfos.sort((a, b) => {
    const heightDiff = b.block_height - a.block_height;
    if (heightDiff !== 0) return heightDiff;
    return (b.tx_block_index ?? 0) - (a.tx_block_index ?? 0);
  });

  // Step 4-5: Extract levels from inline datums at the encryption contract address
  const levels: EncryptionLevel[] = [];
  let isNewest = true; // Track first matching tx (not just i===0, since address_txs fallback includes other tokens)
  const skipped = { noEncOutput: 0, noInlineDatum: 0, tooFewFields: 0, wrongToken: 0 };

  for (let i = 0; i < txInfos.length; i++) {
    const tx = txInfos[i];

    // Find the output at the encryption contract address
    const encOutput = tx.outputs?.find(
      o => o.payment_addr?.bech32 === contracts.encryptionAddress
    );
    if (!encOutput) {
      skipped.noEncOutput++;
      continue;
    }
    if (!encOutput.inline_datum?.value) {
      skipped.noInlineDatum++;
      continue;
    }

    // The datum is a Plutus constructor: fields[3] = half_level, fields[4] = full_level
    const datumValue = encOutput.inline_datum.value as { constructor: number; fields: unknown[] };
    logger.debug('Parsing datum for tx', {
      txHash: tx.tx_hash,
      fieldCount: datumValue.fields?.length,
      constructor: datumValue.constructor,
      blockHeight: tx.block_height,
    });
    if (!datumValue.fields || datumValue.fields.length < 5) {
      skipped.tooFewFields++;
      continue;
    }

    // Verify this datum is for the requested token (essential for address_txs fallback,
    // which returns all txs at the address, not just for this token)
    const datumToken = (datumValue.fields[2] as { bytes?: string })?.bytes;
    if (datumToken !== tokenName) {
      skipped.wrongToken++;
      continue;
    }

    if (isNewest) {
      // Newest tx: extract half_level (fields[3])
      try {
        const halfLevel = parseHalfEncryptionLevel(datumValue.fields[3] as never);
        levels.push({
          r1: halfLevel.r1b,
          r2_g1: halfLevel.r2_g1b,
        });
      } catch (err) {
        logger.warn('Failed to parse half_level', {
          txHash: tx.tx_hash,
          error: String(err),
          field3: JSON.stringify(datumValue.fields[3]).slice(0, 200),
        });
      }
      isNewest = false;
    }

    // All txs (including newest): extract full_level if Some (fields[4])
    // Deduplicate: UseSnark preserves the existing full_level unchanged,
    // so consecutive txs can carry the same full_level — skip duplicates.
    try {
      const fullLevel = parseOptionalFullLevel(datumValue.fields[4] as never);
      if (fullLevel) {
        const prev = levels[levels.length - 1];
        const isDuplicate = prev &&
          prev.r1 === fullLevel.r1b &&
          prev.r2_g1 === fullLevel.r2_g1b &&
          prev.r2_g2 === fullLevel.r2_g2b;
        if (!isDuplicate) {
          levels.push({
            r1: fullLevel.r1b,
            r2_g1: fullLevel.r2_g1b,
            r2_g2: fullLevel.r2_g2b,
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to parse full_level', {
        txHash: tx.tx_hash,
        error: String(err),
        field4: JSON.stringify(datumValue.fields[4]).slice(0, 200),
      });
    }
  }

  logger.info('getEncryptionLevels: completed', {
    tokenName,
    levelsFound: levels.length,
    txsProcessed: txInfos.length,
    skipped,
    levels: levels.map((l, i) => ({
      index: i,
      r1: l.r1?.slice(0, 16) + '...',
      r2_g1: l.r2_g1?.slice(0, 16) + '...',
      r2_g2: l.r2_g2 ? l.r2_g2.slice(0, 16) + '...' : undefined,
      hasR2G2: !!l.r2_g2,
    })),
  });

  return levels;
}
