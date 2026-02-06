import { Router, type Request, type Response } from 'express';
import { config, getNetworkConfig } from '../config/index.js';
import { STUB_PROTOCOL_CONFIG } from '../stubs/index.js';
import type { ProtocolConfig } from '../types/index.js';

const router = Router();

/**
 * GET /api/protocol/config
 * Get protocol configuration (contract addresses, policy IDs, etc.)
 */
router.get('/config', async (_req: Request, res: Response) => {
  try {
    if (config.useStubs) {
      return res.json({ data: STUB_PROTOCOL_CONFIG });
    }

    const { contracts } = getNetworkConfig();

    const protocolConfig: ProtocolConfig = {
      network: config.network,
      contracts: {
        encryptionAddress: contracts.encryptionAddress,
        biddingAddress: contracts.biddingAddress,
        encryptionPolicyId: contracts.encryptionPolicyId,
        biddingPolicyId: contracts.biddingPolicyId,
      },
      referenceScripts: {
        // These would come from environment or be queried
        encryption: null,
        bidding: null,
        groth: null,
      },
      genesisToken: contracts.genesisPolicyId
        ? {
            policyId: contracts.genesisPolicyId,
            tokenName: '', // Would be configured
          }
        : null,
    };

    return res.json({ data: protocolConfig });
  } catch (error) {
    console.error('Error fetching protocol config:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch protocol config' },
    });
  }
});

/**
 * GET /api/protocol/reference
 * Get reference UTxO data (for transaction building)
 */
router.get('/reference', async (_req: Request, res: Response) => {
  try {
    if (config.useStubs) {
      return res.json({
        data: STUB_PROTOCOL_CONFIG.referenceScripts,
      });
    }

    // TODO: Query reference UTxOs when contracts are deployed
    return res.json({
      data: {
        encryption: null,
        bidding: null,
        groth: null,
      },
    });
  } catch (error) {
    console.error('Error fetching reference data:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reference data' },
    });
  }
});

/**
 * GET /api/protocol/scripts
 * Get script hashes and addresses
 */
router.get('/scripts', async (_req: Request, res: Response) => {
  try {
    if (config.useStubs) {
      return res.json({
        data: {
          encryption: {
            address: STUB_PROTOCOL_CONFIG.contracts.encryptionAddress,
            policyId: STUB_PROTOCOL_CONFIG.contracts.encryptionPolicyId,
          },
          bidding: {
            address: STUB_PROTOCOL_CONFIG.contracts.biddingAddress,
            policyId: STUB_PROTOCOL_CONFIG.contracts.biddingPolicyId,
          },
        },
      });
    }

    const { contracts } = getNetworkConfig();
    return res.json({
      data: {
        encryption: {
          address: contracts.encryptionAddress,
          policyId: contracts.encryptionPolicyId,
        },
        bidding: {
          address: contracts.biddingAddress,
          policyId: contracts.biddingPolicyId,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching scripts:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch scripts' },
    });
  }
});

/**
 * GET /api/protocol/params
 * Get current protocol parameters (for transaction building)
 */
router.get('/params', async (_req: Request, res: Response) => {
  try {
    // Protocol params are network-dependent but don't require contracts
    // This could work even without deployed contracts

    if (config.useStubs) {
      // Return minimal stub params for development
      return res.json({
        data: {
          minFeeA: 44,
          minFeeB: 155381,
          maxTxSize: 16384,
          maxValSize: 5000,
          keyDeposit: '2000000',
          poolDeposit: '500000000',
          coinsPerUtxoByte: '4310',
          collateralPercentage: 150,
          maxCollateralInputs: 3,
        },
      });
    }

    // TODO: Fetch real protocol params from Koios or Blockfrost
    // const params = await getKoiosClient().getProtocolParams();
    return res.json({ data: null });
  } catch (error) {
    console.error('Error fetching protocol params:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch protocol params' },
    });
  }
});

export default router;
