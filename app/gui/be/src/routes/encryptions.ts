import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { logger } from '../services/logger.js';
import { validateTokenNameParam, validatePkhParam, validateStatusParam } from '../middleware/validate.js';
import { parsePagination, paginate } from '../middleware/pagination.js';
import { STUB_ENCRYPTIONS } from '../stubs/index.js';
import {
  getAllEncryptions,
  getEncryptionByToken,
  getEncryptionsByUser,
  getEncryptionsByStatus,
  getEncryptionLevels,
} from '../services/encryptions.js';
import { KupoUnavailableError } from '../services/kupo.js';
import { handleServiceError } from './routeUtils.js';
import { CACHE_HEADER_DATA } from '../config/cacheConstants.js';
import type { EncryptionLevel } from '../types/index.js';

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
      res.set('Cache-Control', CACHE_HEADER_DATA);
      return res.json({ data, pagination });
    }

    const skipCache = req.query.refresh === 'true';
    const result = await getAllEncryptions(skipCache);
    const { data, pagination } = paginate(result.data, paginationParams);
    res.set('Cache-Control', CACHE_HEADER_DATA);
    return res.json({
      data,
      pagination,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching encryptions');
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
    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      // Stub: return empty levels (stub decryption doesn't use real levels)
      const { data, pagination } = paginate([] as EncryptionLevel[], paginationParams);
      res.set('Cache-Control', CACHE_HEADER_DATA);
      return res.json({ data, pagination });
    }

    const levels = await getEncryptionLevels(tokenName);
    const { data, pagination } = paginate(levels, paginationParams);
    res.set('Cache-Control', CACHE_HEADER_DATA);
    return res.json({ data, pagination });
  } catch (error) {
    if (error instanceof KupoUnavailableError) {
      handleServiceError(error, req, res, 'fetching encryption levels');
      return;
    }
    // Levels endpoint includes extra diagnostic detail for debugging
    logger.error('Error fetching encryption levels', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
      tokenName: req.params.tokenName,
      requestId: req.requestId,
    });
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch encryption levels',
        detail: error instanceof Error ? error.message : String(error),
        requestId: req.requestId,
      },
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
          error: { code: 'NOT_FOUND', message: 'Encryption not found', requestId: req.requestId },
        });
      }
      res.set('Cache-Control', CACHE_HEADER_DATA);
      return res.json({ data: encryption });
    }

    const result = await getEncryptionByToken(tokenName);
    if (!result.data) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Encryption not found', requestId: req.requestId },
      });
    }
    res.set('Cache-Control', CACHE_HEADER_DATA);
    return res.json({
      data: result.data,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching encryption');
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
        e.sellerPkh.toLowerCase() === pkh.toLowerCase()
      );
      const { data, pagination } = paginate(userEncryptions, paginationParams);
      res.set('Cache-Control', CACHE_HEADER_DATA);
      return res.json({ data, pagination });
    }

    const result = await getEncryptionsByUser(pkh);
    const { data, pagination } = paginate(result.data, paginationParams);
    res.set('Cache-Control', CACHE_HEADER_DATA);
    return res.json({
      data,
      pagination,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching user encryptions');
  }
});

/**
 * GET /api/encryptions/status/:status
 * Get encryptions by status (active, pending, completed)
 */
router.get('/status/:status', validateStatusParam(['active', 'pending', 'completed']), async (req: Request<{status: string}>, res: Response) => {
  try {
    const { status } = req.params;

    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const filteredEncryptions = STUB_ENCRYPTIONS.filter(
        e => e.status === status
      );
      const { data, pagination } = paginate(filteredEncryptions, paginationParams);
      res.set('Cache-Control', CACHE_HEADER_DATA);
      return res.json({ data, pagination });
    }

    const result = await getEncryptionsByStatus(
      status as 'active' | 'pending' | 'completed'
    );
    const { data, pagination } = paginate(result.data, paginationParams);
    res.set('Cache-Control', CACHE_HEADER_DATA);
    return res.json({
      data,
      pagination,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching encryptions by status');
  }
});

export default router;
