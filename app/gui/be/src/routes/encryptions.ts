import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { STUB_ENCRYPTIONS } from '../stubs/index.js';
import {
  getAllEncryptions,
  getEncryptionByToken,
  getEncryptionsByUser,
  getEncryptionsByStatus,
  getEncryptionLevels,
} from '../services/encryptions.js';
import type { ApiResponse, EncryptionDisplay, EncryptionLevel } from '../types/index.js';

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

    const encryptions = await getAllEncryptions();
    return res.json({
      data: encryptions,
      meta: { total: encryptions.length },
    });
  } catch (error) {
    console.error('Error fetching encryptions:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryptions' },
    });
  }
});

/**
 * GET /api/encryptions/:tokenName/levels
 * Get all encryption levels for recursive decryption (queries full tx history).
 * Must be registered BEFORE /:tokenName to avoid being caught by it.
 */
router.get('/:tokenName/levels', async (req: Request<{tokenName: string}>, res: Response) => {
  try {
    const { tokenName } = req.params;

    if (config.useStubs) {
      // Stub: return empty levels (stub decryption doesn't use real levels)
      const response: ApiResponse<EncryptionLevel[]> = {
        data: [],
        meta: { total: 0 },
      };
      return res.json(response);
    }

    const levels = await getEncryptionLevels(tokenName);
    const response: ApiResponse<EncryptionLevel[]> = {
      data: levels,
      meta: { total: levels.length },
    };
    return res.json(response);
  } catch (error) {
    console.error('Error fetching encryption levels:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryption levels' },
    });
  }
});

/**
 * GET /api/encryptions/:tokenName
 * Get a specific encryption by token name
 */
router.get('/:tokenName', async (req: Request<{tokenName: string}>, res: Response) => {
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

    const encryption = await getEncryptionByToken(tokenName);
    if (!encryption) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Encryption not found' },
      });
    }
    return res.json({ data: encryption });
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
router.get('/user/:pkh', async (req: Request<{pkh: string}>, res: Response) => {
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

    const userEncryptions = await getEncryptionsByUser(pkh);
    return res.json({
      data: userEncryptions,
      meta: { total: userEncryptions.length },
    });
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
router.get('/status/:status', async (req: Request<{status: string}>, res: Response) => {
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

    const filteredEncryptions = await getEncryptionsByStatus(
      status as 'active' | 'pending' | 'completed'
    );
    return res.json({
      data: filteredEncryptions,
      meta: { total: filteredEncryptions.length },
    });
  } catch (error) {
    console.error('Error fetching encryptions by status:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryptions by status' },
    });
  }
});

export default router;
