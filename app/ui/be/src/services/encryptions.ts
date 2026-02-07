import { getNetworkConfig } from '../config/index.js';
import { getKoiosClient, type KoiosUtxo } from './koios.js';
import { parseEncryptionDatum } from './parsers.js';
import type { EncryptionDisplay, EncryptionDatum } from '../types/index.js';

interface ParsedCip20 {
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
}

/**
 * Fetch and parse CIP-20 metadata (key 674) from the creation tx.
 * Format: { msg: [description, suggestedPrice, storageLayer] }
 */
async function fetchCip20Metadata(txHash: string): Promise<ParsedCip20> {
  try {
    const koios = getKoiosClient();
    const metadata = await koios.getTxMetadata(txHash);
    const cip20 = metadata.find(m => m.key === '674');
    if (!cip20?.json || typeof cip20.json !== 'object') return {};

    const json = cip20.json as { msg?: string[] };
    if (!Array.isArray(json.msg)) return {};

    const [description, priceStr, storageLayer] = json.msg;
    const suggestedPrice = priceStr ? parseFloat(priceStr) : undefined;

    return {
      description: description || undefined,
      suggestedPrice: suggestedPrice && !isNaN(suggestedPrice) ? suggestedPrice : undefined,
      storageLayer: storageLayer || undefined,
    };
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
  } else if (datum.full_level !== null) {
    status = 'completed';
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
  const koios = getKoiosClient();

  const utxos = await koios.getAddressUtxos(contracts.encryptionAddress);
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
