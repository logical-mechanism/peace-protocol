import { Router, type Request, type Response } from 'express';
import { config } from '../config/index.js';
import { STUB_BIDS } from '../stubs/index.js';
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

    // TODO: Real Koios query when contracts are deployed
    return res.json({ data: [], meta: { total: 0 } });
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
router.get('/:tokenName', async (req: Request, res: Response) => {
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

    // TODO: Real query when contracts are deployed
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Bid not found' },
    });
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
router.get('/user/:pkh', async (req: Request, res: Response) => {
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

    // TODO: Real query when contracts are deployed
    return res.json({ data: [], meta: { total: 0 } });
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
router.get('/encryption/:encryptionToken', async (req: Request, res: Response) => {
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

    // TODO: Real query when contracts are deployed
    return res.json({ data: [], meta: { total: 0 } });
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
router.get('/status/:status', async (req: Request, res: Response) => {
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

    // TODO: Real query when contracts are deployed
    return res.json({ data: [], meta: { total: 0 } });
  } catch (error) {
    console.error('Error fetching bids by status:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch bids by status' },
    });
  }
});

export default router;
