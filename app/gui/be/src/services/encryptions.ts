import { getNetworkConfig } from '../config/index.js';
import { getKupoClient } from './kupo.js';
import { getKoiosClient, type KoiosUtxo } from './koios.js';
import { parseEncryptionDatum, parseHalfEncryptionLevel, parseOptionalFullLevel } from './parsers.js';
import type { EncryptionDisplay, EncryptionDatum, EncryptionLevel } from '../types/index.js';

export interface ParsedCip20 {
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  imageLink?: string;
  category?: string;
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

/**
 * Fetch and parse CIP-20 metadata (key 674) from the creation tx.
 * Supports both old flat-array format and new structured format.
 */
async function fetchCip20Metadata(txHash: string): Promise<ParsedCip20> {
  try {
    const koios = getKoiosClient();
    const metadata = await koios.getTxMetadata(txHash);
    const cip20 = metadata.find(m => m.key === '674');
    if (!cip20?.json || typeof cip20.json !== 'object') return {};

    const json = cip20.json as Record<string, unknown>;
    const msgArray = Array.isArray(json.msg) ? (json.msg as string[]) : [];

    return parseCip20Fields(msgArray, json);
  } catch (err) {
    console.warn(`Failed to fetch CIP-20 metadata for ${txHash}:`, err);
    return {};
  }
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
    createdAt: new Date(utxo.block_time * 1000).toISOString(),
    utxo: {
      txHash: utxo.tx_hash,
      outputIndex: utxo.tx_index,
    },
    datum,
  };
}

export async function getAllEncryptions(): Promise<EncryptionDisplay[]> {
  const { contracts } = getNetworkConfig();
  const kupo = getKupoClient();

  const utxos = await kupo.getAddressUtxos(contracts.encryptionAddress);
  const encryptions: EncryptionDisplay[] = [];

  for (const utxo of utxos) {
    if (!utxo.inline_datum?.value) continue;

    try {
      const datum = parseEncryptionDatum(utxo.inline_datum.value);
      const cip20 = await fetchCip20Metadata(utxo.tx_hash);
      encryptions.push(utxoToEncryptionDisplay(utxo, datum, cip20));
    } catch (err) {
      console.warn(`Failed to parse encryption datum at ${utxo.tx_hash}#${utxo.tx_index}:`, err);
    }
  }

  return encryptions;
}

export async function getEncryptionByToken(tokenName: string): Promise<EncryptionDisplay | null> {
  const encryptions = await getAllEncryptions();
  return encryptions.find(e => e.tokenName === tokenName) || null;
}

export async function getEncryptionsByUser(pkh: string): Promise<EncryptionDisplay[]> {
  const encryptions = await getAllEncryptions();
  return encryptions.filter(e =>
    e.sellerPkh.toLowerCase().includes(pkh.toLowerCase())
  );
}

export async function getEncryptionsByStatus(
  status: 'active' | 'pending' | 'completed'
): Promise<EncryptionDisplay[]> {
  const encryptions = await getAllEncryptions();
  return encryptions.filter(e => e.status === status);
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

  // Step 1: Get all transaction hashes for this encryption token
  const assetTxs = await koios.getAssetTxs(contracts.encryptionPolicyId, tokenName);
  if (assetTxs.length === 0) {
    throw new Error(`No transactions found for encryption token ${tokenName}`);
  }

  const txHashes = assetTxs.map(tx => tx.tx_hash);

  // Step 2: Get transaction info with inline datums
  const txInfos = await koios.getTxInfoBatch(txHashes);

  // Step 3: Sort by block_height descending (newest first)
  txInfos.sort((a, b) => b.block_height - a.block_height);

  // Step 4-5: Extract levels from inline datums at the encryption contract address
  const levels: EncryptionLevel[] = [];

  for (let i = 0; i < txInfos.length; i++) {
    const tx = txInfos[i];

    // Find the output at the encryption contract address
    const encOutput = tx.outputs?.find(
      o => o.payment_addr?.bech32 === contracts.encryptionAddress
    );
    if (!encOutput) {
      continue;
    }
    if (!encOutput.inline_datum?.value) {
      continue;
    }

    // The datum is a Plutus constructor: fields[3] = half_level, fields[4] = full_level
    const datumValue = encOutput.inline_datum.value as { constructor: number; fields: unknown[] };
    if (!datumValue.fields || datumValue.fields.length < 5) continue;

    if (i === 0) {
      // Newest tx: extract half_level (fields[3])
      try {
        const halfLevel = parseHalfEncryptionLevel(datumValue.fields[3] as never);
        levels.push({
          r1: halfLevel.r1b,
          r2_g1: halfLevel.r2_g1b,
        });
      } catch (err) {
        console.warn(`Failed to parse half_level from tx ${tx.tx_hash}:`, err);
      }
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
      console.warn(`Failed to parse full_level from tx ${tx.tx_hash}:`, err);
    }
  }

  return levels;
}
