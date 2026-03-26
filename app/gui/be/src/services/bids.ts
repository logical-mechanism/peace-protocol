import { getNetworkConfig } from '../config/index.js';
import { apiCache } from './cache.js';
import { getKupoClient } from './kupo.js';
import type { KoiosUtxo } from './koios.js';
import { logger } from './logger.js';
import { parseBidDatum } from './parsers.js';
import type { BidDisplay, BidDatum, ResponseWarnings } from '../types/index.js';
import type { ServiceResult } from './encryptions.js';

function utxoToBidDisplay(utxo: KoiosUtxo, datum: BidDatum): BidDisplay {
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
    futurePrice: datum.new_price,
    lockedUntil: datum.locked_until,
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

/** Fetch all bid UTxOs from Kupo. Price comes from datum, no metadata needed. */
export async function getAllBids(skipCache = false): Promise<ServiceResult<BidDisplay[]>> {
  if (!skipCache) {
    const cached = apiCache.get<BidDisplay[]>(CACHE_KEY_ALL_BIDS);
    if (cached) return { data: cached, warnings: {} };
  }

  try {
    const { contracts } = getNetworkConfig();
    const kupo = getKupoClient();

    const utxos = await kupo.getAddressUtxos(contracts.biddingAddress);

    const bids: BidDisplay[] = [];
    let skippedDatums = 0;
    for (const utxo of utxos) {
      if (!utxo.inline_datum?.value) continue;
      try {
        const datum = parseBidDatum(utxo.inline_datum.value);
        bids.push(utxoToBidDisplay(utxo, datum));
      } catch (err) {
        skippedDatums++;
        logger.warn('Failed to parse bid datum', {
          txHash: utxo.tx_hash,
          txIndex: utxo.tx_index,
          error: String(err),
          datumPreview: JSON.stringify(utxo.inline_datum)?.slice(0, 200),
        });
      }
    }

    apiCache.set(CACHE_KEY_ALL_BIDS, bids, 15_000);
    const warnings: ResponseWarnings = skippedDatums > 0 ? { skippedDatums } : {};
    return { data: bids, warnings };
  } catch (err) {
    // If fetching fails (Kupo down, Koios circuit open), return stale cached data
    const stale = apiCache.getStale<BidDisplay[]>(CACHE_KEY_ALL_BIDS);
    if (stale) {
      logger.warn('Returning stale cache for bids', { error: String(err) });
      return { data: stale, warnings: { stale: true } };
    }
    throw err;
  }
}

/** Find a single bid by its token name, or null if not found. */
export async function getBidByToken(tokenName: string, skipCache = false): Promise<ServiceResult<BidDisplay | null>> {
  const result = await getAllBids(skipCache);
  return {
    data: result.data.find(b => b.tokenName === tokenName) || null,
    warnings: result.warnings,
  };
}

/** Filter bids by bidder payment key hash (case-insensitive substring match). */
export async function getBidsByUser(pkh: string, skipCache = false): Promise<ServiceResult<BidDisplay[]>> {
  const result = await getAllBids(skipCache);
  return {
    data: result.data.filter(b => b.bidderPkh.toLowerCase() === pkh.toLowerCase()),
    warnings: result.warnings,
  };
}

/** Filter bids by the encryption token they target. */
export async function getBidsByEncryption(encryptionToken: string, skipCache = false): Promise<ServiceResult<BidDisplay[]>> {
  const result = await getAllBids(skipCache);
  return {
    data: result.data.filter(b => b.encryptionToken === encryptionToken),
    warnings: result.warnings,
  };
}

/** Filter bids by display status (pending, accepted, rejected, or cancelled). */
export async function getBidsByStatus(
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled',
  skipCache = false,
): Promise<ServiceResult<BidDisplay[]>> {
  const result = await getAllBids(skipCache);
  return {
    data: result.data.filter(b => b.status === status),
    warnings: result.warnings,
  };
}
