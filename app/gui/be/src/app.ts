import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import routes from './routes/index.js';

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // CORS configuration
  app.use(
    cors({
      origin: config.cors.origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      network: config.network,
      useStubs: config.useStubs,
      timestamp: new Date().toISOString(),
    });
  });

  // API routes
  app.use('/api', routes);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: config.nodeEnv === 'development' ? err.message : 'Internal server error',
      },
    });
  });

  return app;
}
