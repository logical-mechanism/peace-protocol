import { getNetworkConfig } from '../config/index.js';
import { getKupoClient } from './kupo.js';
import { getKoiosClient, type KoiosUtxo } from './koios.js';
import { parseBidDatum } from './parsers.js';
import type { BidDisplay, BidDatum } from '../types/index.js';

interface ParsedBidCip20 {
  futurePrice?: number;
}

/**
 * Fetch and parse CIP-20 metadata (key 674) from the bid tx.
 * Format: { msg: [futurePrice] }
 * The bid only carries the bidder's desired re-listing price.
 * Description and storageLayer come from the seller's encryption UTxO.
 */
async function fetchBidCip20Metadata(txHash: string): Promise<ParsedBidCip20> {
  try {
    const koios = getKoiosClient();
    const metadata = await koios.getTxMetadata(txHash);
    const cip20 = metadata.find(m => m.key === '674');
    if (!cip20?.json || typeof cip20.json !== 'object') return {};

    const json = cip20.json as { msg?: string[] };
    if (!Array.isArray(json.msg) || json.msg.length < 1) return {};

    const futurePriceStr = json.msg[0];
    const futurePrice = futurePriceStr ? parseFloat(futurePriceStr) : undefined;

    return {
      futurePrice: futurePrice && !isNaN(futurePrice) ? futurePrice : undefined,
    };
  } catch (err) {
    console.warn(`Failed to fetch CIP-20 metadata for bid ${txHash}:`, err);
    return {};
  }
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

export async function getAllBids(): Promise<BidDisplay[]> {
  const { contracts } = getNetworkConfig();
  const kupo = getKupoClient();

  const utxos = await kupo.getAddressUtxos(contracts.biddingAddress);
  const bids: BidDisplay[] = [];

  for (const utxo of utxos) {
    if (!utxo.inline_datum?.value) continue;

    try {
      const datum = parseBidDatum(utxo.inline_datum.value);
      const cip20 = await fetchBidCip20Metadata(utxo.tx_hash);
      bids.push(utxoToBidDisplay(utxo, datum, cip20));
    } catch (err) {
      console.warn(`Failed to parse bid datum at ${utxo.tx_hash}#${utxo.tx_index}:`, err);
    }
  }

  return bids;
}

export async function getBidByToken(tokenName: string): Promise<BidDisplay | null> {
  const bids = await getAllBids();
  return bids.find(b => b.tokenName === tokenName) || null;
}

export async function getBidsByUser(pkh: string): Promise<BidDisplay[]> {
  const bids = await getAllBids();
  return bids.filter(b =>
    b.bidderPkh.toLowerCase().includes(pkh.toLowerCase())
  );
}

export async function getBidsByEncryption(encryptionToken: string): Promise<BidDisplay[]> {
  const bids = await getAllBids();
  return bids.filter(b => b.encryptionToken === encryptionToken);
}

export async function getBidsByStatus(
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
): Promise<BidDisplay[]> {
  const bids = await getAllBids();
  return bids.filter(b => b.status === status);
}
