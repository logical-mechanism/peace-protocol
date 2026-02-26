import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { logger } from './services/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requestTimeout } from './middleware/timeout.js';
import { getHealthStatus } from './services/health.js';
import routes from './routes/index.js';

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);
  app.use(requestTimeout());

  // CORS configuration
  app.use(
    cors({
      origin: config.cors.origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Health check endpoint — always returns 200 (Rust health_check expects 2xx)
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const health = await getHealthStatus(config.network, config.useStubs);
      res.json(health);
    } catch {
      res.json({
        status: 'unhealthy',
        uptimeSeconds: 0,
        kupo: { reachable: false, latencyMs: 0, lastSuccess: null },
        koios: { reachable: false, latencyMs: 0, lastSuccess: null },
        network: config.network,
        useStubs: config.useStubs,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Readiness probe — returns 503 when unhealthy, 200 for healthy/degraded
  app.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      const health = await getHealthStatus(config.network, config.useStubs);
      const statusCode = health.status === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(health);
    } catch {
      res.status(503).json({
        status: 'unhealthy',
        uptimeSeconds: 0,
        kupo: { reachable: false, latencyMs: 0, lastSuccess: null },
        koios: { reachable: false, latencyMs: 0, lastSuccess: null },
        network: config.network,
        useStubs: config.useStubs,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // API routes
  app.use('/api', routes);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
        requestId: _req.requestId,
      },
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, requestId: _req.requestId });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: config.nodeEnv === 'development' ? err.message : 'Internal server error',
        requestId: _req.requestId,
      },
    });
  });

  return app;
}
