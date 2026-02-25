import { Router } from 'express';
import { getKoiosClient } from '../services/koios.js';
import { logger } from '../services/logger.js';
import { validateTxHashParam } from '../middleware/validate.js';

const router = Router();

/**
 * GET /confirmations/:txHash
 *
 * Returns the number of block confirmations for a transaction.
 * Used by the frontend to decide when it's safe to securely delete
 * spent cryptographic secrets (seller a/r, hop a0/r0/hk).
 *
 * Returns { confirmations: 0 } if the tx is not yet in a block.
 */
router.get('/confirmations/:txHash', validateTxHashParam, async (req, res) => {
  try {
    const txHash = req.params.txHash as string;
    const koios = getKoiosClient();

    const [txInfo, tip] = await Promise.all([
      koios.getTxInfo(txHash).catch(() => null),
      koios.getTip(),
    ]);

    if (!txInfo) {
      return res.json({ data: { confirmations: 0 } });
    }

    const blockHeight = txInfo.block_height;
    if (typeof blockHeight !== 'number') {
      return res.json({ data: { confirmations: 0 } });
    }

    const confirmations = Math.max(0, tip.block_no - blockHeight);
    return res.json({ data: { confirmations } });
  } catch (error) {
    logger.error('Failed to get confirmations', { error: String(error) });
    return res.json({ data: { confirmations: 0 } });
  }
});

export default router;
