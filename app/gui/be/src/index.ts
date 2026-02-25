import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './services/logger.js';

const app = createApp();

// Start server
app.listen(config.port, () => {
  logger.info('Peace Protocol API started', {
    url: `http://localhost:${config.port}`,
    network: config.network,
    stubMode: config.useStubs,
    environment: config.nodeEnv,
  });
});
