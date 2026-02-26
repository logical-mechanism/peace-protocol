import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export function requestTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          timeoutMs,
        });
        res.status(504).json({
          error: {
            code: 'GATEWAY_TIMEOUT',
            message: 'Request timed out',
            requestId: req.requestId,
          },
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}
