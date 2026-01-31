import dotenv from 'dotenv';
dotenv.config();

export type Network = 'preprod' | 'mainnet';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  network: (process.env.NETWORK || 'preprod') as Network,
  useStubs: process.env.USE_STUBS === 'true',

  // Koios URLs
  koios: {
    preprod: process.env.KOIOS_URL_PREPROD || 'https://preprod.koios.rest/api/v1',
    mainnet: process.env.KOIOS_URL_MAINNET || 'https://api.koios.rest/api/v1',
  },

  // Blockfrost
  blockfrost: {
    preprod: process.env.BLOCKFROST_PROJECT_ID_PREPROD || '',
    mainnet: process.env.BLOCKFROST_PROJECT_ID_MAINNET || '',
  },

  // Contract addresses (will be populated after preprod deployment)
  contracts: {
    preprod: {
      encryptionAddress: process.env.ENCRYPTION_CONTRACT_ADDRESS_PREPROD || '',
      biddingAddress: process.env.BIDDING_CONTRACT_ADDRESS_PREPROD || '',
      referenceAddress: process.env.REFERENCE_CONTRACT_ADDRESS_PREPROD || '',
      encryptionPolicyId: process.env.ENCRYPTION_POLICY_ID_PREPROD || '',
      biddingPolicyId: process.env.BIDDING_POLICY_ID_PREPROD || '',
      genesisPolicyId: process.env.GENESIS_POLICY_ID_PREPROD || '',
    },
    mainnet: {
      encryptionAddress: process.env.ENCRYPTION_CONTRACT_ADDRESS_MAINNET || '',
      biddingAddress: process.env.BIDDING_CONTRACT_ADDRESS_MAINNET || '',
      referenceAddress: process.env.REFERENCE_CONTRACT_ADDRESS_MAINNET || '',
      encryptionPolicyId: process.env.ENCRYPTION_POLICY_ID_MAINNET || '',
      biddingPolicyId: process.env.BIDDING_POLICY_ID_MAINNET || '',
      genesisPolicyId: process.env.GENESIS_POLICY_ID_MAINNET || '',
    },
  },

  // CORS
  cors: {
    origins: process.env.NODE_ENV === 'production'
      ? ['https://preprod.yoursite.com', 'https://www.yoursite.com']
      : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  },
} as const;

// Helper to get network-specific config
export function getNetworkConfig() {
  const network = config.network;
  return {
    koiosUrl: config.koios[network],
    blockfrostProjectId: config.blockfrost[network],
    contracts: config.contracts[network],
  };
}
