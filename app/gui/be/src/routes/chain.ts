import { Router } from 'express';
import { getKoiosClient } from '../services/koios.js';

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
router.get('/confirmations/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params;

    if (!txHash || txHash.length !== 64) {
      return res.status(400).json({
        error: { code: 'INVALID_TX_HASH', message: 'Transaction hash must be 64 hex characters' },
      });
    }

    const koios = getKoiosClient();

    const [txInfo, tip] = await Promise.all([
      koios.getTxInfo(txHash).catch(() => null),
      koios.getTip(),
    ]);

    if (!txInfo) {
      return res.json({ data: { confirmations: 0 } });
    }

    const blockHeight = (txInfo as Record<string, unknown>).block_height;
    if (typeof blockHeight !== 'number') {
      return res.json({ data: { confirmations: 0 } });
    }

    const confirmations = Math.max(0, tip.block_no - blockHeight);
    return res.json({ data: { confirmations } });
  } catch (error) {
    console.error('Failed to get confirmations:', error);
    return res.json({ data: { confirmations: 0 } });
  }
});

export default router;
