import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { STUB_ENCRYPTIONS } from '../stubs/index.js';
import type { ApiResponse, EncryptionDisplay } from '../types/index.js';

const router = Router();

/**
 * GET /api/encryptions
 * List all encryptions
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    if (config.useStubs) {
      const response: ApiResponse<EncryptionDisplay[]> = {
        data: STUB_ENCRYPTIONS,
        meta: { total: STUB_ENCRYPTIONS.length },
      };
      return res.json(response);
    }

    // TODO: Real Koios query when contracts are deployed
    // const { contracts } = getNetworkConfig();
    // const utxos = await getKoiosClient().getAddressUtxos(contracts.encryptionAddress);
    // const encryptions = parseEncryptionUtxos(utxos);

    return res.json({ data: [], meta: { total: 0 } });
  } catch (error) {
    console.error('Error fetching encryptions:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryptions' },
    });
  }
});

/**
 * GET /api/encryptions/:tokenName
 * Get a specific encryption by token name
 */
router.get('/:tokenName', async (req: Request, res: Response) => {
  try {
    const { tokenName } = req.params;

    if (config.useStubs) {
      const encryption = STUB_ENCRYPTIONS.find(e => e.tokenName === tokenName);
      if (!encryption) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Encryption not found' },
        });
      }
      return res.json({ data: encryption });
    }

    // TODO: Real query when contracts are deployed
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Encryption not found' },
    });
  } catch (error) {
    console.error('Error fetching encryption:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryption' },
    });
  }
});

/**
 * GET /api/encryptions/user/:pkh
 * Get encryptions owned by a specific user (by payment key hash)
 */
router.get('/user/:pkh', async (req: Request, res: Response) => {
  try {
    const { pkh } = req.params;

    if (config.useStubs) {
      const userEncryptions = STUB_ENCRYPTIONS.filter(e =>
        e.sellerPkh.toLowerCase().includes(pkh.toLowerCase())
      );
      const response: ApiResponse<EncryptionDisplay[]> = {
        data: userEncryptions,
        meta: { total: userEncryptions.length },
      };
      return res.json(response);
    }

    // TODO: Real query when contracts are deployed
    return res.json({ data: [], meta: { total: 0 } });
  } catch (error) {
    console.error('Error fetching user encryptions:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user encryptions' },
    });
  }
});

/**
 * GET /api/encryptions/status/:status
 * Get encryptions by status (active, pending, completed)
 */
router.get('/status/:status', async (req: Request, res: Response) => {
  try {
    const { status } = req.params;

    if (!['active', 'pending', 'completed'].includes(status)) {
      return res.status(400).json({
        error: { code: 'INVALID_STATUS', message: 'Status must be active, pending, or completed' },
      });
    }

    if (config.useStubs) {
      const filteredEncryptions = STUB_ENCRYPTIONS.filter(
        e => e.status === status
      );
      const response: ApiResponse<EncryptionDisplay[]> = {
        data: filteredEncryptions,
        meta: { total: filteredEncryptions.length },
      };
      return res.json(response);
    }

    // TODO: Real query when contracts are deployed
    return res.json({ data: [], meta: { total: 0 } });
  } catch (error) {
    console.error('Error fetching encryptions by status:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryptions by status' },
    });
  }
});

export default router;
