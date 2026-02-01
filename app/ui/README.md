# Peace Protocol UI

A decentralized sealed-bid auction platform built on Cardano, featuring zero-knowledge proofs for bid privacy.

## Prerequisites

- Node.js 22+
- npm 10+
- Docker & Docker Compose (optional, for containerized development)
- A Cardano wallet browser extension (Eternl recommended)

## Quick Start

### Local Development (without Docker)

```bash
# Install dependencies for both frontend and backend
cd ui/fe && npm install
cd ../be && npm install

# Start backend (from ui/be/)
npm run dev

# Start frontend (from ui/fe/, in separate terminal)
npm run dev
```

Frontend runs at http://localhost:5173
Backend runs at http://localhost:3001

### Docker Development

```bash
# From ui/ directory
docker compose up

# Or run in background
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

## Environment Variables

### Frontend (`fe/.env.development`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_USE_STUBS` | Enable stub data mode (no blockchain) | `true` |
| `VITE_API_URL` | Backend API URL | `http://localhost:3001` |
| `VITE_BLOCKFROST_PROJECT_ID_PREPROD` | Blockfrost API key for preprod | - |
| `VITE_BLOCKFROST_PROJECT_ID_MAINNET` | Blockfrost API key for mainnet | - |
| `VITE_SENTRY_DSN` | Sentry error monitoring DSN | - |
| `VITE_SNARK_CDN_URL` | URL for SNARK files (pk.bin, ccs.bin) | `/snark` |

### Backend (`be/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment mode | `development` |
| `NETWORK` | Cardano network | `preprod` |
| `USE_STUBS` | Enable stub data mode | `true` |
| `KOIOS_URL_PREPROD` | Koios API URL for preprod | `https://preprod.koios.rest/api/v1` |
| `BLOCKFROST_PROJECT_ID_PREPROD` | Blockfrost API key | - |
| `ENCRYPTION_CONTRACT_ADDRESS_PREPROD` | Encryption contract address | - |
| `BIDDING_CONTRACT_ADDRESS_PREPROD` | Bidding contract address | - |

Copy `.env.example` to `.env` (backend) or `.env.development` (frontend) and fill in your values.

## Available Scripts

### Frontend (`fe/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | TypeScript compile + Vite production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |

### Backend (`be/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with tsx (hot reload) |
| `npm run build` | Compile TypeScript to dist/ |
| `npm run start` | Run production build |
| `npm run lint` | Type-check without emitting |

## Stub Mode

The application runs in "stub mode" by default (`VITE_USE_STUBS=true`), which uses mock data instead of querying the Cardano blockchain. This is necessary because:

1. **Contract deployment restrictions**: The Peace Protocol smart contracts cannot be deployed to preprod due to current protocol parameter restrictions
2. **Development without wallet**: Allows UI development without needing testnet ADA or wallet setup

When stub mode is enabled:
- Listings are loaded from local mock data
- Transactions are simulated (no real blockchain interaction)
- Wallet connection still works but transactions don't submit

To disable stub mode and use real blockchain data, set `VITE_USE_STUBS=false` and configure Blockfrost API keys.

## SNARK Proving Limitations

Zero-knowledge proof generation in the browser is currently **not functional** due to:

- WebAssembly memory limits (4GB max, SNARK proving requires more)
- gnark-wasm does not support wasm64 yet

**Workaround**: Use the native CLI prover for production bid submissions. The UI shows proof generation status but actual proving must happen off-browser.

SNARK files (`pk.bin`, `ccs.bin`) total ~700MB and should be hosted on a CDN for production use.

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | Recommended | Best Cardano wallet extension support |
| Firefox | Partial | Some wallet extensions may not work |
| Safari | Limited | Wallet compatibility issues |

**Recommended wallet**: Eternl (https://eternl.io)

## Project Structure

```
ui/
├── fe/                     # Frontend (React + Vite + TypeScript)
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Route pages
│   │   ├── services/       # API, crypto, SNARK services
│   │   ├── hooks/          # Custom React hooks
│   │   ├── dev/stubs/      # Stub data for development
│   │   └── types/          # TypeScript type definitions
│   ├── public/
│   │   └── snark/          # SNARK files (pk.bin, ccs.bin)
│   ├── Dockerfile
│   └── nginx.conf          # Production nginx config
│
├── be/                     # Backend (Express + TypeScript)
│   ├── src/
│   │   ├── routes/         # API route handlers
│   │   ├── services/       # Blockchain query services
│   │   ├── stubs/          # Stub data responses
│   │   └── types/          # TypeScript types
│   └── Dockerfile
│
├── docker-compose.yml      # Docker orchestration
└── README.md
```

## Docker Production Build

```bash
# Build and run production containers
docker compose --profile production up --build

# Or build images separately
docker build -t peace-fe --target production ./fe
docker build -t peace-be --target production ./be
```

Production frontend serves on port 80 via nginx with:
- Gzip compression
- Static asset caching
- SPA route handling
- API proxy to backend

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/listings` | GET | Get all active listings |
| `/api/listings/:id` | GET | Get listing by ID |
| `/api/listings/:id/bids` | GET | Get bids for listing |
| `/api/health` | GET | Health check |

## Troubleshooting

### "Wallet not detected"
- Ensure a Cardano wallet extension is installed
- Refresh the page after installing
- Check that the wallet is unlocked

### "Network mismatch"
- Ensure wallet is connected to Preprod network
- Check `NETWORK` environment variable matches wallet

### "Failed to load SNARK files"
- Verify SNARK files exist in `fe/public/snark/`
- Check `VITE_SNARK_CDN_URL` points to correct location
- Files are large (~700MB total) - ensure they downloaded completely

### Docker: "Port already in use"
```bash
# Check what's using the port
lsof -i :5173
lsof -i :3001

# Or change ports in docker-compose.yml
```

## Known Limitations

1. **Contracts not deployed**: Smart contracts cannot be deployed to preprod yet due to protocol parameters
2. **Browser SNARK proving**: Not functional - use native CLI prover
3. **Firefox/Safari**: Limited wallet support
4. **Stub mode only**: Real blockchain transactions not available until contract deployment

## Remaining Phases

The following phases from [ui-goals.md](./ui-goals.md) are incomplete or blocked:

- **Phase 5: Blockchain Data Layer** - Blocked until contracts deployed to preprod
  - Query encryptions/bids from contracts
  - Parse inline datums
  - Implement caching

- **Phase 9: Create Listing Flow** - Partially complete (stub mode works)
  - Real transaction submission blocked until contract deployment
  - UI form and crypto logic are implemented

- **Phase 11: SNARK Integration** - Permanently blocked for browser
  - Go lacks WebAssembly memory64 support
  - Browser-based proving hits 4GB WASM memory limit
  - Workaround: Use native CLI prover

- **Phase 12: Accept Bid Flow** - Blocked until contracts deployed
  - Requires native CLI prover integration (upload proof JSON)
  - Re-encryption logic needs live contracts

- **Phase 15: Local Development Setup** - Completed
  - Docker Compose created
  - Documentation complete

---

For AI assistance prompts, see [ui-goals.md](./ui-goals.md).
