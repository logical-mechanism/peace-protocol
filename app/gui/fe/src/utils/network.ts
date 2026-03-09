/**
 * Network utilities for determining Cardano network and generating explorer URLs.
 */

export type CardanoNetwork = 'preprod' | 'mainnet';

/**
 * Determines the current Cardano network based on subdomain.
 * - preprod.* → preprod
 * - www.* or no subdomain → mainnet
 *
 * Defaults to preprod for local development.
 */
export function getCurrentNetwork(): CardanoNetwork {
  if (typeof window === 'undefined') {
    return 'preprod';
  }

  const hostname = window.location.hostname;

  // Local development always uses preprod
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'preprod';
  }

  // Check subdomain
  if (hostname.startsWith('preprod.')) {
    return 'preprod';
  }

  return 'mainnet';
}

/**
 * Gets the CardanoScan base URL for the current network.
 */
export function getCardanoScanBaseUrl(): string {
  const network = getCurrentNetwork();
  return network === 'preprod'
    ? 'https://preprod.cardanoscan.io'
    : 'https://cardanoscan.io';
}

/**
 * Generates a CardanoScan URL for a transaction.
 */
export function getTransactionUrl(txHash: string): string {
  return `${getCardanoScanBaseUrl()}/transaction/${txHash}`;
}

/**
 * Generates a CardanoScan URL for an address.
 */
export function getAddressUrl(address: string): string {
  return `${getCardanoScanBaseUrl()}/address/${address}`;
}

/**
 * Generates a CardanoScan URL for a token/asset.
 */
export function getTokenUrl(policyId: string, assetName?: string): string {
  const assetId = assetName ? `${policyId}${assetName}` : policyId;
  return `${getCardanoScanBaseUrl()}/token/${assetId}`;
}

/**
 * Checks if a string looks like a valid transaction hash.
 */
export function isValidTxHash(hash: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(hash);
}
