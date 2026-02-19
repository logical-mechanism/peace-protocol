import { Router } from 'express';
import encryptionsRouter from './encryptions.js';
import bidsRouter from './bids.js';
import protocolRouter from './protocol.js';
import chainRouter from './chain.js';

const router = Router();

router.use('/encryptions', encryptionsRouter);
router.use('/bids', bidsRouter);
router.use('/protocol', protocolRouter);
router.use('/chain', chainRouter);

export default router;
