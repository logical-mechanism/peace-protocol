import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { validateTokenNameParam, validatePkhParam, validateEncryptionTokenParam, validateStatusParam } from '../middleware/validate.js';
import { parsePagination, paginate } from '../middleware/pagination.js';
import { STUB_BIDS } from '../stubs/index.js';
import {
  getAllBids,
  getBidByToken,
  getBidsByUser,
  getBidsByEncryption,
  getBidsByStatus,
} from '../services/bids.js';
import { handleServiceError } from './routeUtils.js';

const router = Router();

const CACHE_DATA = 'max-age=5, stale-while-revalidate=15';

/**
 * GET /api/bids
 * List all bids
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const { data, pagination } = paginate(STUB_BIDS, paginationParams);
      res.set('Cache-Control', CACHE_DATA);
      return res.json({ data, pagination });
    }

    const skipCache = req.query.refresh === 'true';
    const result = await getAllBids(skipCache);
    const { data, pagination } = paginate(result.data, paginationParams);
    res.set('Cache-Control', CACHE_DATA);
    return res.json({
      data,
      pagination,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching bids');
  }
});

/**
 * GET /api/bids/:tokenName
 * Get a specific bid by token name
 */
router.get('/:tokenName', validateTokenNameParam, async (req: Request<{tokenName: string}>, res: Response) => {
  try {
    const { tokenName } = req.params;
    const skipCache = req.query.refresh === 'true';

    if (config.useStubs) {
      const bid = STUB_BIDS.find(b => b.tokenName === tokenName);
      if (!bid) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Bid not found', requestId: req.requestId },
        });
      }
      res.set('Cache-Control', CACHE_DATA);
      return res.json({ data: bid });
    }

    const result = await getBidByToken(tokenName, skipCache);
    if (!result.data) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Bid not found', requestId: req.requestId },
      });
    }
    res.set('Cache-Control', CACHE_DATA);
    return res.json({
      data: result.data,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching bid');
  }
});

/**
 * GET /api/bids/user/:pkh
 * Get bids placed by a specific user (by payment key hash)
 */
router.get('/user/:pkh', validatePkhParam, async (req: Request<{pkh: string}>, res: Response) => {
  try {
    const { pkh } = req.params;
    const skipCache = req.query.refresh === 'true';

    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const userBids = STUB_BIDS.filter(b =>
        b.bidderPkh.toLowerCase() === pkh.toLowerCase()
      );
      const { data, pagination } = paginate(userBids, paginationParams);
      res.set('Cache-Control', CACHE_DATA);
      return res.json({ data, pagination });
    }

    const result = await getBidsByUser(pkh, skipCache);
    const { data, pagination } = paginate(result.data, paginationParams);
    res.set('Cache-Control', CACHE_DATA);
    return res.json({
      data,
      pagination,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching user bids');
  }
});

/**
 * GET /api/bids/encryption/:encryptionToken
 * Get all bids for a specific encryption
 */
router.get('/encryption/:encryptionToken', validateEncryptionTokenParam, async (req: Request<{encryptionToken: string}>, res: Response) => {
  try {
    const { encryptionToken } = req.params;
    const skipCache = req.query.refresh === 'true';

    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const encryptionBids = STUB_BIDS.filter(
        b => b.encryptionToken === encryptionToken
      );
      const { data, pagination } = paginate(encryptionBids, paginationParams);
      res.set('Cache-Control', CACHE_DATA);
      return res.json({ data, pagination });
    }

    const result = await getBidsByEncryption(encryptionToken, skipCache);
    const { data, pagination } = paginate(result.data, paginationParams);
    res.set('Cache-Control', CACHE_DATA);
    return res.json({
      data,
      pagination,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching encryption bids');
  }
});

/**
 * GET /api/bids/status/:status
 * Get bids by status (pending, accepted, rejected, cancelled)
 */
router.get('/status/:status', validateStatusParam(['pending', 'accepted', 'rejected', 'cancelled']), async (req: Request<{status: string}>, res: Response) => {
  try {
    const { status } = req.params;
    const skipCache = req.query.refresh === 'true';

    const paginationParams = parsePagination(req);

    if (config.useStubs) {
      const filteredBids = STUB_BIDS.filter(b => b.status === status);
      const { data, pagination } = paginate(filteredBids, paginationParams);
      res.set('Cache-Control', CACHE_DATA);
      return res.json({ data, pagination });
    }

    const result = await getBidsByStatus(
      status as 'pending' | 'accepted' | 'rejected' | 'cancelled',
      skipCache,
    );
    const { data, pagination } = paginate(result.data, paginationParams);
    res.set('Cache-Control', CACHE_DATA);
    return res.json({
      data,
      pagination,
      ...(Object.keys(result.warnings).length > 0 && { warnings: result.warnings }),
    });
  } catch (error) {
    handleServiceError(error, req, res, 'fetching bids by status');
  }
});

export default router;
