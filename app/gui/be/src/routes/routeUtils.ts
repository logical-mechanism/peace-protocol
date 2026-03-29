/**
 * Shared route error handling utilities.
 *
 * Eliminates repeated KupoUnavailableError catch blocks across route files.
 */

import type { Request, Response } from 'express';
import { KupoUnavailableError } from '../services/kupo.js';
import { logger } from '../services/logger.js';

/**
 * Handle service errors in route catch blocks.
 * Returns true if the error was handled and a response was sent.
 */
export function handleServiceError(
  error: unknown,
  req: Request,
  res: Response,
  context: string,
): boolean {
  if (error instanceof KupoUnavailableError) {
    logger.warn(`Kupo unavailable while ${context}`, { error: String(error), requestId: req.requestId });
    res.status(503).json({
      error: { code: 'KUPO_UNAVAILABLE', message: 'UTxO indexer is not reachable', requestId: req.requestId },
    });
    return true;
  }
  logger.error(`Error ${context}`, { error: String(error), requestId: req.requestId });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: `Failed to ${context}`, requestId: req.requestId },
  });
  return true;
}
