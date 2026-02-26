import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { logger } from '../services/logger.js';
import { validateTokenNameParam, validatePkhParam } from '../middleware/validate.js';
import { parsePagination, paginate } from '../middleware/pagination.js';
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
router.get('/', async (req: Request, res: Response) => {
  try {
    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const { data, pagination } = paginate(STUB_ENCRYPTIONS, paginationParams);
      return res.json({ data, meta: { total: STUB_ENCRYPTIONS.length }, pagination });
    }

    const skipCache = req.query.refresh === 'true';
    const result = await getAllEncryptions(skipCache);
    const { data, pagination } = paginate(result.data, paginationParams);
    return res.json({
      data,
      meta: { total: result.data.length },
      pagination,
      ...(result.warnings.skippedDatums && { warnings: result.warnings }),
    });
  } catch (error) {
    logger.error('Error fetching encryptions', { error: String(error), requestId: req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryptions', requestId: req.requestId },
    });
  }
});

/**
 * GET /api/encryptions/:tokenName/levels
 * Get all encryption levels for recursive decryption (queries full tx history).
 * Must be registered BEFORE /:tokenName to avoid being caught by it.
 */
router.get('/:tokenName/levels', validateTokenNameParam, async (req: Request<{tokenName: string}>, res: Response) => {
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
    logger.error('Error fetching encryption levels', { error: String(error), requestId: req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryption levels', requestId: req.requestId },
    });
  }
});

/**
 * GET /api/encryptions/:tokenName
 * Get a specific encryption by token name
 */
router.get('/:tokenName', validateTokenNameParam, async (req: Request<{tokenName: string}>, res: Response) => {
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

    const result = await getEncryptionByToken(tokenName);
    if (!result.data) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Encryption not found' },
      });
    }
    return res.json({
      data: result.data,
      ...(result.warnings.skippedDatums && { warnings: result.warnings }),
    });
  } catch (error) {
    logger.error('Error fetching encryption', { error: String(error), requestId: req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryption', requestId: req.requestId },
    });
  }
});

/**
 * GET /api/encryptions/user/:pkh
 * Get encryptions owned by a specific user (by payment key hash)
 */
router.get('/user/:pkh', validatePkhParam, async (req: Request<{pkh: string}>, res: Response) => {
  try {
    const { pkh } = req.params;

    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const userEncryptions = STUB_ENCRYPTIONS.filter(e =>
        e.sellerPkh.toLowerCase().includes(pkh.toLowerCase())
      );
      const { data, pagination } = paginate(userEncryptions, paginationParams);
      return res.json({ data, meta: { total: userEncryptions.length }, pagination });
    }

    const result = await getEncryptionsByUser(pkh);
    const { data, pagination } = paginate(result.data, paginationParams);
    return res.json({
      data,
      meta: { total: result.data.length },
      pagination,
      ...(result.warnings.skippedDatums && { warnings: result.warnings }),
    });
  } catch (error) {
    logger.error('Error fetching user encryptions', { error: String(error), requestId: req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user encryptions', requestId: req.requestId },
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
        error: { code: 'INVALID_STATUS', message: 'Status must be active, pending, or completed', requestId: req.requestId },
      });
    }

    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const filteredEncryptions = STUB_ENCRYPTIONS.filter(
        e => e.status === status
      );
      const { data, pagination } = paginate(filteredEncryptions, paginationParams);
      return res.json({ data, meta: { total: filteredEncryptions.length }, pagination });
    }

    const result = await getEncryptionsByStatus(
      status as 'active' | 'pending' | 'completed'
    );
    const { data, pagination } = paginate(result.data, paginationParams);
    return res.json({
      data,
      meta: { total: result.data.length },
      pagination,
      ...(result.warnings.skippedDatums && { warnings: result.warnings }),
    });
  } catch (error) {
    logger.error('Error fetching encryptions by status', { error: String(error), requestId: req.requestId });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryptions by status', requestId: req.requestId },
    });
  }
});

export default router;
