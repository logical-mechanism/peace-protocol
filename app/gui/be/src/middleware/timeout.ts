import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.js';

const DEFAULT_TIMEOUT_MS = 30_000;

// Routes that involve multiple sequential Koios round-trips (asset_txs
// per-token + credential_txs + chunked tx_info) and legitimately need
// more headroom. Keyed on path suffix so the same handler under both
// `/reencryption-history` and `/api/chain/reencryption-history` matches.
const LONG_RUNNING_ROUTES: Array<{ pattern: RegExp; timeoutMs: number }> = [
  { pattern: /\/reencryption-history\//, timeoutMs: 120_000 },
];

export function requestTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let timedOut = false;
    const override = LONG_RUNNING_ROUTES.find((r) => r.pattern.test(req.path));
    const effectiveTimeoutMs = override?.timeoutMs ?? timeoutMs;

    // Abort controller for cancelling in-flight fetch operations on timeout.
    // Route handlers can pass res.locals.abortSignal to service calls.
    const abortController = new AbortController();
    res.locals.abortSignal = abortController.signal;

    // Intercept late responses — if the timeout fires first, subsequent
    // res.json()/res.send() calls no-op instead of crashing Express with
    // "Cannot set headers after they are sent".
    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    res.json = function (...args: Parameters<typeof origJson>) {
      if (timedOut) return res;
      return origJson(...args);
    } as typeof res.json;
    res.send = function (...args: Parameters<typeof origSend>) {
      if (timedOut) return res;
      return origSend(...args);
    } as typeof res.send;

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          timeoutMs: effectiveTimeoutMs,
        });
        // Send 504 before setting timedOut — origJson internally calls
        // the patched res.send, which must pass through for this response.
        res.status(504);
        origJson.call(res, {
          error: {
            code: 'GATEWAY_TIMEOUT',
            message: 'Request timed out',
            requestId: req.requestId,
          },
        });
        // Now suppress any late responses from the route handler
        timedOut = true;
        res.locals.timedOut = true;
        abortController.abort();
      }
    }, effectiveTimeoutMs);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}
