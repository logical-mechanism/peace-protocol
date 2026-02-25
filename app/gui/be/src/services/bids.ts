import { getNetworkConfig } from '../config/index.js';
import { apiCache } from './cache.js';
import { getKupoClient } from './kupo.js';
import { getKoiosClient, type KoiosUtxo } from './koios.js';
import { logger } from './logger.js';
import { parseBidDatum } from './parsers.js';
import type { BidDisplay, BidDatum } from '../types/index.js';

export interface ParsedBidCip20 {
  futurePrice?: number;
}

/**
 * Parse bid CIP-20 msg array into structured metadata fields.
 * Format: [futurePrice]
 */
export function parseBidCip20Fields(msg: string[]): ParsedBidCip20 {
  if (msg.length < 1) return {};

  const futurePriceStr = msg[0];
  const futurePrice = futurePriceStr ? parseFloat(futurePriceStr) : undefined;

  return {
    futurePrice: futurePrice !== undefined && !isNaN(futurePrice) ? futurePrice : undefined,
  };
}

/** Extract bid CIP-20 fields from pre-fetched metadata entries. */
export function extractBidCip20FromMetadata(entries: Array<{ key: string; json: unknown }>): ParsedBidCip20 {
  const cip20 = entries.find(m => m.key === '674');
  if (!cip20?.json || typeof cip20.json !== 'object') return {};

  const json = cip20.json as { msg?: string[] };
  if (!Array.isArray(json.msg) || json.msg.length < 1) return {};

  return parseBidCip20Fields(json.msg);
}

function utxoToBidDisplay(utxo: KoiosUtxo, datum: BidDatum, cip20: ParsedBidCip20): BidDisplay {
  // Find the bid token in the asset list
  const { contracts } = getNetworkConfig();
  const bidAsset = utxo.asset_list?.find(
    a => a.policy_id === contracts.biddingPolicyId
  );
  // datum.pointer = bid's own token name (validated on-chain: pointer == token_name)
  // datum.token   = encryption token name being bid on
  const tokenName = bidAsset?.asset_name || datum.pointer;

  // Bid amount is the total lovelace locked in the UTxO
  const amount = parseInt(utxo.value, 10);

  // All on-chain bid UTxOs are pending — accepted bids have their tokens burned
  const status: BidDisplay['status'] = 'pending';

  return {
    tokenName,
    bidder: utxo.address,
    bidderPkh: datum.owner_vkh,
    encryptionToken: datum.token,
    amount,
    futurePrice: cip20.futurePrice,
    status,
    createdAt: new Date(utxo.block_time * 1000).toISOString(),
    utxo: {
      txHash: utxo.tx_hash,
      outputIndex: utxo.tx_index,
    },
    datum,
  };
}

const CACHE_KEY_ALL_BIDS = 'all_bids';

/** Fetch all bid UTxOs from Kupo and enrich with CIP-20 metadata (batch). */
export async function getAllBids(skipCache = false): Promise<BidDisplay[]> {
  if (!skipCache) {
    const cached = apiCache.get<BidDisplay[]>(CACHE_KEY_ALL_BIDS);
    if (cached) return cached;
  }
  const { contracts } = getNetworkConfig();
  const kupo = getKupoClient();
  const koios = getKoiosClient();

  const utxos = await kupo.getAddressUtxos(contracts.biddingAddress);

  // Phase 1: Parse datums, collecting tx hashes for batch metadata fetch
  const parsed: Array<{ utxo: KoiosUtxo; datum: BidDatum }> = [];
  for (const utxo of utxos) {
    if (!utxo.inline_datum?.value) continue;
    try {
      const datum = parseBidDatum(utxo.inline_datum.value);
      parsed.push({ utxo, datum });
    } catch (err) {
      logger.warn('Failed to parse bid datum', { txHash: utxo.tx_hash, txIndex: utxo.tx_index, error: String(err) });
    }
  }

  // Phase 2: Batch fetch all CIP-20 metadata in a single request
  const txHashes = [...new Set(parsed.map(p => p.utxo.tx_hash))];
  let metadataMap = new Map<string, Array<{ key: string; json: unknown }>>();
  try {
    metadataMap = await koios.getTxMetadataBatch(txHashes);
  } catch (err) {
    logger.warn('Failed to batch fetch bid CIP-20 metadata', { error: String(err) });
  }

  // Phase 3: Assemble results
  const bids: BidDisplay[] = [];
  for (const { utxo, datum } of parsed) {
    const cip20 = extractBidCip20FromMetadata(metadataMap.get(utxo.tx_hash) || []);
    bids.push(utxoToBidDisplay(utxo, datum, cip20));
  }

  apiCache.set(CACHE_KEY_ALL_BIDS, bids);
  return bids;
}

/** Find a single bid by its token name, or null if not found. */
export async function getBidByToken(tokenName: string): Promise<BidDisplay | null> {
  const bids = await getAllBids();
  return bids.find(b => b.tokenName === tokenName) || null;
}

/** Filter bids by bidder payment key hash (case-insensitive substring match). */
export async function getBidsByUser(pkh: string): Promise<BidDisplay[]> {
  const bids = await getAllBids();
  return bids.filter(b =>
    b.bidderPkh.toLowerCase().includes(pkh.toLowerCase())
  );
}

/** Filter bids by the encryption token they target. */
export async function getBidsByEncryption(encryptionToken: string): Promise<BidDisplay[]> {
  const bids = await getAllBids();
  return bids.filter(b => b.encryptionToken === encryptionToken);
}

/** Filter bids by display status (pending, accepted, rejected, or cancelled). */
export async function getBidsByStatus(
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
): Promise<BidDisplay[]> {
  const bids = await getAllBids();
  return bids.filter(b => b.status === status);
}
