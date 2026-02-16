import { Router } from 'express';
import encryptionsRouter from './encryptions.js';
import bidsRouter from './bids.js';
import protocolRouter from './protocol.js';

const router = Router();

router.use('/encryptions', encryptionsRouter);
router.use('/bids', bidsRouter);
router.use('/protocol', protocolRouter);

export default router;
