import { getNetworkConfig } from '../config/index.js';
import { getKupoClient } from './kupo.js';
import type { KoiosUtxo } from './koios.js';
import { parseBidDatum } from './parsers.js';
import type { BidDisplay, BidDatum } from '../types/index.js';

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
      bids.push(utxoToBidDisplay(utxo, datum));
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
