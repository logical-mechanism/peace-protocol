import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './services/logger.js';

const app = createApp();

// Start server
const server = app.listen(config.port, () => {
  logger.info('Peace Protocol API started', {
    url: `http://localhost:${config.port}`,
    network: config.network,
    stubMode: config.useStubs,
    environment: config.nodeEnv,
  });
});

// Graceful shutdown — aligns with Rust's 10s SIGTERM window before SIGKILL
function gracefulShutdown(signal: string) {
  logger.info('Shutting down gracefully', { signal });
  const forceTimeout = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceTimeout.unref();

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
