import { Router, type Request, type Response } from 'express';
import { config, getNetworkConfig } from '../config/index.js';
import { logger } from '../services/logger.js';
import { STUB_PROTOCOL_CONFIG } from '../stubs/index.js';
import { getKoiosClient } from '../services/koios.js';
import type { ProtocolConfig } from '../types/index.js';
import { CACHE_HEADER_CONFIG, CACHE_HEADER_STATIC } from '../config/cacheConstants.js';

const router = Router();

/**
 * GET /api/protocol/config
 * Get protocol configuration (contract addresses, policy IDs, etc.)
 */
router.get('/config', async (_req: Request, res: Response) => {
  try {
    if (config.useStubs) {
      res.set('Cache-Control', CACHE_HEADER_CONFIG);
      return res.json({ data: STUB_PROTOCOL_CONFIG });
    }

    const { contracts } = getNetworkConfig();

    // Reference script UTxOs from env config (set during deployment)
    const referenceScripts: ProtocolConfig['referenceScripts'] = {
      encryption: contracts.encryptionRefTxHash
        ? { txHash: contracts.encryptionRefTxHash, outputIndex: contracts.encryptionRefOutputIndex }
        : null,
      bidding: contracts.biddingRefTxHash
        ? { txHash: contracts.biddingRefTxHash, outputIndex: contracts.biddingRefOutputIndex }
        : null,
      groth: contracts.grothRefTxHash
        ? { txHash: contracts.grothRefTxHash, outputIndex: contracts.grothRefOutputIndex }
        : null,
    };

    const protocolConfig: ProtocolConfig = {
      network: config.network,
      contracts: {
        encryptionAddress: contracts.encryptionAddress,
        biddingAddress: contracts.biddingAddress,
        referenceAddress: contracts.referenceAddress,
        encryptionPolicyId: contracts.encryptionPolicyId,
        biddingPolicyId: contracts.biddingPolicyId,
        grothPolicyId: contracts.grothPolicyId,
      },
      referenceScripts,
      genesisToken: contracts.genesisPolicyId
        ? {
            policyId: contracts.genesisPolicyId,
            tokenName: contracts.genesisTokenName,
          }
        : null,
    };

    res.set('Cache-Control', CACHE_HEADER_CONFIG);
    return res.json({ data: protocolConfig });
  } catch (error) {
    logger.error('Error fetching protocol config', { error: String(error), requestId: _req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch protocol config', requestId: _req.requestId },
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
      res.set('Cache-Control', CACHE_HEADER_STATIC);
      return res.json({
        data: STUB_PROTOCOL_CONFIG.referenceScripts,
      });
    }

    const { contracts } = getNetworkConfig();

    const referenceScripts: ProtocolConfig['referenceScripts'] = {
      encryption: contracts.encryptionRefTxHash
        ? { txHash: contracts.encryptionRefTxHash, outputIndex: contracts.encryptionRefOutputIndex }
        : null,
      bidding: contracts.biddingRefTxHash
        ? { txHash: contracts.biddingRefTxHash, outputIndex: contracts.biddingRefOutputIndex }
        : null,
      groth: contracts.grothRefTxHash
        ? { txHash: contracts.grothRefTxHash, outputIndex: contracts.grothRefOutputIndex }
        : null,
    };

    res.set('Cache-Control', CACHE_HEADER_STATIC);
    return res.json({ data: referenceScripts });
  } catch (error) {
    logger.error('Error fetching reference data', { error: String(error), requestId: _req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reference data', requestId: _req.requestId },
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
      res.set('Cache-Control', CACHE_HEADER_STATIC);
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
    res.set('Cache-Control', CACHE_HEADER_STATIC);
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
    logger.error('Error fetching scripts', { error: String(error), requestId: _req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch scripts', requestId: _req.requestId },
    });
  }
});

/**
 * GET /api/protocol/params
 * Get current protocol parameters (for transaction building)
 */
router.get('/params', async (_req: Request, res: Response) => {
  try {
    if (config.useStubs) {
      res.set('Cache-Control', CACHE_HEADER_STATIC);
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

    const koios = getKoiosClient();
    const params = await koios.getProtocolParams();
    res.set('Cache-Control', CACHE_HEADER_STATIC);
    return res.json({ data: params });
  } catch (error) {
    logger.error('Error fetching protocol params', { error: String(error), requestId: _req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch protocol params', requestId: _req.requestId },
    });
  }
});

export default router;
