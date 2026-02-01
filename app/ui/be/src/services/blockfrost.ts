import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { config, getNetworkConfig } from '../config/index.js';

let blockfrostInstance: BlockFrostAPI | null = null;

export function getBlockfrostClient(): BlockFrostAPI | null {
  if (blockfrostInstance) {
    return blockfrostInstance;
  }

  const { blockfrostProjectId } = getNetworkConfig();

  if (!blockfrostProjectId) {
    console.warn('Blockfrost project ID not configured. Transaction building will not work.');
    return null;
  }

  const network = config.network === 'mainnet' ? 'mainnet' : 'preprod';

  blockfrostInstance = new BlockFrostAPI({
    projectId: blockfrostProjectId,
    network: network,
  });

  return blockfrostInstance;
}

/**
 * Get protocol parameters for transaction building
 */
export async function getProtocolParameters() {
  const client = getBlockfrostClient();
  if (!client) {
    throw new Error('Blockfrost client not configured');
  }

  const latestEpoch = await client.epochsLatest();
  return client.epochsParameters(latestEpoch.epoch);
}

/**
 * Get UTxOs at an address
 */
export async function getAddressUtxos(address: string) {
  const client = getBlockfrostClient();
  if (!client) {
    throw new Error('Blockfrost client not configured');
  }

  return client.addressesUtxos(address);
}

/**
 * Submit a transaction
 */
export async function submitTransaction(txCbor: string): Promise<string> {
  const client = getBlockfrostClient();
  if (!client) {
    throw new Error('Blockfrost client not configured');
  }

  // Convert hex string to buffer if needed
  const txBuffer = Buffer.from(txCbor, 'hex');
  return client.txSubmit(txBuffer);
}

/**
 * Get current slot for validity intervals
 */
export async function getCurrentSlot(): Promise<number> {
  const client = getBlockfrostClient();
  if (!client) {
    throw new Error('Blockfrost client not configured');
  }

  const latestBlock = await client.blocksLatest();
  return latestBlock.slot || 0;
}
