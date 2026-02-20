import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import routes from './routes/index.js';

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

// Start server
app.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                  Peace Protocol API                      ║
╠══════════════════════════════════════════════════════════╣
║  Server:      http://localhost:${config.port.toString().padEnd(24)}║
║  Network:     ${config.network.padEnd(41)}║
║  Stub Mode:   ${(config.useStubs ? 'enabled' : 'disabled').padEnd(41)}║
║  Environment: ${config.nodeEnv.padEnd(41)}║
╚══════════════════════════════════════════════════════════╝

API Endpoints:
  GET  /health                         - Health check
  GET  /api/encryptions                - List all encryptions
  GET  /api/encryptions/:tokenName     - Get encryption by token
  GET  /api/encryptions/user/:pkh      - Get user's encryptions
  GET  /api/encryptions/status/:status - Get encryptions by status
  GET  /api/bids                       - List all bids
  GET  /api/bids/:tokenName            - Get bid by token
  GET  /api/bids/user/:pkh             - Get user's bids
  GET  /api/bids/encryption/:token     - Get bids for encryption
  GET  /api/bids/status/:status        - Get bids by status
  GET  /api/protocol/config            - Get protocol configuration
  GET  /api/protocol/reference         - Get reference UTxO data
  GET  /api/protocol/scripts           - Get script addresses
  GET  /api/protocol/params            - Get protocol parameters
  `);
});
