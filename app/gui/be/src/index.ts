import { createApp } from './app.js';
import { config } from './config/index.js';

const app = createApp();

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
