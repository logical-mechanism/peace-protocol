import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { STUB_BIDS } from '../stubs/index.js';
import {
  getAllBids,
  getBidByToken,
  getBidsByUser,
  getBidsByEncryption,
  getBidsByStatus,
} from '../services/bids.js';
import type { ApiResponse, BidDisplay } from '../types/index.js';

const router = Router();

/**
 * GET /api/bids
 * List all bids
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    if (config.useStubs) {
      const response: ApiResponse<BidDisplay[]> = {
        data: STUB_BIDS,
        meta: { total: STUB_BIDS.length },
      };
      return res.json(response);
    }

    const bids = await getAllBids();
    return res.json({
      data: bids,
      meta: { total: bids.length },
    });
  } catch (error) {
    console.error('Error fetching bids:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch bids' },
    });
  }
});

/**
 * GET /api/bids/:tokenName
 * Get a specific bid by token name
 */
router.get('/:tokenName', async (req: Request<{tokenName: string}>, res: Response) => {
  try {
    const { tokenName } = req.params;

    if (config.useStubs) {
      const bid = STUB_BIDS.find(b => b.tokenName === tokenName);
      if (!bid) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Bid not found' },
        });
      }
      return res.json({ data: bid });
    }

    const bid = await getBidByToken(tokenName);
    if (!bid) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Bid not found' },
      });
    }
    return res.json({ data: bid });
  } catch (error) {
    console.error('Error fetching bid:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch bid' },
    });
  }
});

/**
 * GET /api/bids/user/:pkh
 * Get bids placed by a specific user (by payment key hash)
 */
router.get('/user/:pkh', async (req: Request<{pkh: string}>, res: Response) => {
  try {
    const { pkh } = req.params;

    if (config.useStubs) {
      const userBids = STUB_BIDS.filter(b =>
        b.bidderPkh.toLowerCase().includes(pkh.toLowerCase())
      );
      const response: ApiResponse<BidDisplay[]> = {
        data: userBids,
        meta: { total: userBids.length },
      };
      return res.json(response);
    }

    const userBids = await getBidsByUser(pkh);
    return res.json({
      data: userBids,
      meta: { total: userBids.length },
    });
  } catch (error) {
    console.error('Error fetching user bids:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user bids' },
    });
  }
});

/**
 * GET /api/bids/encryption/:encryptionToken
 * Get all bids for a specific encryption
 */
router.get('/encryption/:encryptionToken', async (req: Request<{encryptionToken: string}>, res: Response) => {
  try {
    const { encryptionToken } = req.params;

    if (config.useStubs) {
      const encryptionBids = STUB_BIDS.filter(
        b => b.encryptionToken === encryptionToken
      );
      const response: ApiResponse<BidDisplay[]> = {
        data: encryptionBids,
        meta: { total: encryptionBids.length },
      };
      return res.json(response);
    }

    const encryptionBids = await getBidsByEncryption(encryptionToken);
    return res.json({
      data: encryptionBids,
      meta: { total: encryptionBids.length },
    });
  } catch (error) {
    console.error('Error fetching encryption bids:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch encryption bids' },
    });
  }
});

/**
 * GET /api/bids/status/:status
 * Get bids by status (pending, accepted, rejected, cancelled)
 */
router.get('/status/:status', async (req: Request<{status: string}>, res: Response) => {
  try {
    const { status } = req.params;

    if (!['pending', 'accepted', 'rejected', 'cancelled'].includes(status)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be pending, accepted, rejected, or cancelled',
        },
      });
    }

    if (config.useStubs) {
      const filteredBids = STUB_BIDS.filter(b => b.status === status);
      const response: ApiResponse<BidDisplay[]> = {
        data: filteredBids,
        meta: { total: filteredBids.length },
      };
      return res.json(response);
    }

    const filteredBids = await getBidsByStatus(
      status as 'pending' | 'accepted' | 'rejected' | 'cancelled'
    );
    return res.json({
      data: filteredBids,
      meta: { total: filteredBids.length },
    });
  } catch (error) {
    console.error('Error fetching bids by status:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch bids by status' },
    });
  }
});

export default router;
