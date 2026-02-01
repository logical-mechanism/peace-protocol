# Peace Protocol UI Development Guide

## How to Use This Document

This is a complete specification for building the Peace Protocol UI. Use these sections based on your current task:

| Task | Relevant Sections |
|------|-------------------|
| **Project setup** | Overview → Architecture → Phase 1 |
| **Building pages/components** | Pages → Design System → Component Checklist |
| **Wallet integration** | Phase 2 → MeshJS Patterns |
| **Transaction building** | MeshJS Patterns → Data Structures Reference → `commands/*.sh` |
| **Porting Python crypto to JS** | Data Structures Reference → Crypto Implementation Details → `src/*.py` |
| **SNARK integration** | Phase 11 → SNARK Asset Delivery → `snark/browser-support.md` |
| **Understanding user flows** | User Flows → Pages |
| **API design** | API Endpoints → Blockchain Data Layer |

**Key external files to reference:**
- `contracts/lib/types/*.ak` - On-chain type definitions (source of truth for datums)
- `src/*.py` - Python crypto implementations to port
- `commands/*.sh` - Transaction building patterns via cardano-cli
- `contracts/plutus.json` - Compiled contract data
- `snark/browser-support.md` - WASM proving details

**Development without live contracts:** See "Stub Data Strategy" - most UI work can proceed with mock data while contracts are deployed to preprod.

---

## Overview

A React + Tailwind web application for the Peace Protocol encrypted data marketplace. Users can sell encrypted data and bid on encrypted data using Cardano smart contracts.

**Stack:**
- **Frontend**: React + Tailwind CSS
- **Wallet**: MeshJS v1.8.14 (stable, non-beta)
- **Blockchain Data**: Koios (queries) + Blockfrost (tx building)
- **SNARK Proving**: Go WASM (see `snark/browser-support.md`)
- **Local Dev**: Vite + Node.js backend
- **Target Browser**: Chrome only (best Cardano wallet support)
- **Test Wallet**: Eternl

**Network Strategy:**
- `preprod.website.com` → Preprod network
- `www.website.com` → Mainnet (future)
- Single codebase, network determined by subdomain

**Current Limitation:**
Contracts currently only work on a custom testnet. Preprod deployment pending blockchain parameter updates. Development can proceed using stub data for blockchain interactions.

---

## Development Without Live Contracts

Since contracts aren't yet on preprod, phases are categorized by blockchain dependency:

### Can Build Now (No Contract Dependency)

| Phase | What Can Be Done |
|-------|------------------|
| **Phase 1** | Full project setup |
| **Phase 2** | Wallet connection (works without contracts) |
| **Phase 3** | Full landing page |
| **Phase 11** | SNARK infrastructure (WASM setup works, but proof generation blocked by 4GB limit - use native CLI instead) |

### Can Build With Stub Data

| Phase | What Can Be Done | What's Stubbed |
|-------|------------------|----------------|
| **Phase 4** | Backend structure, API routes | Koios/Blockfrost responses |
| **Phase 5** | Data layer interfaces | Return hardcoded sample data |
| **Phase 6-8** | Full dashboard UI | Listings/bids from stub data |
| **Phase 9** | Form, crypto logic, UI flow | Transaction submission |
| **Phase 10** | Form, UI flow | Transaction submission |
| **Phase 13** | Decryption logic | Chain history queries |
| **Phase 14-15** | Most polish, testing utils | E2E tx tests |

### Blocked Until Preprod Deployment

| Phase | What's Blocked |
|-------|----------------|
| **Phase 9** | Actual tx submission & confirmation |
| **Phase 10** | Actual tx submission & confirmation |
| **Phase 12** | Full SNARK tx + re-encryption flow (also requires native CLI integration - browser proving not feasible) |
| **Phase 14** | Manual E2E transaction testing |

### Stub Data Strategy

Create a `dev/stubs/` directory with sample data:

```typescript
// fe/src/dev/stubs/encryptions.ts
export const STUB_ENCRYPTIONS = [
  {
    tokenName: "00abc123...",
    seller: "addr_test1qz...",
    status: "active",
    suggestedPrice: 100,
    createdAt: "2025-01-15T10:00:00Z",
    // ... datum fields
  },
  // More sample listings
];

// fe/src/dev/stubs/bids.ts
export const STUB_BIDS = [
  {
    tokenName: "00def456...",
    bidder: "addr_test1qx...",
    encryptionToken: "00abc123...",
    amount: 150000000, // lovelace
    status: "pending",
  },
];
```

```typescript
// fe/src/services/encryptions.ts
import { STUB_ENCRYPTIONS } from '../dev/stubs/encryptions';

const USE_STUBS = import.meta.env.VITE_USE_STUBS === 'true';

export async function getEncryptions() {
  if (USE_STUBS) {
    return STUB_ENCRYPTIONS;
  }
  // Real Koios query
  return await koios.getEncryptions();
}
```

### Environment Flag

```bash
# fe/.env.development
VITE_USE_STUBS=true

# fe/.env.production
VITE_USE_STUBS=false
```

### What Can Be Fully Tested Now

1. **Wallet connect/disconnect** - Works with any Cardano wallet
2. **SNARK proving** - Native CLI only (~4 min); browser WASM blocked by 4GB memory limit
3. **Crypto logic** - Encryption, schnorr proofs, key derivation
4. **All UI components** - With stub data
5. **Form validation** - All input validation
6. **Error handling UI** - Toasts, modals
7. **Secret storage** - IndexedDB persistence

---

## Architecture

```
ui/
├── fe/                          # Frontend (React)
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Page components
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # API calls, blockchain interactions
│   │   ├── wasm/                # SNARK WASM integration
│   │   └── utils/               # Helpers
│   ├── public/
│   │   ├── pk.bin               # Proving key (~613 MB)
│   │   ├── ccs.bin              # Constraint system (~85 MB)
│   │   ├── prover.wasm          # SNARK prover (~20 MB)
│   │   └── wasm_exec.js         # Go WASM runtime
│   └── package.json
│
├── be/                          # Backend (Node.js)
│   ├── src/
│   │   ├── routes/              # API routes
│   │   ├── services/            # Business logic
│   │   ├── cardano/             # Koios/Blockfrost clients
│   │   └── crypto/              # Encryption helpers
│   └── package.json
│
└── ui-goals.md                  # This file
```

---

## User Flows

### Seller (Alice) Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Connect    │────▶│  Create     │────▶│  View Bids  │────▶│  Accept Bid │
│  Wallet     │     │  Encryption │     │  on Listing │     │  (SNARK+Re) │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

1. **Create Encryption** (`03_createEncryptionTx.sh`)
   - Enter secret message
   - Set price/terms (stored off-chain or in datum)
   - Sign transaction
   - Mint encryption token → contract

2. **View Bids**
   - Query bidding contract for bids referencing their encryption token
   - Display bidder info, amounts

3. **Accept Bid** (Two-step process)
   - **Step 1: SNARK Tx** (`07a_createSnarkTx.sh`)
     - Generate Groth16 proof in browser (10-30s)
     - Submit proof to put encryption in "pending" state
   - **Step 2: Re-encryption Tx** (`07b_createReEncryptionTx.sh`)
     - Complete ownership transfer
     - Burn bid token
     - Update encryption datum

### Buyer (Bob) Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Connect    │────▶│  Browse     │────▶│  Place Bid  │────▶│  Decrypt    │
│  Wallet     │     │  Listings   │     │             │     │  (if won)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

1. **Browse Listings**
   - Query encryption contract for available encryptions
   - Display metadata, prices, seller info

2. **Place Bid** (`05_createBidTx.sh`)
   - Select encryption to bid on
   - Enter bid amount
   - Sign transaction
   - Mint bid token → bidding contract

3. **Decrypt** (`08_decryptMessage.sh`)
   - After winning bid, query encryption history from Koios
   - Decrypt message locally using private key

### Management Actions

- **Remove Encryption** (`04a_removeEncryptionTx.sh`) - Seller cancels listing
- **Cancel Encryption** (`04b_cancelEncryptionTx.sh`) - Cancel pending
- **Remove Bid** (`06_removeBidTx.sh`) - Buyer cancels bid

---

## Pages

### 1. Landing Page (`/`)

```
┌────────────────────────────────────────────────────────┐
│                    Peace Protocol                       │
│           Encrypted Data Marketplace                    │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │           [Connect Wallet Button]                 │ │
│  │                                                   │ │
│  │   Recommended: Eternl on Chrome                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  Brief explanation of what the protocol does           │
└────────────────────────────────────────────────────────┘
```

**Components:**
- Hero section with protocol name/description
- MeshJS `<CardanoWallet />` component (handles wallet selection)
- Redirect to dashboard on successful connection
- Note: MeshJS will show available wallets; tested with Eternl

### 2. Dashboard (`/dashboard`)

```
┌────────────────────────────────────────────────────────┐
│  [Wallet: addr1...xyz]                    [Disconnect] │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌─────────────────┐  ┌─────────────────┐             │
│  │  My Listings    │  │  My Bids        │             │
│  │  (3 active)     │  │  (2 pending)    │             │
│  └─────────────────┘  └─────────────────┘             │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Tabs: [Marketplace] [My Sales] [My Purchases] │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │  Content based on selected tab                 │   │
│  │                                                 │   │
│  └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

**Tabs:**

#### Marketplace Tab
- Grid/list of available encryptions
- Filter by price, date, seller
- "Place Bid" button on each card

#### My Sales Tab
- List of user's encryptions
- Status: Active, Pending, Completed
- View bids on each listing
- Accept bid button (triggers SNARK flow)
- Remove listing button

#### My Purchases Tab
- List of user's bids
- Status: Pending, Accepted, Rejected
- Decrypt button (for won bids)
- Cancel bid button

### 3. Create Listing Modal/Page

```
┌────────────────────────────────────────────────────────┐
│                   Create New Listing                    │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Secret Message:                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │                                                   │ │
│  │  [Textarea for secret data]                       │ │
│  │                                                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  Price (ADA):  [___________]                          │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  [Cancel]                    [Create Listing]    │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 4. SNARK Proving Modal

```
┌────────────────────────────────────────────────────────┐
│                  Generating Proof                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │                                                   │ │
│  │              [Animated Spinner]                   │ │
│  │                                                   │ │
│  │         Generating zero-knowledge proof...        │ │
│  │              This may take 10-30 seconds          │ │
│  │                                                   │ │
│  │  ████████████████████░░░░░░░░░░  65%             │ │
│  │                                                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  [Optional: Simple mini-game or educational content]   │
│                                                        │
│  ⚠️ Do not close this tab                             │
└────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Project Setup (COMPLETED)

- [x] Initialize React project with Vite
- [x] Configure Tailwind CSS (v4 with @tailwindcss/vite plugin)
- [x] Set up folder structure
- [x] Install MeshJS (`@meshsdk/core`, `@meshsdk/react`)
- [x] Create basic routing (react-router-dom)
- [x] Set up environment variables

```bash
# fe/
npm create vite@latest . -- --template react-ts
npm install tailwindcss @tailwindcss/vite
npm install @meshsdk/core@1.8.14 @meshsdk/react@1.8.14
npm install react-router-dom
npm install vite-plugin-wasm vite-plugin-top-level-await  # Required for MeshJS WASM
npm install vite-plugin-node-polyfills                    # Node.js polyfills for browser
```

**Note**: Tailwind v4 uses `@tailwindcss/vite` plugin instead of PostCSS. MeshJS requires WASM plugins and Node.js polyfills for Vite.

**Phase 1 Implementation Notes (for future phases):**

1. **MeshJS WASM Configuration**: The `vite.config.ts` includes a critical alias for `libsodium-wrappers-sumo` pointing to the CJS version (`dist/modules-sumo/libsodium-wrappers.js`). The ESM version has broken imports. Don't remove this alias.

2. **Bundle Size Warning**: The production build is large (~8.5MB JS, ~5.4MB WASM). This is expected due to MeshJS and Cardano serialization libraries. Consider code-splitting in Phase 14 if needed, but it works.

3. **MeshJS Hooks**: Use `useAddress()` to get the connected wallet address (returns string directly). Don't use `wallet.getUsedAddresses()` which is async and awkward in JSX.

4. **Tailwind v4 Syntax**: Uses `@import "tailwindcss"` in CSS (not `@tailwind` directives). The design system CSS variables are defined in `fe/src/index.css`.

5. **Routing Pattern**: App.tsx uses conditional rendering with `Navigate` for auth-gating. When `connected` is true, landing redirects to dashboard; when false, dashboard redirects to landing.

6. **Environment Variables**: All Vite env vars must be prefixed with `VITE_`. Access via `import.meta.env.VITE_*`.

7. **Node.js Polyfills**: MeshJS dependencies (pbkdf2, readable-stream, etc.) expect Node.js modules. The `vite-plugin-node-polyfills` plugin in `vite.config.ts` handles this - it polyfills `buffer`, `crypto`, `stream`, `util`, `events`, `process` and injects `Buffer`, `global`, and `process` globals. Don't remove this plugin or you'll get runtime errors.

### Phase 2: Wallet Integration (COMPLETED)

- [x] Use MeshJS `<CardanoWallet />` component (don't build custom)
- [x] Handle wallet state (connected/disconnected)
- [x] Display connected address
- [x] Store wallet context via MeshJS provider
- [x] Implement disconnect functionality
- [x] Test with Eternl wallet

```typescript
// Use MeshJS built-in wallet component
import { MeshProvider } from '@meshsdk/react';
import { CardanoWallet, useWallet } from '@meshsdk/react';

// Wrap app in provider
function App() {
  return (
    <MeshProvider>
      <YourApp />
    </MeshProvider>
  );
}

// Use the built-in wallet component
function WalletSection() {
  const { connected, wallet, disconnect } = useWallet();

  return (
    <div>
      <CardanoWallet />
      {connected && (
        <button onClick={disconnect}>Disconnect</button>
      )}
    </div>
  );
}
```

**Note**: MeshJS wallet component handles wallet selection UI. No need to build custom wallet picker.

**Phase 2 Implementation Notes (for future phases):**

1. **Wallet Persistence Hook**: Created `fe/src/hooks/useWalletPersistence.ts` that:
   - Saves the connected wallet name to localStorage on connection
   - Attempts to reconnect to the saved wallet on page load (with 100ms delay for extension initialization)
   - Provides `clearWalletSession()` function to clear saved wallet on manual disconnect

2. **Address Display with Copy**: Dashboard shows truncated address (first 12 + last 8 chars) with a copy-to-clipboard button. The button shows a checkmark briefly after successful copy.

3. **Clipboard Utility**: Created `fe/src/utils/clipboard.ts` with `copyToClipboard()` function that uses the modern Clipboard API with a fallback for older browsers.

4. **MeshJS Styling Overrides**: Added CSS in `fe/src/index.css` to style the CardanoWallet component to match our dark theme design system. Uses `!important` overrides on `[class*="mesh-"]` selectors.

5. **Disconnect Flow**: The disconnect button in Dashboard calls both `clearWalletSession()` (to clear localStorage) and `disconnect()` (MeshJS function) to ensure clean disconnection.

6. **Key Hooks Used**:
   - `useWallet()` - returns `{ connected, disconnect, connect, name }`
   - `useAddress()` - returns the connected wallet's address directly (no async needed)

### Phase 3: Landing Page (COMPLETED)

- [x] Design hero section
- [x] Add wallet connect component
- [x] Add protocol description
- [x] Implement redirect to dashboard on connect
- [x] Mobile responsive layout (app will only work on desktop)

**Phase 3 Implementation Notes (for future phases):**

1. **Landing Page Structure** (`fe/src/pages/Landing.tsx`):
   - Hero section with title "Veiled", subtitle "An Encrypted Data Marketplace", tagline "Powered By The PEACE Protocol"
   - Custom wallet detection and connection flow (not using MeshJS CardanoWallet component directly - manual detection allows more control)
   - Three feature cards: "Encrypted Data", "Zero-Knowledge Proofs", "Trustless Trading" with hover effects and centered content
   - Footer with "Preprod Network" indicator

2. **Branding**:
   - App name: "Veiled" (placeholder - can be changed later)
   - No logo icon - clean text-only hero
   - Protocol reference in tagline rather than title

3. **Wallet Connection Flow**:
   - Click "Connect Wallet" → detects installed wallets via `window.cardano`
   - Shows wallet list with icons from each wallet's API
   - "No wallets detected" state includes link to Eternl wallet download
   - Successful connection triggers redirect via App.tsx routing

4. **Network Indicator**:
   - Landing page: Footer shows "Preprod Network" with warning-colored dot
   - Dashboard: Nav bar shows "Preprod" badge next to app name
   - Can be extended to detect network from subdomain (see Environment Variables section)

5. **SVG Icons**:
   - Uses Heroicons-style SVGs inline (no external dependencies)
   - Icons: lock (encryption), shield-check (ZK proofs), arrows-right-left (trading)
   - Feature card icons are centered with `flex justify-center`

6. **Responsive Breakpoints**:
   - Feature cards: `grid-cols-1 md:grid-cols-3` (stack on mobile, 3-col on desktop)
   - Title: `text-4xl md:text-5xl`
   - Padding: `p-6 md:p-8`

### Phase 4: Backend Setup (COMPLETED)

- [x] Initialize Node.js/Express project
- [x] Configure Koios client
- [x] Configure Blockfrost client
- [x] Create API routes structure
- [x] Add CORS configuration

```bash
# be/
npm init -y
npm install express cors dotenv
npm install @blockfrost/blockfrost-js
npm install typescript tsx @types/node @types/express @types/cors --save-dev
```

**Note**: The `@koios-apis/koios-rest` package mentioned in original hints doesn't exist. A custom fetch-based Koios client was implemented instead.

**Phase 4 Implementation Notes (for future phases):**

1. **Running the Backend**:
   ```bash
   # From ui/ directory
   npm run dev        # Runs both FE (port 5173) and BE (port 3001)
   npm run dev:be     # Runs backend only
   npm run dev:fe     # Runs frontend only
   ```

2. **Backend Directory Structure**:
   ```
   be/
   ├── src/
   │   ├── index.ts              # Express app entry point
   │   ├── config/
   │   │   └── index.ts          # Environment config with network detection
   │   ├── routes/
   │   │   ├── index.ts          # Route aggregator
   │   │   ├── encryptions.ts    # /api/encryptions routes
   │   │   ├── bids.ts           # /api/bids routes
   │   │   └── protocol.ts       # /api/protocol routes
   │   ├── services/
   │   │   ├── koios.ts          # Custom fetch-based Koios client
   │   │   └── blockfrost.ts     # Blockfrost SDK wrapper
   │   ├── stubs/
   │   │   ├── index.ts          # Stub exports
   │   │   ├── encryptions.ts    # 5 sample encryptions
   │   │   ├── bids.ts           # 5 sample bids
   │   │   └── protocol.ts       # Protocol config stub
   │   └── types/
   │       └── index.ts          # Shared TypeScript types
   ├── .env                       # Environment variables
   ├── .env.example               # Template
   ├── package.json
   └── tsconfig.json
   ```

3. **Stub Mode**: Backend uses `USE_STUBS=true` by default. All routes check `config.useStubs` and return sample data. Set `USE_STUBS=false` when contracts are deployed.

4. **API Endpoints Implemented**:
   - `GET /health` - Health check with network/stub status
   - `GET /api/encryptions` - List all encryptions
   - `GET /api/encryptions/:tokenName` - Get specific encryption
   - `GET /api/encryptions/user/:pkh` - Get user's encryptions
   - `GET /api/encryptions/status/:status` - Filter by status
   - `GET /api/bids` - List all bids
   - `GET /api/bids/:tokenName` - Get specific bid
   - `GET /api/bids/user/:pkh` - Get user's bids
   - `GET /api/bids/encryption/:token` - Get bids for encryption
   - `GET /api/bids/status/:status` - Filter by status
   - `GET /api/protocol/config` - Get protocol configuration
   - `GET /api/protocol/reference` - Get reference UTxOs
   - `GET /api/protocol/scripts` - Get script addresses
   - `GET /api/protocol/params` - Get protocol parameters

5. **Frontend API Client**: Created `fe/src/services/api.ts` with typed functions for all endpoints:
   - `encryptionsApi.getAll()`, `encryptionsApi.getByToken()`, etc.
   - `bidsApi.getAll()`, `bidsApi.getByEncryption()`, etc.
   - `protocolApi.getConfig()`, etc.
   - `checkHealth()` for backend health checks

6. **TypeScript Configuration**: Backend uses ESM (`"type": "module"`) with `tsx` for development. File extensions must be `.js` in imports (e.g., `from './config/index.js'`).

7. **Stub Data Quality**: Stub encryptions and bids contain realistic BLS12-381 point placeholders, proper token name formats, and Cardano testnet addresses. Good for UI development but NOT cryptographically valid.

**Phase 4 Implementation Hints (original):**

1. **Directory Structure**:
   ```
   be/
   ├── src/
   │   ├── index.ts              # Express app entry point
   │   ├── routes/
   │   │   ├── index.ts          # Route aggregator
   │   │   ├── encryptions.ts    # /api/encryptions routes
   │   │   ├── bids.ts           # /api/bids routes
   │   │   └── protocol.ts       # /api/protocol routes
   │   ├── services/
   │   │   ├── koios.ts          # Koios API client
   │   │   └── blockfrost.ts     # Blockfrost API client
   │   └── config/
   │       └── index.ts          # Environment config
   ├── .env                       # Environment variables (gitignored)
   ├── .env.example               # Template for env vars
   ├── package.json
   └── tsconfig.json
   ```

2. **TypeScript Setup**:
   ```bash
   npm install typescript ts-node @types/node @types/express --save-dev
   npx tsc --init
   ```
   Configure `tsconfig.json` with `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, and `"outDir": "./dist"`.

3. **Koios Client Setup**:
   ```typescript
   // be/src/services/koios.ts
   import Koios from '@koios-apis/koios-rest';

   const network = process.env.NETWORK || 'preprod';
   const baseUrl = network === 'mainnet'
     ? 'https://api.koios.rest/api/v1'
     : 'https://preprod.koios.rest/api/v1';

   export const koios = new Koios({ baseUrl });
   ```

4. **Environment Variables** (`be/.env.example`):
   ```
   PORT=3001
   NODE_ENV=development
   NETWORK=preprod

   # Koios (free tier, no key needed)
   KOIOS_URL_PREPROD=https://preprod.koios.rest/api/v1

   # Blockfrost (required for tx building)
   BLOCKFROST_PROJECT_ID_PREPROD=preprodXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

   # Contract addresses (will be filled after preprod deployment)
   ENCRYPTION_CONTRACT_ADDRESS=
   BIDDING_CONTRACT_ADDRESS=
   ENCRYPTION_POLICY_ID=
   BIDDING_POLICY_ID=
   ```

5. **CORS Configuration**:
   ```typescript
   // Allow frontend origin (localhost for dev, specific domain for prod)
   app.use(cors({
     origin: process.env.NODE_ENV === 'production'
       ? ['https://preprod.yoursite.com', 'https://www.yoursite.com']
       : 'http://localhost:5173',
     credentials: true
   }));
   ```

6. **Stub Mode for Development**:
   Since contracts aren't deployed to preprod yet, implement stub responses:
   ```typescript
   // be/src/config/index.ts
   export const USE_STUBS = process.env.USE_STUBS === 'true';

   // be/src/routes/encryptions.ts
   import { USE_STUBS } from '../config';
   import { STUB_ENCRYPTIONS } from '../stubs/encryptions';

   router.get('/', async (req, res) => {
     if (USE_STUBS) {
       return res.json(STUB_ENCRYPTIONS);
     }
     // Real Koios query...
   });
   ```

7. **Frontend API Client**:
   Update frontend to call backend instead of direct blockchain queries:
   ```typescript
   // fe/src/services/api.ts
   const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

   export async function getEncryptions() {
     const res = await fetch(`${API_URL}/api/encryptions`);
     return res.json();
   }
   ```

8. **Running Both FE and BE**:
   Consider using `concurrently` for development:
   ```bash
   # ui/package.json (root)
   npm install concurrently --save-dev
   # Add script: "dev": "concurrently \"cd fe && npm run dev\" \"cd be && npm run dev\""
   ```

9. **API Response Format**:
   Use consistent response structure:
   ```typescript
   // Success
   { "data": [...], "meta": { "total": 10 } }

   // Error
   { "error": { "code": "NOT_FOUND", "message": "Encryption not found" } }
   ```

10. **Health Check Endpoint**:
    Always include for monitoring:
    ```typescript
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', network: process.env.NETWORK });
    });
    ```

### Phase 5: Blockchain Data Layer

- [ ] Query encryptions from encryption contract
- [ ] Query bids from bidding contract
- [ ] Query reference UTxO data
- [ ] Parse inline datums
- [ ] Implement caching (optional)

```typescript
// Example Koios query
async function getEncryptions() {
  const response = await koios.addressAssets(encryptionContractAddress);
  // Parse and return encryptions
}
```

**Phase 5 Implementation Hints:**

1. **BLOCKED UNTIL CONTRACT DEPLOYMENT**: Phase 5 requires contract addresses. Until contracts are deployed to preprod, continue using stub data. The backend routes have TODO comments marking where real queries should go.

2. **When Contracts Are Deployed, Update**:
   ```bash
   # be/.env
   USE_STUBS=false
   ENCRYPTION_CONTRACT_ADDRESS_PREPROD=addr_test1...
   BIDDING_CONTRACT_ADDRESS_PREPROD=addr_test1...
   ENCRYPTION_POLICY_ID_PREPROD=...
   BIDDING_POLICY_ID_PREPROD=...
   ```

3. **Koios Query Pattern** (in `be/src/services/koios.ts`):
   ```typescript
   // The Koios client is already set up with these methods:
   // - getAddressUtxos(address) - Get UTxOs at contract address
   // - getAssetUtxos(policyId, assetName?) - Get UTxOs by asset
   // - getTxInfo(txHash) - Get transaction details
   // - getTip() - Get current tip
   // - getProtocolParams() - Get protocol parameters
   ```

4. **Parsing Inline Datums**: Koios returns `inline_datum` field with CBOR bytes. Need to:
   ```typescript
   // Pseudocode for datum parsing
   import { Data } from '@meshsdk/core'; // or use cbor-x directly

   function parseEncryptionDatum(inlineDatum: { bytes: string }): EncryptionDatum {
     // Decode CBOR bytes to Plutus data structure
     // Map constructor indices to TS types
     // See contracts/lib/types/*.ak for constructor ordering
   }
   ```

5. **Constructor Index Mapping** (from Aiken types):
   - `Status::Open` = constructor 0
   - `Status::Pending` = constructor 1
   - `EncryptionDatum` fields ordered as in `contracts/lib/types/encryption.ak`
   - `BidDatum` fields ordered as in `contracts/lib/types/bidding.ak`

6. **Suggested Approach**:
   - Create `be/src/services/parsers.ts` with datum parsing functions
   - Create `be/src/services/encryptions.ts` for encryption business logic
   - Create `be/src/services/bids.ts` for bid business logic
   - Update routes to call service functions when `USE_STUBS=false`

7. **Reference UTxOs**: Query the reference contract address for script references. The UTxO output index indicates which script:
   - Index 1 = encryption script
   - Index 1 = bidding script (different tx)
   - Index 1 = groth script (different tx)
   - Store these in protocol config or cache after first query

8. **Caching Strategy** (optional but recommended):
   - In-memory cache with TTL (e.g., 30 seconds)
   - Clear cache after transaction confirmation
   - Consider Redis for production if multiple backend instances

9. **Error Handling**: Koios can return errors or empty results. Handle gracefully:
   ```typescript
   try {
     const utxos = await koiosClient.getAddressUtxos(address);
     if (!utxos.length) return { data: [], meta: { total: 0 } };
     // Parse and return
   } catch (error) {
     if (error.message.includes('404')) {
       return { data: [], meta: { total: 0 } };
     }
     throw error;
   }
   ```

10. **Testing with Real Data**: Once contracts are deployed:
    - First verify health check works: `curl http://localhost:3001/health`
    - Then test encryptions endpoint: `curl http://localhost:3001/api/encryptions`
    - Check Koios rate limits (free tier has restrictions)
    - Consider adding request throttling if needed

### Phase 6: Dashboard - Marketplace Tab (COMPLETED)

- [x] Create encryption card component
- [x] Implement grid/list view
- [x] Add filtering/sorting
- [x] Connect to backend API
- [x] Add loading states
- [x] Add empty states

**Phase 6 Implementation Notes (for future phases):**

1. **Components Created** (`fe/src/components/`):
   - `LoadingSpinner.tsx` - Animated SVG spinner with size variants (sm/md/lg)
   - `EmptyState.tsx` - Reusable empty state with icon, title, description, and action slots. Includes `PackageIcon`, `SearchIcon`, `InboxIcon` exports
   - `Badge.tsx` - Status badges with variants (success/warning/error/neutral/accent). Includes `EncryptionStatusBadge` and `BidStatusBadge` helper components
   - `EncryptionCard.tsx` - Card for displaying encryption listings with lock icon, price, seller info, and bid button. Supports `compact` prop for list view
   - `MarketplaceTab.tsx` - Full marketplace with search, filtering, sorting, and view toggle
   - `ScrollToTop.tsx` - Fixed button in bottom-right corner that appears after scrolling 300px. Uses smooth scroll animation. Dashboard-only (not on Landing)

2. **MarketplaceTab Features**:
   - **Search**: Filter by token name or seller address
   - **Status Filter**: All / Active / Pending dropdown
   - **Sort Options**: Newest First, Oldest First, Price High to Low, Price Low to High
   - **View Modes**: Grid (3-column on desktop) and List (compact cards)
   - **Refresh Button**: Manual refresh for listings
   - **Results Count**: Shows number of matching listings
   - **Loading State**: Centered spinner with message
   - **Error State**: Retry button on API failure
   - **Empty States**: Different messages for "no listings" vs "no matches"
   - **Scroll to Top**: Fixed button appears after scrolling 300px, useful for long listing pages and future infinite scroll/pagination

3. **Dashboard Updates**:
   - Tab switching now functional (Marketplace / My Sales / My Purchases)
   - Stats cards are clickable and navigate to relevant tabs
   - Stats cards show active highlight when their tab is selected
   - Stats fetch actual counts from API (filtered by connected wallet address)
   - `handlePlaceBid` callback ready for Phase 10 implementation

4. **Type Import Pattern**: Use `import type { X }` for type-only imports due to `verbatimModuleSyntax` in tsconfig. Example:
   ```typescript
   import { encryptionsApi, bidsApi } from '../services/api'
   import type { EncryptionDisplay } from '../services/api'
   ```

5. **Design System Usage**: All components use CSS variables from `index.css`:
   - Backgrounds: `var(--bg-card)`, `var(--bg-card-hover)`, `var(--bg-secondary)`
   - Borders: `var(--border-subtle)`, `var(--border-default)`
   - Colors: `var(--accent)`, `var(--success)`, `var(--warning)`, `var(--error)`
   - Radius: `var(--radius-md)`, `var(--radius-lg)`
   - Transitions: `duration-150` for fast interactions

6. **Stub Data Works Well**: The backend stubs provide 5 sample encryptions with realistic data including CIP-20 metadata (description, suggestedPrice, storageLayer). The marketplace displays them correctly with filtering/sorting. No blockchain connection needed for UI development.

7. **CIP-20 Metadata Display**: EncryptionCard now displays:
   - **Description**: Shown in a muted box below the header (2 lines in grid, 1 line in list)
   - **Storage Layer**: Badge showing "On-chain", "IPFS", "Arweave", or "External"
   - **Suggested Price**: Already displayed as main price (unchanged)
   - Added `line-clamp-1` and `line-clamp-2` CSS utilities for text truncation

8. **Placeholder for Phase 10**: The "Place Bid" button currently shows an alert. Implement bid modal in Phase 10.

### Phase 7: Dashboard - My Sales Tab (COMPLETED)

- [x] List user's encryptions
- [x] Show bids on each encryption
- [x] Add remove listing functionality
- [x] Add "View Bids" expand/modal
- [x] Implement status indicators

**Phase 7 Implementation Notes (for future phases):**

1. **Components Created** (`fe/src/components/`):
   - `MySalesTab.tsx` - Main tab component with filtering, sorting, and view modes
   - `SalesListingCard.tsx` - Seller-specific card with actions (View Bids, Remove, Cancel)
   - `BidsModal.tsx` - Modal for viewing and accepting bids on a listing

2. **MySalesTab Features**:
   - **Search**: Filter by token name or description
   - **Status Filter**: All / Active / Pending / Completed (includes completed unlike Marketplace)
   - **Sort Options**: Newest First, Oldest First, Price High to Low, Price Low to High, Most Bids
   - **View Modes**: Grid (3-column) and List (compact)
   - **Refresh Button**: Manual refresh for listings
   - **Results Count**: Shows number of matching listings with status indicator
   - **Bid Count Display**: Shows pending bid count on each listing card
   - **TTL Countdown**: For pending listings, shows time remaining until auto-cancel

3. **SalesListingCard Features**:
   - Grid and compact (list) view modes
   - Status badge with TTL countdown for pending status
   - Bid count display for active listings
   - Action buttons based on status:
     - Active: "View Bids" (with count badge), "Remove Listing"
     - Pending: "Cancel Pending Sale" with TTL warning
     - Completed: No actions, shows "Sale completed" message

4. **BidsModal Features**:
   - Shows listing summary (suggested price, total bids)
   - Separates pending bids from past bids
   - Sorts bids by amount (highest first)
   - "Accept Bid" button for pending bids (triggers Phase 12 SNARK flow)
   - Shows bid token name, bidder address, amount in ADA, and placement date
   - Keyboard support (Escape to close)
   - Body scroll lock when open

5. **Dashboard Integration**:
   - Added `handleRemoveListing`, `handleAcceptBid`, `handleCancelPending` callbacks
   - All transaction-related actions show placeholder alerts until Phases 9/12
   - MySalesTab receives callbacks for all seller actions

6. **Stub Data Limitation**: Connected wallet addresses won't match stub data sellers. The "My Sales" tab will show "No listings yet" with a "Create Listing" button for real users. This is expected behavior - users need to create their own listings (Phase 9).

7. **Action Placeholders**:
   - "Remove Listing" → Phase 9 (requires `04a_removeEncryptionTx.sh` transaction)
   - "Cancel Pending" → Phase 9 (requires `04b_cancelEncryptionTx.sh` transaction)
   - "Accept Bid" → Phase 12 (requires SNARK proof + re-encryption flow)

8. **Pattern Reuse**: MySalesTab follows the exact same patterns as MarketplaceTab for consistency - same toolbar layout, same filter/sort controls, same view toggle. This makes the codebase maintainable and provides consistent UX.

9. **DescriptionModal Component** (`fe/src/components/DescriptionModal.tsx`):
   - Modal for viewing full descriptions when truncated
   - Exports reusable helper functions:
     ```typescript
     export const DESCRIPTION_MAX_LENGTH = 200;
     export function needsTruncation(description: string | undefined): boolean;
     export function truncateDescription(description: string | undefined): string;
     ```
   - Used by both `EncryptionCard` and `SalesListingCard`
   - Plus icon indicator for expandable descriptions (replaces text link)
   - Keyboard support (Escape to close), body scroll lock

10. **Edge Case Handling** (in both `EncryptionCard.tsx` and `SalesListingCard.tsx`):
    - **Long descriptions**: Truncated at 200 chars with `...`, plus icon shows expandability, clicking opens DescriptionModal
    - **Invalid prices**: Fallback to 1 ADA when `suggestedPrice` is undefined, null, NaN, or negative
      ```typescript
      const DEFAULT_FALLBACK_PRICE = 1;
      const formatPrice = (price?: number): string => {
        if (price === undefined || price === null || isNaN(price) || price < 0) {
          return `${DEFAULT_FALLBACK_PRICE} ADA`;
        }
        return `${price.toLocaleString()} ADA`;
      };
      ```
    - **Unknown storage layers**: Shows yellow "No data layer" badge for any value that doesn't match `on-chain`, `ipfs://...`, or `arweave://...`
      ```typescript
      const isUnknownStorageLayer = (storageLayer?: string): boolean => {
        if (!storageLayer) return true;
        if (storageLayer === 'on-chain') return false;
        if (storageLayer.startsWith('ipfs://')) return false;
        if (storageLayer.startsWith('arweave://')) return false;
        return true;
      };
      ```

11. **Edge Case Test Data** (`be/src/stubs/encryptions.ts`):
    - Added test encryption `05edge999test...` that demonstrates all three edge cases:
      - 580+ character description (triggers truncation + modal)
      - `suggestedPrice: undefined` (displays "1 ADA" fallback)
      - `storageLayer: 'custom-server://...'` (shows yellow "No data layer" badge)

**Phase 7 Implementation Hints (original):**

1. **Component Structure**:
   - Create `MySalesTab.tsx` in `fe/src/components/`
   - Create `SalesListingCard.tsx` - similar to EncryptionCard but with seller actions
   - Create `BidsModal.tsx` or expandable section to show bids on a listing
   - Reuse `Badge.tsx`, `LoadingSpinner.tsx`, `EmptyState.tsx` from Phase 6

2. **Fetching User's Listings**:
   ```typescript
   // Filter encryptions by connected wallet address
   const userListings = encryptions.filter(
     e => e.seller.toLowerCase() === address.toLowerCase()
   );
   ```
   Note: In production with real contracts, use `encryptionsApi.getByUser(pkh)` where `pkh` is extracted from the address. With stubs, filter client-side.

3. **Fetching Bids for Each Listing**:
   ```typescript
   // Use bidsApi.getByEncryption(encryptionTokenName)
   const bidsForListing = await bidsApi.getByEncryption(listing.tokenName);
   ```
   Consider fetching bids on demand (when user expands/clicks "View Bids") rather than upfront.

4. **Seller Actions**:
   - **View Bids**: Show modal/expand with list of bids, each with bidder address and amount
   - **Accept Bid**: Placeholder button for Phase 12 (SNARK + re-encryption flow)
   - **Remove Listing**: Placeholder for Phase 9 (requires tx building)
   - **Cancel Pending**: For listings in "pending" status, show cancel option

5. **Status Handling**:
   - `active`: Show "View Bids" and "Remove" buttons
   - `pending`: Show TTL countdown, "Complete Sale" and "Cancel" buttons
   - `completed`: Show "Sold" indicator, hide action buttons

6. **TTL Countdown for Pending**:
   ```typescript
   // datum.status.ttl is Unix timestamp in milliseconds
   const timeRemaining = datum.status.ttl - Date.now();
   const minutesLeft = Math.floor(timeRemaining / 60000);
   // Display: "Complete within X minutes"
   ```

7. **Dashboard Integration**:
   - Import `MySalesTab` in Dashboard.tsx
   - Replace the EmptyState placeholder in `renderTabContent()` case 'my-sales'
   - Pass `userAddress` prop for filtering

8. **Stub Data Note**: The stub encryptions have 2 sellers with address `addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp` (tokens 00abc..., 02ghi...) and address `addr_test1qpq6z3s7a9qlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yqdxyrt` (tokens 01def..., 04stu...). Connected wallet won't match these, so "My Sales" will show empty for real users. Consider adding a "demo mode" or showing all listings in development.

9. **Remove Listing Transaction (Phase 9 dependency)**:
   The actual "Remove Listing" action requires building and submitting a transaction (`04a_removeEncryptionTx.sh`). For Phase 7, just show the button as disabled or with tooltip "Coming soon - requires contract deployment".

10. **Bids Modal Design**:
    ```
    ┌────────────────────────────────────────────────────────┐
    │  Bids for Listing 00abc123...                    [×]   │
    ├────────────────────────────────────────────────────────┤
    │  ┌──────────────────────────────────────────────────┐ │
    │  │  addr_test1qx...abc    150 ADA    [Accept Bid]  │ │
    │  │  Placed: Jan 16, 2025                            │ │
    │  └──────────────────────────────────────────────────┘ │
    │  ┌──────────────────────────────────────────────────┐ │
    │  │  addr_test1qy...def    120 ADA    [Accept Bid]  │ │
    │  │  Placed: Jan 15, 2025                            │ │
    │  └──────────────────────────────────────────────────┘ │
    │                                                        │
    │  No more bids                                          │
    └────────────────────────────────────────────────────────┘
    ```

### Phase 8: Dashboard - My Purchases Tab (COMPLETED)

- [x] List user's bids
- [x] Show bid status
- [x] Add cancel bid functionality
- [x] Add decrypt button (for won bids)

**Phase 8 Implementation Notes (for future phases):**

1. **Components Created** (`fe/src/components/`):
   - `MyPurchasesTab.tsx` - Main tab component with filtering, sorting, and view modes
   - `MyPurchaseBidCard.tsx` - Buyer-specific card with actions (Cancel Bid, Decrypt)

2. **MyPurchasesTab Features**:
   - **Search**: Filter by token name, encryption token, or encryption description
   - **Status Filter**: All / Pending / Accepted / Rejected / Cancelled
   - **Sort Options**: Newest First, Oldest First, Amount High to Low, Amount Low to High
   - **View Modes**: Grid (3-column) and List (compact)
   - **Refresh Button**: Manual refresh for bids
   - **Results Count**: Shows number of matching bids with status indicator
   - **Encryption Context**: Fetches and displays related encryption data (description, seller, suggested price)

3. **MyPurchaseBidCard Features**:
   - Grid and compact (list) view modes
   - Dynamic icon color based on status (success green for accepted, warning orange for pending, muted for others)
   - Bid amount prominently displayed in ADA (converted from lovelace)
   - Shows encryption being bid on with description (if available)
   - Seller address display
   - Suggested price comparison
   - Status-specific messaging:
     - Pending: "Waiting for seller"
     - Accepted: "Your bid was accepted! You can now decrypt the message."
     - Rejected: "Your bid was not accepted."
     - Cancelled: "This bid was cancelled."
   - Action buttons:
     - Pending: "Cancel Bid" (placeholder for Phase 10)
     - Accepted: "Decrypt Message" with unlock icon (placeholder for Phase 13)

4. **Dashboard Integration**:
   - Added `handleCancelBid` callback (placeholder for Phase 10)
   - Added `handleDecrypt` callback (placeholder for Phase 13)
   - `MyPurchasesTab` receives callbacks for all buyer actions

5. **Stub Data Limitation**: Connected wallet addresses won't match stub data bidders. The "My Purchases" tab will show "No bids yet" with a "Browse Marketplace" button for real users. This is expected behavior - users need to place their own bids (Phase 10).

6. **Action Placeholders**:
   - "Cancel Bid" → Phase 10 (requires `06_removeBidTx.sh` transaction)
   - "Decrypt Message" → Phase 13 (requires encryption history query + decryption)

7. **Pattern Consistency**: MyPurchasesTab follows the exact same patterns as MySalesTab and MarketplaceTab for consistency - same toolbar layout, same filter/sort controls, same view toggle. This makes the codebase maintainable and provides consistent UX.

8. **Encryption Data Fetching**:
   - Uses `encryptionsMap` to cache encryption details for all user bids
   - Fetches all encryptions once and creates a lookup map by token name
   - Displays encryption description, seller address, and suggested price on bid cards

9. **Type Pattern Used**:
   ```typescript
   interface MyPurchasesTabProps {
     userAddress?: string;
     onCancelBid?: (bid: BidDisplay) => void;
     onDecrypt?: (bid: BidDisplay) => void;
   }
   ```

10. **Visual Distinction for Won Bids**:
    - Green success styling for accepted bids (icon, badge, amount color)
    - Success-colored "Decrypt Message" CTA button
    - Status message box with green background

### Phase 9: Create Listing Flow

**IMPORTANT: Phase 9 is blocked until contracts are deployed to preprod.** The UI form and crypto logic can be built with stub data, but actual transaction submission requires live contracts.

**What Can Be Built Now:**
- Create listing form UI with all fields
- Form validation logic
- Port Python crypto functions to JavaScript (encryption, key derivation, schnorr proofs)
- Build transaction structure with MeshJS (will fail on submit but structure can be verified)
- Success/error UI feedback components

**What's Blocked Until Contract Deployment:**
- Actual transaction submission and confirmation
- Reference script UTxO lookups
- Contract address resolution
- Token minting to contract

**Phase 9 Implementation Hints:**

1. **Form Component Structure**:
   - Create `CreateListingModal.tsx` in `fe/src/components/`
   - Create `CreateListingForm.tsx` for the form logic
   - Form should be a modal that opens from Dashboard (add "Create Listing" button)

2. **Required Form Fields**:
   ```typescript
   interface CreateListingFormData {
     secretMessage: string;           // The data to encrypt (required)
     description: string;             // Human-readable description (required)
     suggestedPrice?: number;         // ADA amount (optional)
     storageLayer: 'on-chain' | 'ipfs' | 'arweave';  // Default: 'on-chain'
     ipfsHash?: string;               // Required if storageLayer === 'ipfs'
     arweaveId?: string;              // Required if storageLayer === 'arweave'
   }
   ```

3. **Form Validation**:
   - `secretMessage`: Required, non-empty
   - `description`: Required, max 500 chars (CIP-20 metadata size limits)
   - `suggestedPrice`: Optional, if provided must be positive number
   - `storageLayer`: Must be valid option
   - `ipfsHash`: Required if IPFS selected, validate format (starts with "Qm" or "bafy")
   - `arweaveId`: Required if Arweave selected, validate format (43 chars base64)

4. **Crypto Logic to Port** (from `src/commands/` Python files):
   - **Key Derivation**: Generate seller's BLS12-381 keys (a, r secrets → register)
   - **Capsule Generation**: Create encryption capsule from message + keys
   - **Schnorr Proofs**: Generate proofs for register validity
   - Use `@noble/curves` library for BLS12-381 operations
   - Reference: `src/bls_code.py`, `src/encryption.py`

5. **IndexedDB Secret Storage**:
   - Store (a, r) secrets locally before transaction submission
   - Key by encryption token name (computed from UTxO)
   - Encrypt with wallet-derived key (sign a message to derive encryption key)
   - If secrets are lost, seller cannot complete sales
   - Create `fe/src/services/secretStorage.ts` service

6. **Transaction Building Pattern**:
   ```typescript
   // Step 1: Get a UTxO from wallet to compute token name
   const utxos = await wallet.getUtxos();
   const selectedUtxo = utxos[0]; // First UTxO
   const tokenName = computeTokenName(selectedUtxo);

   // Step 2: Generate crypto materials
   const { a, r, register, capsule } = await generateEncryption(secretMessage);

   // Step 3: Store secrets in IndexedDB BEFORE tx submission
   await secretStorage.store(tokenName, { a, r });

   // Step 4: Build datum
   const datum = buildEncryptionDatum({
     owner_vkh: extractPkh(address),
     owner_g1: register,
     token: tokenName,
     half_level: buildHalfLevel(r),
     full_level: null,
     capsule: capsule,
     status: { type: 'Open' },
   });

   // Step 5: Build and submit transaction
   const tx = new Transaction({ initiator: wallet });
   // ... mint + send to contract
   ```

7. **Token Name Computation**:
   ```typescript
   // From cardano-cli shell script logic
   function computeTokenName(utxo: { txHash: string; outputIndex: number }): string {
     // CBOR encode the output index
     const indexCbor = cborEncodeInteger(utxo.outputIndex);
     // Concatenate: cbor(index) + txHash (first 64 hex chars)
     const combined = indexCbor + utxo.txHash;
     return combined.slice(0, 64);
   }
   ```
   Need `cbor-x` or similar library for CBOR encoding.

8. **CIP-20 Metadata**:
   ```typescript
   // Attach to transaction for off-chain indexing
   tx.setMetadata(674, {
     msg: [
       formData.description,
       formData.suggestedPrice?.toString() || '0',
       getStorageLayerUri(formData), // 'on-chain', 'ipfs://Qm...', 'ar://...'
     ]
   });
   ```

9. **MeshJS Considerations**:
   - MeshJS v1.8.14 API may need low-level access for inline datums
   - May need to use `tx.txBuilder.tx_builder` for advanced operations
   - Test transaction structure by serializing to CBOR and comparing with working cardano-cli tx
   - Reference: `commands/03_createEncryptionTx.sh`

10. **Error Handling**:
    - Wallet not connected → Prompt to connect
    - Insufficient funds → Show required ADA amount
    - Transaction failed → Show error with retry option
    - User rejected signing → Show cancellation message

11. **Success Flow**:
    - Show success modal with transaction hash
    - Link to CardanoScan for tx confirmation
    - Refresh listings in marketplace
    - Clear form and close modal

12. **Dashboard Integration**:
    - Add "Create Listing" button to Dashboard nav or MySalesTab empty state
    - Modal opens on button click
    - On success, switch to MySalesTab and refresh

13. **Testing with Stubs**:
    - Build entire form and crypto logic
    - Transaction building can be tested up to the point of submission
    - Use console.log to output transaction CBOR for manual inspection
    - Compare against `commands/03_createEncryptionTx.sh` output structure

14. **Dependencies to Install**:
    ```bash
    npm install @noble/curves cbor-x
    # @noble/curves for BLS12-381 operations
    # cbor-x for CBOR encoding (datum, redeemer, token name)
    ```

15. **Key Files to Reference**:
    - `commands/03_createEncryptionTx.sh` - Transaction structure
    - `src/commands/create_encryption.py` - Crypto logic
    - `src/bls_code.py` - BLS12-381 operations
    - `contracts/lib/types/encryption.ak` - Datum type definition

16. **Blockers to Note**:
    - Contract addresses not yet available on preprod
    - Reference script UTxOs not deployed
    - Genesis token policy not available
    - All transaction submissions will fail until deployment

- [x] Create listing form component
- [x] Port Python crypto logic to JS (encryption, schnorr proofs, etc.)
- [x] Build transaction with MeshJS (stub mode - contracts not deployed)
- [x] Attach CIP-20 metadata (description, price, storage layer)
- [x] Sign and submit transaction (stub mode - simulated)
- [x] Show success/error feedback
- [x] Refresh listings

**Create Listing Form Fields:**
```typescript
interface CreateListingForm {
  secretMessage: string;          // The data to encrypt
  description: string;            // Human-readable description (CIP-20)
  suggestedPrice?: number;        // ADA, optional (CIP-20)
  storageLayer: 'on-chain' | 'ipfs' | 'arweave';  // Where to store (CIP-20)
  ipfsHash?: string;              // If storageLayer is 'ipfs'
  arweaveId?: string;             // If storageLayer is 'arweave'
}
```

**CIP-20 Metadata Integration:**
When building the transaction, attach metadata following CIP-20 standard:
```typescript
// Add CIP-20 metadata to transaction
tx.setMetadata(674, {
  msg: [
    formData.description,
    formData.suggestedPrice?.toString() || '0',
    getStorageLayerUri(formData),  // 'on-chain', 'ipfs://Qm...', etc.
  ]
});
```

See "CIP-20 Transaction Metadata" section in Critical Implementation Details for full specification.

**Porting Notes:**

This phase involves porting two things:

1. **Python crypto code** (`src/commands/`) → JS
   - Encryption logic, schnorr proofs, key derivation
   - Use `@noble/curves` for BLS12-381 and secp256k1
   - Port or rewrite the capsule/register generation

2. **cardano-cli tx building** → MeshJS
   - Shell scripts in `commands/` show exact tx structure
   - MeshJS and cardano-cli share similar concepts but APIs differ
   - Expect manual intervention for: inline datums, redeemers, reference scripts
   - Test incrementally: build tx → inspect CBOR → compare to working cli tx

```typescript
// Example MeshJS transaction building with CIP-20 metadata
import { Transaction } from '@meshsdk/core';

const tx = new Transaction({ initiator: wallet });

// CIP-20 metadata for listing info
tx.setMetadata(674, {
  msg: [
    formData.description,
    formData.suggestedPrice?.toString() || '0',
    formData.storageLayer,
  ]
});

tx.mintAsset(encryptionScript, asset, redeemer);
tx.sendAssets(encryptionContractAddress, assets, { datum });
const unsignedTx = await tx.build();
const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);
```

**Debugging tip:** If MeshJS tx fails but cli works, serialize both to CBOR and diff them.

---

**Phase 9 Implementation Notes (Completed with Stub Mode):**

1. **Files Created**:
   - `fe/src/components/CreateListingModal.tsx` - Form UI with all fields and validation
   - `fe/src/components/Toast.tsx` - Toast notification system with `useToast()` hook
   - `fe/src/services/crypto/bls12381.ts` - BLS12-381 operations using `@noble/curves`
   - `fe/src/services/crypto/constants.ts` - Domain tags (KEY, SCH, BND, SLT, KEM, AAD, MSG) and Wang G2 points
   - `fe/src/services/crypto/hashing.ts` - Blake2b-224 hashing using `@noble/hashes`
   - `fe/src/services/crypto/register.ts` - Register creation and Plutus JSON serialization
   - `fe/src/services/crypto/schnorr.ts` - Schnorr proof generation with Fiat-Shamir transform
   - `fe/src/services/crypto/binding.ts` - Binding proof for transcript binding
   - `fe/src/services/crypto/level.ts` - Half/Full level structures and Plutus JSON serialization
   - `fe/src/services/crypto/ecies.ts` - AES-256-GCM encryption with HKDF-SHA3-256
   - `fe/src/services/crypto/walletSecret.ts` - CIP-30 wallet signing for `sk` derivation
   - `fe/src/services/crypto/createEncryption.ts` - High-level encryption artifact creation
   - `fe/src/services/crypto/index.ts` - Re-exports all crypto modules for easy importing
   - `fe/src/services/secretStorage.ts` - IndexedDB storage for seller secrets (a, r)
   - `fe/src/services/transactionBuilder.ts` - Stub-mode transaction building
   - `fe/src/noble-types.d.ts` - Ambient type declarations for @noble packages

2. **Noble Package v2.0 Migration**:
   - `@noble/curves` and `@noble/hashes` v2.0 require `.js` extension in imports
   - Example: `import { bls12_381 } from '@noble/curves/bls12-381.js'`
   - Example: `import { blake2b } from '@noble/hashes/blake2.js'`
   - API changed: `G1.ProjectivePoint` → `G1.Point` in v2.0

3. **CRITICAL BLOCKER - `gt_to_hash` Function**:
   - The `gt_to_hash(r1, secrets)` function requires BLS12-381 **pairing computation**
   - Noble-curves does not expose the raw GT (target group) element bytes after pairing
   - The pairing result is needed to derive the KEM (key encapsulation material) for ECIES
   - **Current workaround**: `createEncryption.ts` has a `gtToHashStub()` that returns deterministic fake data
   - **Resolution**: When contracts deploy, use native CLI binary to compute `gt_to_hash`:
     ```bash
     # Call native binary from backend API
     ./peace-cli gt-to-hash --r1 <hex> --a <scalar> --r <scalar>
     ```
   - This is the same approach used for SNARK proving (native CLI, not browser WASM)

4. **Crypto Porting Verification**:
   - All crypto functions ported from Python `src/*.py` files
   - Domain tags match Python constants exactly (hex-encoded UTF-8)
   - Schnorr and binding proofs follow Fiat-Shamir transform pattern
   - ECIES uses WebCrypto API for AES-GCM (browser-native, fast)

   **CRITICAL: G1 vs G2 Point Types**:
   - H1, H2, H3 in `constants.ts` are **G2 points** (192 hex chars = 96 bytes compressed)
   - The Python `combine()` and `scale()` functions auto-detect point type by length
   - In TypeScript, use the generic `combine()` function, NOT `combineG1()` explicitly
   - Example fix in `createEncryption.ts`:
     ```typescript
     // WRONG - will throw "invalid G1 point: expected 48/96 bytes"
     const c = combineG1(combineG1(scale(H1, aCoeff), scale(H2, bCoeff)), H3);

     // CORRECT - combine() auto-detects G1 (96 chars) vs G2 (192 chars)
     const c = combine(combine(scale(H1, aCoeff), scale(H2, bCoeff)), H3);
     ```
   - The `r4` field in `HalfLevel` is a **G2 point** (192 hex chars), not G1 as originally documented
   - Python docstrings in `level.py` also incorrectly say r4 is G1 - the Plutus contract just stores bytes

5. **Wallet Secret Derivation (sk)** - IMPLEMENTED in `walletSecret.ts`:
   - The Python CLI uses `extract_key(wallet_path)` to read signing key from disk
   - CIP-30 browser wallets do NOT expose private keys (security requirement)
   - **Solution**: Derive `sk` from a wallet signature using `signData()`:
     ```typescript
     // fe/src/services/crypto/walletSecret.ts
     const KEY_DERIVATION_MESSAGE = 'PEACE_PROTOCOL_v1';

     export async function deriveSecretFromWallet(wallet: IWallet): Promise<bigint> {
       const addresses = await wallet.getUsedAddresses();
       const address = addresses[0]; // Always use first address for consistency
       // MeshJS signData signature: signData(payload, address) - payload first!
       // MeshJS internally converts payload from UTF-8 to hex via fromUTF8()
       const signedData = await wallet.signData(KEY_DERIVATION_MESSAGE, address);
       // Include address in hash derivation for binding
       const sk = toInt(generate(KEY_DOMAIN_TAG + signedData.signature + stringToHex(address)));
       return sk;
     }
     ```
   - **CRITICAL: MeshJS signData argument order**: `signData(payload, address)` NOT `signData(address, payload)`.
     If reversed, MeshJS will try to parse the payload as a bech32 address and fail.
   - **CRITICAL: MeshJS handles hex encoding**: Pass raw UTF-8 string, not hex-encoded.
     MeshJS internally calls `fromUTF8(payload)` to convert to hex.
   - **Key design decision**: Message is simple `PEACE_PROTOCOL_v1` to avoid wallet parsing issues.
     Some wallets try to parse hex payload as address and fail checksum validation.
     Address is included in the final hash derivation instead for binding.
   - **Security properties**:
     - Deterministic: same wallet + same message = same `sk`
     - Only wallet holder can produce the signature
     - User must explicitly approve in wallet UI
     - Ed25519 signatures are not malleable
     - Address bound in derivation: different addresses → different `sk`
   - **UX impact**: User sees signature popup when creating listing
   - **Important**: Always use the same address (first used/unused address) for consistency

6. **Three Secrets in Encryption**:
   | Secret | Source | Stored in IndexedDB? | Purpose |
   |--------|--------|---------------------|---------|
   | `sk` | Wallet signature derivation | No (re-derivable) | Spending/register key |
   | `a` | Random `rng()` | Yes | Re-encryption, SNARK witness |
   | `r` | Random `rng()` | Yes | Re-encryption, half-level |

7. **Dashboard Integration**:
   - "Create Listing" button added to Dashboard nav bar
   - Modal opens on click, closes on cancel/success
   - Toast notifications for success/error feedback
   - MySalesTab empty state includes "Create Listing" button

8. **What Works in Stub Mode**:
   - ✅ Form UI with all fields and validation
   - ✅ Wallet signing for `sk` derivation (CIP-30 signData)
   - ✅ BLS12-381 key generation (sk, a, r → register)
   - ✅ Schnorr and binding proof generation
   - ✅ ECIES encryption of message
   - ✅ Secret storage in IndexedDB (a, r stored; sk re-derivable from wallet)
   - ✅ Toast notifications
   - ⚠️ `gt_to_hash` returns stub data (see blocker above)
   - ❌ Transaction submission (requires deployed contracts)

9. **Testing the Crypto**:
   - **With wallet (recommended)**: Use the Create Listing modal with a connected wallet.
     User will see a signature popup → approve → creates encryption artifacts.
   - **Without wallet (dev testing)**:
     ```typescript
     // In browser console or test file:
     import { createEncryptionArtifacts } from './services/crypto/createEncryption';

     const walletSecretHex = 'deadbeef'.repeat(8); // 32 bytes fake secret
     const result = await createEncryptionArtifacts(
       walletSecretHex,
       'secret message',
       'a'.repeat(64), // fake token name
       true // useStubs for gt_to_hash
     );
     console.log('Register:', result.register);
     console.log('Schnorr proof:', result.schnorr);
     console.log('Capsule:', result.capsule);
     // Note: kem uses stub gt_to_hash until native CLI is available
     ```

---

### Phase 10: Place Bid Flow (COMPLETED - Stub Mode)

- [x] Create bid form/modal
- [x] Build bid transaction
- [x] Sign and submit (stub mode - actual submission blocked until contract deployment)
- [x] Show success/error feedback
- [x] Refresh bids
- [x] Cancel bid functionality (stub mode)

**Phase 10 Implementation Hints:**

1. **File Structure** (mirror Phase 9 pattern):
   - Create `fe/src/components/PlaceBidModal.tsx` - Form modal for bid placement
   - Create `fe/src/services/crypto/createBid.ts` - Bid-specific crypto operations
   - Extend `fe/src/services/transactionBuilder.ts` with `placeBid()` function

2. **Bid Form Fields**:
   ```typescript
   interface PlaceBidFormData {
     encryptionTokenName: string;  // Which encryption to bid on (from listing)
     bidAmount: number;            // ADA amount for bid
   }
   ```

3. **Crypto Operations for Bid** (CORRECTED):
   - Bidder derives secret `b` from wallet signature (same as seller's `sk` derivation)
   - Uses `deriveSecretFromWallet()` which prompts wallet signing popup
   - Bidder's public key `B = [b]G1` is included in bid datum as `owner_g1`
   - **Schnorr proof IS required** - `BidMintRedeemer` has `EntryBidMint(SchnorrProof)`
   - **No ECIES encryption needed** - bidder doesn't encrypt anything
   - Reference: `commands/05_createBidTx.sh` and `src/commands.py::create_bidding_tx()`

4. **Bid Datum Structure** (from `contracts/lib/types/bid.ak`):
   ```typescript
   interface BidDatum {
     owner_vkh: string;      // Bidder's payment key hash
     owner_g1: string;       // Bidder's G1 public key (B = b·G1)
     encryption_token: string; // Token name of encryption being bid on
     // Bid amount is in the UTxO value, not datum
   }
   ```

5. **Secret Storage for Bidders**:
   - Store bidder's secret `b` in IndexedDB (similar to seller's a, r)
   - Key by bid token name
   - Needed later for decryption after seller accepts bid
   - Extend `secretStorage.ts` or create `bidSecretStorage.ts`

6. **Integration Points**:
   - PlaceBidModal opens from `MarketplaceListingCard` "Place Bid" button
   - On success, add bid to `MyPurchasesTab` (refresh bids)
   - Toast notification on success/error

7. **Transaction Building Pattern** (CORRECTED):
   ```typescript
   // Step 1: Derive bidder secret from wallet (prompts signing popup)
   const artifacts = await createBidArtifactsFromWallet(wallet);
   // artifacts contains: b (secret), register (g, u), schnorr proof, plutusJson

   // Step 2: Store secret BEFORE tx submission
   await storeBidSecrets(bidTokenName, encryptionTokenName, artifacts.b);

   // Step 3: Build datum (actual structure from bidding.ak)
   const datum = {
     owner_vkh: extractPkh(bidderAddress),
     owner_g1: artifacts.plutusJson.register,  // Register type
     pointer: encryptionTokenName,             // NOT "encryption_token"
     token: bidTokenName,                      // Bid's own token name
   };

   // Step 4: Build mint redeemer with Schnorr proof
   const mintRedeemer = { EntryBidMint: artifacts.plutusJson.schnorr };

   // Step 5: Build transaction
   // - Mint bid token with Schnorr proof redeemer
   // - Send bid token + ADA to contract with datum
   // - Reference: commands/05_createBidTx.sh
   ```

8. **Key Differences from Phase 9** (CORRECTED):
   - Same secret derivation pattern (wallet signing → `deriveSecretFromWallet()`)
   - Schnorr proof IS required (for mint redeemer)
   - No ECIES encryption, no binding proof
   - Only one secret to store (`b` vs `a` and `r`)
   - Bid amount is in UTxO value, not datum
   - No CIP-20 metadata typically needed

9. **Files to Reference**:
   - `commands/05_createBidTx.sh` - Transaction structure
   - `src/commands/create_bid.py` - Crypto logic (minimal)
   - `contracts/lib/types/bid.ak` - Datum type definition

10. **Cancel Bid (Phase 10 bonus)**:
    - Add "Cancel Bid" button to `MyPurchasesTab` for pending bids
    - Reference: `commands/06_removeBidTx.sh`
    - Remove bid secrets from IndexedDB on successful cancellation

11. **Reuse from Phase 9**:
    - `bls12381.ts` - `rng()`, `g1Point()` for keypair generation
    - `secretStorage.ts` pattern for storing bidder's `b` secret
    - `transactionBuilder.ts` pattern for stub mode
    - `Toast.tsx` for notifications
    - Modal pattern from `CreateListingModal.tsx`

12. **No `gt_to_hash` Blocker**:
    - Bidders don't need `gt_to_hash` - that's only for seller's encryption
    - Bidders only generate a simple G1 public key
    - Phase 10 can be fully completed in stub mode (minus tx submission)

**Phase 10 Implementation Notes (for future phases):**

1. **Files Created**:
   - `fe/src/components/PlaceBidModal.tsx` - Form modal for bid placement with amount input, quick bid buttons, listing details display
   - `fe/src/services/crypto/createBid.ts` - Bid-specific crypto operations (keypair + Schnorr proof generation)
   - `fe/src/services/bidSecretStorage.ts` - IndexedDB storage for bidder secrets (b scalar)

2. **Files Modified**:
   - `fe/src/services/transactionBuilder.ts` - Added `placeBid()` and `cancelBid()` functions
   - `fe/src/services/crypto/index.ts` - Exported new createBid functions
   - `fe/src/pages/Dashboard.tsx` - Integrated PlaceBidModal, updated handlers

3. **Bid Crypto Flow** (matches Python `create_bidding_tx`):
   - Bidder's secret `b` is derived from wallet signature via `deriveSecretFromWallet()`
   - This prompts the wallet signing popup (same as seller's Create Listing flow)
   - Uses `KEY_DOMAIN_TAG` for domain separation (same as seller)
   - Register created: `g` = G1 generator, `u` = [b]G1
   - Schnorr proof generated to prove knowledge of `b`
   - Secret `b` stored in IndexedDB by bid token name (for later decryption if bid wins)
   - **Note**: Same wallet = same `b` for all bids (deterministic, recoverable)

4. **IndexedDB Schema Update**:
   - Database version incremented to 2
   - New object store: `bidder-secrets` with keyPath `bidTokenName`
   - Index on `encryptionTokenName` for lookup by encryption
   - Index on `createdAt` for management

5. **BidDatum Structure** (actual vs hints):
   The actual `bidding.ak` type has different field names than Phase 10 hints:
   ```typescript
   // Actual structure from contracts/lib/types/bidding.ak:
   interface BidDatum {
     owner_vkh: VerificationKeyHash;  // Bidder's payment key hash
     owner_g1: Register;              // Bidder's G1 public key register
     pointer: AssetName;              // Encryption token being bid on (was "encryption_token" in hints)
     token: AssetName;                // Bid token name (additional field)
   }
   ```

6. **Mint Redeemer Requires Schnorr Proof**:
   The hints incorrectly stated "no proofs needed". The actual `BidMintRedeemer` requires:
   ```
   EntryBidMint(SchnorrProof)  // Proof of knowledge of bidder's secret
   ```
   This is implemented in `createBid.ts` using the existing `schnorrProof()` function.

7. **UI Features Implemented**:
   - Quick bid buttons (Suggested price, +10%, +25%)
   - Minimum bid validation (2 ADA to cover UTxO minimum)
   - Listing details panel showing token, seller, suggested price, description
   - Info box explaining what happens when placing a bid
   - Cancel bid functionality with secret cleanup from IndexedDB

8. **Stub Mode Behavior**:
   - Generates real cryptographic artifacts (keypair, Schnorr proof)
   - Stores secrets in IndexedDB (persists across sessions)
   - Returns fake txHash for UI testing
   - Simulates 1.5s transaction delay
   - No actual blockchain interaction

9. **What's Still Blocked Until Contract Deployment**:
   - Real transaction submission
   - Reference script UTxO lookups
   - Bid token minting on-chain
   - PKH extraction from wallet address (MeshJS can do this, just not tested with contracts)

10. **Wallet-Derived Secrets** (CORRECTED - matches Python implementation):
    Phase 10 now uses wallet-derived secrets via `deriveSecretFromWallet()`, matching the Python `create_bidding_tx()`:
    - Same derivation as seller: `sk = toInt(generate(KEY_DOMAIN_TAG + signature))`
    - Same wallet always produces same bidding identity (deterministic)
    - All bids from same wallet share the same `owner_g1` register
    - Secret is recoverable by signing again with same wallet
    - **Important**: Seller and bidder use same `KEY_DOMAIN_TAG`, so same wallet produces same secret scalar for both roles
    - `createBidArtifacts()` (random version) still exists but is not used in production flow

---

### Phase 11: SNARK Integration (BLOCKED - Go Lacks Memory64 Support)

**This is the most complex phase. See `snark/browser-support.md` for details.**

**⚠️ PERMANENTLY BLOCKED FOR BROWSER-BASED PROVING**: After extensive research (January 2026), Go does not support WebAssembly memory64. The `GOWASM` environment variable only accepts `satconv` and `signext` - there is no `memory64` option. This means browser-based SNARK proving is not feasible for this circuit size. See item 18 below for full details and recommended alternatives.

- [x] Set up WASM loading infrastructure
- [x] Implement IndexedDB caching for pk.bin/ccs.bin
- [x] Create download progress UI
- [x] Create Web Worker for SNARK proving
- [x] Implement proving interface
- [x] Create WASM entry point (`snark/wasm_main.go`)
- [x] Compile and deploy prover.wasm (~19MB)
- [x] **VERIFIED: Setup loading completes** (~2.3 hours in Web Worker)
- [x] **VERIFIED: Constraint solver works** (21 seconds after setup)
- [x] **BLOCKED: Proof generation hits 4GB WASM memory limit** (see item 18 below)
- [x] **CONFIRMED: Go does not support memory64** - no solution available
- [ ] Build SNARK transaction (BLOCKED: requires contract deployment)
- [x] Handle proving errors gracefully

```typescript
// Web Worker setup
const worker = new Worker(new URL('./snarkWorker.ts', import.meta.url));

worker.postMessage({
  type: 'prove',
  secretA: '...',
  secretR: '...',
  publicInputs: { v: '...', w0: '...', w1: '...' }
});

worker.onmessage = (e) => {
  if (e.data.type === 'proof') {
    // Continue with transaction
  }
};
```

**Phase 11 Implementation Notes (for future phases):**

1. **Files Created**:
   - `fe/src/services/snark/storage.ts` - IndexedDB caching for large SNARK files
   - `fe/src/services/snark/worker.ts` - Web Worker for SNARK proving
   - `fe/src/services/snark/prover.ts` - High-level prover API
   - `fe/src/services/snark/index.ts` - Module exports
   - `fe/src/components/SnarkDownloadModal.tsx` - Download progress modal
   - `fe/src/components/SnarkProvingModal.tsx` - Proving progress modal
   - `fe/src/hooks/useSnarkProver.ts` - React hook for prover integration
   - `fe/public/snark/wasm_exec.js` - Go WASM runtime (copied from Go installation)
   - `fe/public/snark/prover.wasm` - WASM prover binary (from `app/snark/`)

2. **SNARK Files Location**:
   - Circuit files are stored in `app/circuit/` (NOT in git due to size):
     - `pk.bin` (~613 MB) - Proving key
     - `ccs.bin` (~85 MB) - Constraint system
     - `vk.bin` (2.7 KB) - Verifying key (not needed in browser)
     - `vk.json` (5.5 KB) - Verifying key in JSON format
   - These files are cached in IndexedDB after first download

3. **Stub Mode**:
   - Set `VITE_USE_STUBS=true` in `.env` for development without real SNARK proving
   - Stub mode simulates proving with configurable delay (default 3 seconds)
   - Returns placeholder proof data for UI development

4. **Usage Pattern**:
   ```typescript
   import { getSnarkProver } from '@/services/snark'

   const prover = getSnarkProver()

   // Check if files need download
   const { cached } = await prover.checkCache()

   // Download if needed (shows progress modal)
   if (!cached) {
     await prover.ensureFilesDownloaded((progress) => {
       console.log(`${progress.stage}: ${progress.percent}%`)
     })
   }

   // Generate proof
   const proof = await prover.generateProof({
     secretA: '0x123...',  // Decimal or hex string
     secretR: '0x456...',
     publicV: 'compressed_g1_hex',   // 96 chars
     publicW0: 'compressed_g1_hex',  // 96 chars
     publicW1: 'compressed_g1_hex',  // 96 chars
   })
   ```

5. **React Hook Usage**:
   ```typescript
   import { useSnarkProver } from '@/hooks/useSnarkProver'

   function MyComponent() {
     const {
       isReady,
       isCached,
       isProving,
       progress,
       error,
       generateProof,
     } = useSnarkProver()

     // Use in component...
   }
   ```

6. **WASM Entry Point (IMPLEMENTED)**:
   The Go WASM entry point is implemented in `snark/wasm_main.go` with build tag `//go:build js && wasm`.

   **Exposed JavaScript functions:**
   - `gnarkLoadSetup(ccsBytes, pkBytes)` - Load CCS and PK into memory
   - `gnarkProve(secretA, secretR, publicV, publicW0, publicW1)` - Generate proof
   - `gnarkIsReady()` - Check if setup is loaded

   **Building the WASM:**
   ```bash
   cd app/snark
   GOOS=js GOARCH=wasm go build -o prover.wasm .
   cp prover.wasm ../ui/fe/public/snark/
   ```

   **Input format for secrets (a, r):**
   - Accepts both hex (`0x123...`) and decimal (`12345...`) strings
   - Uses `big.Int.SetString(str, 0)` which auto-detects base
   - `a` must be non-zero; `r` can be zero

7. **File Serving for Development**:
   For local development with the large circuit files, you have two options:

   a. **Copy to public directory** (simplest):
      ```bash
      cp app/circuit/pk.bin app/ui/fe/public/snark/
      cp app/circuit/ccs.bin app/ui/fe/public/snark/
      ```

   b. **Serve from separate location**:
      Configure `circuitFilesUrl` in prover config to point to a file server serving `app/circuit/`

8. **Memory Requirements**:
   - SNARK proving requires ~2+ GB memory
   - Desktop browsers only (mobile not supported)
   - Chrome recommended for best WASM performance

9. **Download UX**:
   - First-time download shows modal with ~698 MB total
   - Progress shows for each file individually
   - Files cached in IndexedDB for return visits
   - Download modal only appears when user initiates an action that needs SNARK (accepting a bid)

10. **Error Handling**:
    - Download failures show retry button
    - Proving failures show error message with retry option
    - Tab close warning during proving (beforeunload event)
    - 5-minute timeout for proving operations

11. **Files Added to .gitignore**:
    ```
    # SNARK proving files (too large for git - ~720MB total)
    public/snark/pk.bin
    public/snark/ccs.bin
    public/snark/prover.wasm
    ```

12. **CRITICAL: Performance Issues Discovered**:
    Testing revealed severe performance issues with WASM proving that need to be addressed:

    **Native vs WASM performance:**
    - Native Go binary: ~4 minutes for full prove cycle (uses all CPU cores)
    - WASM in browser: Setup loading alone takes 10+ minutes (single-threaded)

    **Root cause:**
    The `gnarkLoadSetup` function deserializes ~720MB of cryptographic data structures:
    - Parsing millions of BLS12-381 field elements
    - Reconstructing polynomial commitments
    - Building constraint system matrices
    - WASM is typically 2-5x slower than native for CPU-bound work
    - WASM runs single-threaded (cannot parallelize like native Go)
    - Main thread blocking causes browser throttling, making it worse

    **Test page created:**
    `fe/public/snark/test.html` - Simple main-thread test page for debugging.
    This page causes browser "unresponsive script" warnings because it runs everything
    on the main thread. The Web Worker-based React integration should perform better
    since it doesn't block the main thread.

    **TESTING STATUS: BLOCKED BY MEMORY LIMIT**
    - [x] WASM compiles successfully (~19MB prover.wasm)
    - [x] Test page loads WASM and displays console messages
    - [x] Detailed logging added to track setup progress
    - [x] Setup loading completes (~2.3 hours in Web Worker)
    - [x] Constraint solver works (21 seconds)
    - [ ] **BLOCKED**: Proof generation fails at 4GB WASM memory limit
    - [x] Web Worker integration tested (keeps UI responsive)

    **See item 18 below for Memory64 investigation notes.**

    **Design Decision: Local-Only Proving**
    Server-side proving was considered but rejected to maintain PEACE protocol's
    decentralization principles. Keeping secrets local ensures:
    - Trustlessness (no server to trust with secrets)
    - Decentralization (no central point of failure)
    - Security (no attack vectors from secret transmission)

    Users will experience a 10-30+ minute wait, but this is acceptable for a
    decentralized protocol. The Web Worker keeps UI responsive during the wait.

    **Next steps when revisiting:**
    1. **PRIORITY: Investigate Memory64 (wasm64) support** - See item 18 below
       - Current wasm32 hits 4GB limit during proof generation
       - Memory64 allows up to 16GB which should be sufficient
       - Need to check Go + gnark compatibility with GOWASM=memory64
    2. If Memory64 works, test full proof generation end-to-end
    3. Consider UX improvements (only relevant once proving works):
       - Pre-loading setup during idle time after wallet connect
       - Showing estimated time (2+ hours) prominently in UI
       - "Start proving, come back later" messaging
    4. The native CLI proves in ~4 minutes using all cores; WASM is single-threaded

13. **Manual Test Page** (`fe/public/snark/test.html`):
    A simple HTML page for testing the WASM prover directly:
    ```
    http://localhost:5173/snark/test.html
    ```

    **Features:**
    - Timer showing elapsed time during loading
    - Console output panel capturing Go WASM messages
    - Clear warnings about expected browser freeze
    - Step-by-step progress logging from Go code

    **Warning:** This page runs on the main thread and will freeze the browser
    during the ~720MB file loading + parsing phase. Expect browser "unresponsive"
    warnings. Click "Wait" and be patient (or test the React integration instead).

14. **Browser "Page Unresponsive" Dialog Behavior**:
    When the browser shows the "Page Unresponsive" (or "Wait or Kill") dialog:

    - **The JavaScript execution is PAUSED** while the dialog is showing
    - **Click "Wait"** to resume execution from where it paused
    - **If you click "Kill Page"**, the script is terminated and loading will fail
    - **Loading does NOT continue in the background** while the dialog is open
    - You may need to click "Wait" multiple times (every ~5-10 seconds)

    This is a fundamental limitation of main thread blocking. The Web Worker
    approach should eliminate these dialogs entirely since the work happens
    off the main thread.

15. **WASM Logging for Debugging**:
    The Go WASM code (`snark/wasm_main.go`) now includes detailed step-by-step logging:

    ```
    [WASM] wasmLoadSetup called with CCS=88829891 bytes, PK=642235779 bytes
    [WASM] Step 1/4: Creating constraint system object...
    [WASM] Step 1/4: Done. Constraint system object created.
    [WASM] Step 2/4: Deserializing CCS (88829891 bytes)... This may take several minutes.
    [WASM] (If browser shows 'unresponsive' dialog, click 'Wait' - do NOT close the tab)
    [WASM] Step 2/4: Done. CCS deserialized successfully.
    [WASM] Step 3/4: Creating proving key object...
    [WASM] Step 3/4: Done. Proving key object created.
    [WASM] Step 4/4: Deserializing PK (642235779 bytes)... This is the longest step.
    [WASM] (The proving key contains millions of elliptic curve points to deserialize)
    [WASM] Step 4/4: Done. PK deserialized successfully.
    [WASM] Setup complete! Ready to generate proofs.
    ```

    This helps identify exactly where the process is getting stuck or timing out.

    To rebuild WASM with logging changes:
    ```bash
    cd app/snark
    GOOS=js GOARCH=wasm go build -o ../ui/fe/public/snark/prover.wasm .
    ```

16. **Web Worker Test Page** (`fe/public/snark/test-worker.html`):
    This test page uses a Web Worker to run the prover, which should keep the UI responsive:
    ```
    http://localhost:5173/snark/test-worker.html
    ```

    **Expected behavior:**
    - Timer continues updating during loading (UI not frozen)
    - Console shows progress messages from the worker
    - No "Page Unresponsive" dialogs
    - Loading still takes 10-30+ minutes (but runs in background)

    **Key difference from test.html:**
    - `test.html` runs on main thread → browser freezes → "Wait" dialogs
    - `test-worker.html` runs in Web Worker → UI stays responsive → no dialogs

    **How it works:**
    1. Downloads ccs.bin (~85MB) and pk.bin (~613MB)
    2. Creates a Web Worker with inline JavaScript
    3. Transfers the ArrayBuffers to the worker (zero-copy)
    4. Worker loads WASM and calls `gnarkLoadSetup()`
    5. Main thread stays responsive while worker does the heavy lifting

17. **Worker Integration Fixed** (`fe/src/services/snark/worker.ts`):
    The worker now correctly calls `gnarkLoadSetup(ccsBytes, pkBytes)` to load the
    proving keys into the WASM module before proof generation. Key fixes:
    - Added `gnarkLoadSetup` and `gnarkIsReady` function declarations
    - Removed incorrect pkData/ccsData parameters from `gnarkProve`
    - Added detailed logging at each step
    - Properly converts ArrayBuffer to Uint8Array for WASM

    **Testing the React integration:**
    The SnarkProver class in `fe/src/services/snark/prover.ts` uses this worker.
    To test in the full app, set `VITE_USE_STUBS=false` and trigger a "Accept Bid" flow.

18. **CRITICAL: 4GB WASM Memory Limit - PERMANENTLY BLOCKED**

    **Problem Discovered:**
    After successful setup loading (~2.3 hours in Web Worker), proof generation fails with:
    ```
    runtime: out of memory: cannot allocate 8388608-byte block (4264493056 in use)
    fatal error: out of memory
    ```

    The WASM used ~4.26 GB and couldn't allocate another 8MB. This is a **hard browser limit**
    for 32-bit WebAssembly, regardless of system RAM (tested on 62GB RAM machine).

    **Timeline of successful test:**
    - Setup loading completed in ~2.3 hours (8402 seconds)
    - Constraint system solver completed successfully (21 seconds)
    - Proof generation started but hit memory limit during the actual proving phase

    **Root Cause:**
    - 32-bit WebAssembly (wasm32) has a hard 4GB memory limit due to 32-bit addressing
    - Go compiles to wasm32 by default
    - The gnark Groth16 prover for 1.6M constraints requires >4GB for the proving phase
    - Native Go CLI works fine because it can use all system RAM

    **Memory64 Investigation (January 2026) - NO SOLUTION AVAILABLE**

    WebAssembly Memory64 would theoretically solve this by extending to 64-bit addressing:

    | WASM Type | Max Memory | Browser Support |
    |-----------|------------|-----------------|
    | wasm32 (current) | 4GB | All browsers |
    | wasm64 (Memory64) | 16GB | Chrome, Firefox (not Safari) |

    **However, Go does NOT support memory64:**

    | Compiler | Memory64 Support | gnark Compatible | Notes |
    |----------|------------------|------------------|-------|
    | Go (1.25.6) | **NO** | Yes | GOWASM only supports `satconv`, `signext` |
    | TinyGo | **NO** | Partial | Missing reflect features gnark needs |
    | Emscripten | Yes | N/A | C/C++ only, not Go |
    | Rust/LLVM | Yes | N/A | Would need arkworks reimplementation |

    **Research Findings:**
    - `go help environment | grep GOWASM` shows only `satconv` and `signext` as valid values
    - There is no `memory64` option in Go's WASM compilation
    - Go issue [#63131](https://github.com/golang/go/issues/63131) discusses wasm32/wasm64 but focuses on server-side wasip1, not browser js/wasm
    - No timeline exists for Go to add memory64 support for js/wasm target
    - [Vocdoni's research](https://hackmd.io/@vocdoni/B1VPA99Z3) shows gnark browser proving works for ~48K constraints, but our circuit has 1.6M constraints (33x larger)

    **References:**
    - V8 Blog: https://v8.dev/blog/4gb-wasm-memory
    - Go WASM issue: https://github.com/golang/go/issues/63131
    - Vocdoni gnark WASM research: https://hackmd.io/@vocdoni/B1VPA99Z3

    **Recommended Path Forward:**

    Since browser-based SNARK proving is not feasible, use one of these alternatives:

    1. **Native CLI Prover (RECOMMENDED)**
       - Already works: `app/snark/snark_cli` proves in ~4 minutes
       - Users download and run locally
       - Web UI can provide instructions and verify proof output
       - Maintains trustlessness (secrets never leave user's machine)

    2. **Desktop App (Electron/Tauri)**
       - Bundle native Go binary with web UI
       - Same UX as browser, but runs natively
       - More engineering effort but seamless experience

    3. **Wait for Go Memory64 Support**
       - No timeline exists
       - Check periodically for updates to Go issue #63131

    4. **Circuit Optimization**
       - Reduce constraint count below ~500K (major undertaking)
       - Would require cryptographic redesign

    **Test Values for Verification:**
    When testing the native CLI, use these known-good values from `tests/test_snark.py`:
    ```
    a = 44203
    r = 12345
    v  = 821285b97f9c0420a2d37951edbda3d7c3ebac40c6f194faa0256f6e569eba49829cd69c27f1dd9df2dd83bac1f5aa49
    w0 = b38f50ffcc8c468430e624dc8bd1415011a05b96d0898167ffdf004d2c6f055bc38ed8af069bacda62d908d821623941
    w1 = 8ac69bdd182386def9f70b444794fa6d588182ddaccdffc26163fe415424ec374c672dfde52d875863118e6ef892bbac
    ```
    These values produce a valid proof in the native CLI (~4 minutes).

    **Current Status:**
    - [x] Setup loading works (2+ hours but completes)
    - [x] Constraint solver works
    - [x] **CONFIRMED BLOCKED**: Proof generation fails at 4GB memory limit
    - [x] **CONFIRMED**: Go does not support memory64 (no GOWASM option exists)
    - [x] **DECISION**: Use native CLI prover as primary solution

19. **Notes for AI/Developers Implementing CLI Integration (Phase 11 Continuation):**

    Since browser WASM proving is permanently blocked, here's how to implement native CLI integration:

    **A. CLI Prover Binary Location:**
    - `app/snark/snark_cli` - The native Go binary that works
    - Build with: `cd app/snark && go build -o snark_cli .`
    - Pre-built binaries should be hosted for download (Linux x64, Windows x64, macOS arm64/x64)

    **B. CLI Interface:**
    ```bash
    ./snark_cli prove -a <secret_a> -r <secret_r> \
        -v <public_v_hex> -w0 <public_w0_hex> -w1 <public_w1_hex> \
        -ccs /path/to/ccs.bin -pk /path/to/pk.bin \
        -out proof.json
    ```

    **C. Web UI Flow for Accept Bid:**
    ```typescript
    // 1. User clicks "Accept Bid"
    // 2. Retrieve seller secrets (a, r) from IndexedDB
    const secrets = await getSecrets(encryption.tokenName);

    // 3. Get public inputs from encryption datum
    const publicInputs = {
      v: encryption.datum.v,
      w0: encryption.datum.w0,
      w1: encryption.datum.w1,
    };

    // 4. Show CLI instructions modal with:
    //    - Download links for CLI binary (platform-specific)
    //    - Download links for circuit files (ccs.bin, pk.bin)
    //    - Command to run (with secrets and public inputs)
    //    - Note: Secrets a, r should be shown as hex strings
    //    - Expected output: proof.json

    // 5. User runs CLI locally (takes ~4 minutes)

    // 6. User uploads proof.json to web UI

    // 7. Parse and validate proof structure
    const proof = parseProofJson(uploadedFile);

    // 8. Continue with SNARK transaction building
    // ... rest of Phase 12 flow
    ```

    **D. CLI Instructions Modal Needs:**
    - Platform detection (show correct download link)
    - Copy-to-clipboard for the CLI command
    - File upload input for proof.json
    - Progress indicator while validating proof
    - Error messages if proof format is invalid

    **E. Proof JSON Format:**
    The CLI outputs proof in Plutus-compatible JSON format:
    ```json
    {
      "ar": "<G1 point hex>",
      "bs": "<G2 point hex>",
      "krs": "<G1 point hex>"
    }
    ```

    **F. Security Considerations:**
    - Secrets (a, r) NEVER leave the browser (shown to user, user copies to CLI)
    - Consider: Show secrets in hex format with "Copy" button
    - Consider: Auto-generate CLI command with all parameters
    - Consider: Warning about not sharing the CLI command (contains secrets)

    **G. Alternative: Electron/Tauri Desktop App:**
    For better UX, package the CLI + web UI in a desktop app:
    - Electron: Mature, larger bundle size
    - Tauri: Smaller, uses native webview
    - Could run CLI in background without user interaction

---

### Phase 12: Accept Bid Flow (SNARK + Re-encryption)

**BLOCKED until contracts are deployed to preprod.** Additionally, browser-based SNARK proving is not feasible due to Go's lack of memory64 support (see Phase 11 item 18). The Accept Bid flow will need to integrate with the native CLI prover instead.

**Revised Approach (Native CLI Integration):**
Instead of in-browser WASM proving, the flow should:
1. Web UI provides download link for native `snark_cli` binary (platform-specific)
2. User runs CLI locally with their secrets (a, r) and public inputs (v, w0, w1)
3. CLI outputs proof JSON file
4. User uploads proof JSON back to web UI
5. Web UI builds and submits SNARK transaction with the uploaded proof

This maintains trustlessness (secrets never transmitted) while working around the browser memory limit.

- [ ] Trigger SNARK proving modal
- [ ] Generate proof in Web Worker
- [ ] Build and submit SNARK tx
- [ ] Wait for confirmation
- [ ] Build and submit re-encryption tx
- [ ] Update UI state

**Phase 12 Implementation Hints (for AI/developers):**

1. **Complete Accept Bid Flow**:
   ```
   User clicks "Accept Bid"
   → Check if SNARK files are cached (if not, show SnarkDownloadModal)
   → Retrieve seller secrets (a, r) from IndexedDB
   → Get bid details (buyer's public key, amount)
   → Show SnarkProvingModal and generate proof
   → Build SNARK transaction (07a_createSnarkTx.sh pattern)
   → Submit SNARK tx and wait for confirmation
   → Build re-encryption transaction (07b_createReEncryptionTx.sh pattern)
   → Submit re-encryption tx
   → Show success modal with tx hashes
   ```

2. **Integrating SNARK Prover**:
   ```typescript
   import SnarkProvingModal from '../components/SnarkProvingModal'
   import type { SnarkProofInputs, SnarkProof } from '../services/snark'

   // In Dashboard.tsx, update handleAcceptBid:
   const [showSnarkModal, setShowSnarkModal] = useState(false)
   const [snarkInputs, setSnarkInputs] = useState<SnarkProofInputs | null>(null)

   const handleAcceptBid = useCallback(async (encryption: EncryptionDisplay, bid: BidDisplay) => {
     // 1. Get seller secrets from IndexedDB
     const secrets = await secretStorage.get(encryption.tokenName)
     if (!secrets) {
       showError('Seller secrets not found. Cannot complete sale.')
       return
     }

     // 2. Get buyer's public key from bid datum
     const buyerG1 = bid.ownerG1.public_value // Compressed G1 hex

     // 3. Prepare SNARK inputs
     setSnarkInputs({
       secretA: secrets.a,  // Decimal string
       secretR: secrets.r,  // Decimal string
       publicV: buyerG1,    // 96 hex chars
       publicW0: encryption.halfLevel.r2_g1b,  // From encryption datum
       publicW1: computeW1(secrets.a, secrets.r, buyerG1), // [a]q + [r]v
     })

     setShowSnarkModal(true)
   }, [])

   const handleProofGenerated = useCallback(async (proof: SnarkProof) => {
     // Continue with SNARK transaction building...
   }, [])
   ```

3. **SNARK Transaction Structure** (from 07a_createSnarkTx.sh):
   - Uses stake withdrawal for on-chain Groth16 verification
   - Requires validity interval (lower/upper bounds)
   - Updates encryption datum status to Pending with TTL
   - MeshJS may require low-level tx building for withdrawal pattern

   ```typescript
   // Key elements for SNARK tx:
   const snarkTx = {
     // Spend the encryption UTxO
     inputs: [encryptionUtxo],

     // Reference the groth script
     referenceInputs: [grothScriptRef],

     // Stake withdrawal for on-chain verification
     withdrawal: {
       address: grothStakeAddress,
       amount: rewardBalance, // Must match exactly
       redeemer: proof, // The generated SNARK proof
     },

     // Output back to encryption contract with Pending status
     outputs: [{
       address: encryptionContractAddress,
       assets: [{ policyId, tokenName }],
       datum: {
         ...existingDatum,
         status: {
           type: 'Pending',
           groth_public: proof.publicInputs, // 36 field elements
           ttl: Date.now() + 20 * 60 * 1000, // 20 minute TTL
         },
       },
     }],

     // Validity interval
     validityInterval: {
       invalidBefore: currentSlot,
       invalidAfter: currentSlot + 300, // ~5 minutes
     },
   }
   ```

4. **Re-encryption Transaction** (from 07b_createReEncryptionTx.sh):
   - Burns the bid token
   - Updates encryption datum with FullEncryptionLevel
   - Transfers locked ADA to seller

5. **Seller Secret Storage**:
   Create `fe/src/services/secretStorage.ts` for storing seller secrets:
   ```typescript
   // Store secrets when creating encryption (Phase 9)
   await secretStorage.store(tokenName, { a, r })

   // Retrieve secrets when accepting bid (Phase 12)
   const secrets = await secretStorage.get(tokenName)

   // Clear after sale completion
   await secretStorage.remove(tokenName)
   ```

6. **Computing W1 Value**:
   W1 = [a]q + [r]V where V is buyer's public key
   ```typescript
   import { bls12_381 as bls } from '@noble/curves/bls12-381'

   function computeW1(a: string, r: string, V: string): string {
     const aBigInt = BigInt(a)
     const rBigInt = BigInt(r)
     const vPoint = bls.G1.ProjectivePoint.fromHex(V)

     const aQ = bls.G1.ProjectivePoint.BASE.multiply(aBigInt)
     const rV = vPoint.multiply(rBigInt)
     const w1 = aQ.add(rV)

     return w1.toHex(true) // Compressed
   }
   ```

7. **TTL Countdown**:
   After SNARK tx succeeds, show countdown timer:
   ```typescript
   const ttl = encryptionDatum.status.ttl
   const remaining = ttl - Date.now()
   const minutes = Math.floor(remaining / 60000)
   // Show: "Complete re-encryption within X minutes"
   ```

8. **Error Recovery**:
   - If SNARK tx fails: Allow retry
   - If re-encryption tx fails: Show "retry" or "cancel" options
   - If TTL expires: Must cancel and start over

### Phase 13: Decrypt Flow (COMPLETED - Stub Mode)

- [x] Query encryption history from Koios (stubbed)
- [x] Implement recursive decryption (port from Python - stubbed)
- [x] Display decrypted message
- [x] Handle decryption errors

**Phase 13 Implementation Notes (for future phases):**

1. **DecryptModal Component** (`fe/src/components/DecryptModal.tsx`):
   - Multi-state modal: idle, decrypting, success, error
   - Shows stub warning when in development mode
   - Copy-to-clipboard for decrypted content
   - Proper error handling with retry option

2. **Decryption Service** (`fe/src/services/crypto/decrypt.ts`):
   - `decryptBid()` - Main entry point for decryption flow
   - `canDecrypt()` - Validates if decryption can be attempted
   - `fetchEncryptionHistory()` - Stubbed Koios query
   - `computeKEM()` - Blocked - requires native snark binary
   - Stub messages map for development testing

3. **Critical Blocker - Real Decryption Requires Native Binary**:
   The Python `recursive_decrypt` function calls `decrypt_to_hash()` which invokes the
   `snark` CLI binary to compute BLS12-381 pairings and Fq12 hashing in gnark's format.

   **Why this can't be done in browser:**
   - BLS12-381 pairing operations are computationally expensive
   - The Fq12 element hashing MUST match gnark's exact encoding
   - @noble/curves doesn't expose pairing results in the required format
   - A backend service or WASM port of the decrypt operation would be needed

   **Options for production:**
   a) Backend API that runs the snark binary with user's derived sk
   b) WASM compilation of just the decrypt operation (simpler than full SNARK)
   c) Have user run CLI locally and paste the KEM value (poor UX)

4. **Stubbed Flow vs Real Flow**:
   ```
   STUB MODE (current):
   User clicks Decrypt -> Show stub message for that encryption token

   REAL MODE (requires contract deployment + backend):
   User clicks Decrypt ->
     1. Derive sk from wallet signature
     2. Query Koios for encryption token tx history
     3. Extract encryption levels from inline datums
     4. Call backend with (sk, levels) to compute KEM
     5. Backend runs: snark decrypt -r1 ... -g1b ... -shared ...
     6. Use returned KEM to decrypt capsule with ECIES
     7. Display decrypted message
   ```

5. **Bid Secrets Integration**:
   - Checks `getBidSecrets(bid.tokenName)` for stored bidder secret
   - Without bid secrets, decryption fails with clear error message
   - Warns user if secrets lost (browser data cleared, wrong device)

6. **Files Modified/Created**:
   - `fe/src/services/crypto/decrypt.ts` - New decryption service
   - `fe/src/services/crypto/index.ts` - Export decrypt functions
   - `fe/src/components/DecryptModal.tsx` - New modal component
   - `fe/src/pages/Dashboard.tsx` - Integrated decrypt modal

7. **Test Wallet Data for Decrypt Modal Testing**:
   A test bid was added to `be/src/stubs/bids.ts` for testing the decrypt flow:
   ```
   Address: addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds
   PKH: dd996ca1174aa2e32dbbad88046b440ff563a3cde0716a56865400c6
   Bid Token: 15bid006test78901234567890123456789012345678901234567890123456
   Encryption Token: 00abc123def456789012345678901234567890123456789012345678901234
   Status: accepted
   Amount: 150 ADA
   ```
   Connect with this wallet, go to My Purchases tab, and click "Decrypt" to test.

### Phase 14: Polish & Testing (COMPLETED - Stub Mode)

- [x] Error handling throughout (toast notifications)
- [x] Loading states throughout
- [x] Success modals with CardanoScan links
- [x] Unit tests for utils/services
- [x] React Error Boundary added
- [x] Accessibility improvements (aria-labels, keyboard nav)
- [ ] Manual E2E testing on Chrome with Eternl (blocked until contract deployment)
- [x] Mobile not required (desktop-focused for SNARK proving)

**Phase 14 Implementation Notes (Completed):**

1. **Toast System Enhanced**:
   - Added `toast.transactionSuccess(title, txHash)` method that includes CardanoScan link
   - Toast component now supports optional `action` with `href` or `onClick`
   - All transaction success handlers updated to use new method

2. **CardanoScan Links**:
   - Created `fe/src/utils/network.ts` with network detection and URL generation
   - Created `fe/src/components/TransactionLink.tsx` reusable component
   - Network auto-detected from subdomain (preprod.* vs www.*)
   - Links open in new tab with proper security attributes

3. **Loading States**:
   - `LoadingSpinner` updated with `role="status"` and `aria-label` for accessibility
   - All tabs have consistent loading states (MarketplaceTab, MySalesTab, MyPurchasesTab)
   - All modals have loading states during async operations

4. **Unit Testing Setup**:
   - Vitest configured in `vite.config.ts` with jsdom environment
   - Test setup file at `fe/src/test/setup.ts` with mocks
   - Tests created for:
     - `fe/src/utils/network.test.ts` - Network utilities (17 tests)
     - `fe/src/utils/clipboard.test.ts` - Clipboard utilities (4 tests)
     - `fe/src/services/crypto/__tests__/hashing.test.ts` - Hashing (18 tests)
     - `fe/src/services/crypto/__tests__/bls12381.test.ts` - BLS12-381 (26 tests)
   - Run with `npm run test` or `npm run test:watch`

5. **Error Boundaries**:
   - Created `fe/src/components/ErrorBoundary.tsx` with two variants:
     - `ErrorBoundary` - Full page fallback with retry/reload buttons
     - `InlineErrorBoundary` - Compact inline error display
   - App wrapped with ErrorBoundary in `main.tsx`

6. **Accessibility Improvements**:
   - All modals have `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
   - Close buttons have `aria-label="Close dialog"`
   - Decorative SVGs have `aria-hidden="true"`
   - View toggle buttons have `aria-pressed` state
   - Search inputs have `aria-label`
   - LoadingSpinner has `role="status"` and customizable `aria-label`

7. **Blocked Items**:
   - Full E2E testing requires contract deployment to preprod
   - Real transaction testing blocked until contracts available

### Phase 15: Local Development Setup (COMPLETED)

- [x] Create docker-compose for local testing
- [x] Document environment setup
- [x] Add seed scripts for test data (stub data already exists at `fe/src/dev/stubs/`)
- [x] Create README with setup instructions

**Phase 15 Notes (for AI implementing this phase):**

1. **Docker Compose Setup**:
   - Create `docker-compose.yml` at `ui/` root
   - Services needed:
     - `fe`: Vite dev server (port 5173)
     - `be`: Node.js backend (port 3001) - may not exist yet, check `ui/be/`
   - Use multi-stage Dockerfile for production builds
   - Volume mounts for hot reloading in development

2. **Environment Variables**:
   - Document all `VITE_*` variables in README
   - Key variables:
     - `VITE_USE_STUBS=true` - Enable stub data mode
     - `VITE_API_URL` - Backend API URL
     - `VITE_BLOCKFROST_PROJECT_ID_PREPROD` - Blockfrost API key
     - `VITE_SNARK_CDN_URL` - SNARK files location
   - Create `.env.example` with all variables documented

3. **Seed Scripts**:
   - Stub data already exists at `fe/src/dev/stubs/`
   - Consider creating CLI script to generate varied test data
   - Match stub data structure with real contract datum types
   - Include edge cases: empty listings, max bids, expired listings

4. **README Updates**:
   - Installation steps (npm install in both fe/ and be/)
   - Development workflow (`npm run dev`)
   - Testing workflow (`npm run test`)
   - Build process (`npm run build`)
   - Stub mode explanation
   - Known limitations (contracts not on preprod yet)

5. **Backend Considerations**:
   - Check if `ui/be/` has any actual implementation
   - If empty, note that backend is optional when using stubs
   - Document Koios/Blockfrost integration points for when contracts deploy

6. **SNARK Files**:
   - Document that SNARK proving is blocked by WASM 4GB memory limit
   - Note that `pk.bin` and `ccs.bin` are large files (~700MB total)
   - Consider documenting native CLI prover as alternative

7. **Browser Compatibility**:
   - Document Chrome-only support (best Cardano wallet integration)
   - Eternl wallet recommended for testing
   - Firefox/Safari may have wallet compatibility issues

---

## MeshJS Transaction Patterns

**Important Notes:**
- Always reference MeshJS documentation: https://meshjs.dev/apis/transaction
- Transaction building for Plutus V3 contracts can be complex
- The examples below are starting points; manual adjustments will likely be needed
- Test transaction building manually before integrating into UI
- MeshJS handles simulation automatically - `tx.build()` returns ready-to-sign CBOR

### Mint Token to Contract

```typescript
import { Transaction, resolveScriptHash } from '@meshsdk/core';

const policyId = resolveScriptHash(encryptionScript);
const tokenName = computeTokenName(utxo);

const tx = new Transaction({ initiator: wallet })
  .mintAsset(encryptionScript, {
    assetName: tokenName,
    assetQuantity: '1',
    recipient: encryptionContractAddress,
    metadata: {},
  })
  .setTxInputs([...userUtxos])
  .setCollateral([collateralUtxo])
  .setRequiredSigners([userPkh, collateralPkh]);

// Add inline datum
tx.txBuilder.tx_builder.add_output(
  createOutputWithDatum(encryptionContractAddress, lovelace, datum)
);
```

### Spend from Contract + Mint

```typescript
const tx = new Transaction({ initiator: wallet })
  .redeemValue({
    value: encryptionUtxo,
    script: encryptionScript,
    redeemer: { data: spendRedeemer },
  })
  .mintAsset(biddingScript, { /* burn asset */ }, burnRedeemer)
  .sendAssets(encryptionContractAddress, assets, { inline: true, datum });
```

### Read-Only Reference

```typescript
const tx = new Transaction({ initiator: wallet });
tx.txBuilder.tx_builder.add_reference_input(referenceUtxo);
```

---

## API Endpoints (Backend)

### Encryptions

```
GET  /api/encryptions              # List all encryptions
GET  /api/encryptions/:tokenName   # Get specific encryption
GET  /api/encryptions/user/:pkh    # Get user's encryptions
```

### Bids

```
GET  /api/bids                     # List all bids
GET  /api/bids/:tokenName          # Get specific bid
GET  /api/bids/user/:pkh           # Get user's bids
GET  /api/bids/encryption/:tokenName  # Get bids for encryption
```

### Protocol Data

```
GET  /api/protocol/reference       # Get reference UTxO data
GET  /api/protocol/scripts         # Get script hashes/addresses
GET  /api/protocol/params          # Get protocol parameters
```

### Transactions (optional helpers)

```
POST /api/tx/submit                # Submit signed transaction (if not using wallet.submitTx)
```

**Note**: Transaction simulation is handled automatically by MeshJS during `tx.build()`. No separate simulation endpoint needed.

---

## Environment Variables

### Network Detection (Subdomain-based)

```typescript
// Detect network from subdomain
function getNetwork(): 'preprod' | 'mainnet' {
  const hostname = window.location.hostname;
  if (hostname.startsWith('preprod.')) return 'preprod';
  return 'mainnet';
}

// Get correct explorer URL
function getCardanoScanUrl(txHash: string): string {
  const network = getNetwork();
  const base = network === 'preprod'
    ? 'https://preprod.cardanoscan.io'
    : 'https://cardanoscan.io';
  return `${base}/transaction/${txHash}`;
}
```

### Frontend (.env)

```bash
# Local dev defaults to preprod
VITE_API_URL=http://localhost:3001
VITE_BLOCKFROST_PROJECT_ID_PREPROD=preprodXXXXX
VITE_BLOCKFROST_PROJECT_ID_MAINNET=mainnetXXXXX
```

### Backend (.env)

```bash
PORT=3001

# Preprod config
KOIOS_URL_PREPROD=https://preprod.koios.rest/api/v1
BLOCKFROST_PROJECT_ID_PREPROD=preprodXXXXX

# Mainnet config (future)
KOIOS_URL_MAINNET=https://api.koios.rest/api/v1
BLOCKFROST_PROJECT_ID_MAINNET=mainnetXXXXX

# Contract addresses/hashes (preprod)
ENCRYPTION_CONTRACT_ADDRESS_PREPROD=addr_test1...
BIDDING_CONTRACT_ADDRESS_PREPROD=addr_test1...
REFERENCE_CONTRACT_ADDRESS_PREPROD=addr_test1...
ENCRYPTION_POLICY_ID_PREPROD=...
BIDDING_POLICY_ID_PREPROD=...
GENESIS_POLICY_ID_PREPROD=...

# Contract addresses/hashes (mainnet - future)
# ENCRYPTION_CONTRACT_ADDRESS_MAINNET=addr1...
# etc.
```

---

## Database Considerations

**Option A: No Database (Pure Blockchain)**

Pros:
- Simpler architecture
- No sync issues
- True decentralization

Cons:
- Slower queries (must hit Koios each time)
- No off-chain metadata storage
- Rate limits on Koios

**Option B: Lightweight Cache (Redis/SQLite)**

Pros:
- Faster queries
- Can store additional metadata (descriptions, images)
- Better UX

Cons:
- Need to keep in sync with chain
- Additional infrastructure

**Recommendation**: Start with Option A (no database). Add caching later if performance becomes an issue. Koios is quite fast for preprod/mainnet queries.

---

## SNARK Asset Delivery

The SNARK proving files are large (~720 MB total). Strategy:

1. **First Visit**
   - Detect if files are cached in IndexedDB
   - If not, show download prompt with size warning
   - Download with progress indicator
   - Store in IndexedDB

2. **Return Visit**
   - Load from IndexedDB (fast)
   - Verify integrity (hash check)

3. **Proving**
   - Run in Web Worker (non-blocking)
   - Show progress/animation
   - Return proof to main thread

See `snark/browser-support.md` for full technical details.

---

## Testing Strategy

### Philosophy

- **Utils/Services**: Must have unit tests (Jest/Vitest)
- **FE Components**: Manual testing preferred over headless testing
- **Transaction Building**: Manual testing required (complex Plutus interactions)
- **E2E**: Manual testing with Eternl wallet on Chrome

Headless FE testing is time-consuming for diminishing returns. Focus on shipping working code and testing manually.

### Automated Tests (Required)

- [ ] Utility functions (parsing, formatting, conversions)
- [ ] Service functions (API clients, data transformations)
- [ ] Crypto helpers (encryption/decryption logic)
- [ ] WASM integration helpers

### Manual Testing - Wallet (Chrome + Eternl)

- [ ] Connect with Eternl
- [ ] Disconnect works
- [ ] Reconnect on page refresh
- [ ] Address displays correctly

### Manual Testing - Transactions

- [ ] Create encryption succeeds
- [ ] Remove encryption succeeds
- [ ] Create bid succeeds
- [ ] Remove bid succeeds
- [ ] SNARK tx succeeds
- [ ] Re-encryption tx succeeds
- [ ] Decrypt works

### Manual Testing - Edge Cases

- [ ] Insufficient funds error displays toast
- [ ] Transaction failure displays toast with error
- [ ] Network errors handled gracefully
- [ ] Wallet rejection handled
- [ ] SNARK proving timeout handled
- [ ] Invalid bid (wrong encryption) prevented

### Browser

- [ ] Chrome (primary and only target)

**Note**: Chrome is the only browser with reliable Cardano wallet extensions. Other browsers are not supported.

---

## Design Philosophy

**This is not a backend dev's frontend.** The UI must feel modern, polished, and intentional. Every pixel matters. Consistency is non-negotiable.

### Core Principles

1. **Minimal but not empty** - Remove clutter, keep purpose
2. **Consistent spacing** - Use a spacing scale (4, 8, 12, 16, 24, 32, 48, 64px)
3. **Subtle depth** - Light shadows, border accents, not flat boxes everywhere
4. **Purposeful animation** - Micro-interactions that feel responsive, not flashy
5. **Typography hierarchy** - Clear visual distinction between headings, body, labels
6. **Generous whitespace** - Let elements breathe

### What to Avoid

- Cramped layouts with elements touching
- Inconsistent button sizes/styles across pages
- Generic Bootstrap/Material look
- Harsh color contrasts
- Walls of text without visual breaks
- Misaligned elements (use grid, not eyeballing)
- Different border radiuses on same-level components
- Mixing design languages (pick one, stick to it)

### Design System

#### Color Palette

```css
/* Dark theme - modern, clean */
:root {
  /* Backgrounds - subtle gradation */
  --bg-primary: #0a0a0a;
  --bg-secondary: #141414;
  --bg-card: #1a1a1a;
  --bg-card-hover: #222222;
  --bg-elevated: #242424;

  /* Borders - barely visible, adds definition */
  --border-subtle: #2a2a2a;
  --border-default: #333333;
  --border-focus: #444444;

  /* Text - high contrast for readability */
  --text-primary: #fafafa;
  --text-secondary: #a1a1a1;
  --text-muted: #666666;

  /* Accent - single accent color, used sparingly */
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-muted: rgba(99, 102, 241, 0.15);

  /* Semantic */
  --success: #22c55e;
  --success-muted: rgba(34, 197, 94, 0.15);
  --warning: #f59e0b;
  --warning-muted: rgba(245, 158, 11, 0.15);
  --error: #ef4444;
  --error-muted: rgba(239, 68, 68, 0.15);
}
```

#### Typography

```css
/* Font stack */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;

/* Scale - consistent sizing */
--text-xs: 0.75rem;    /* 12px - labels, captions */
--text-sm: 0.875rem;   /* 14px - secondary text */
--text-base: 1rem;     /* 16px - body */
--text-lg: 1.125rem;   /* 18px - emphasized body */
--text-xl: 1.25rem;    /* 20px - card titles */
--text-2xl: 1.5rem;    /* 24px - section headers */
--text-3xl: 2rem;      /* 32px - page titles */

/* Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
```

#### Spacing Scale

```css
/* Use consistently - never arbitrary values */
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

#### Border Radius

```css
/* Consistent roundness */
--radius-sm: 4px;     /* Small elements: badges, chips */
--radius-md: 8px;     /* Buttons, inputs */
--radius-lg: 12px;    /* Cards, modals */
--radius-xl: 16px;    /* Large containers */
```

#### Shadows

```css
/* Subtle, not harsh */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.3);
--shadow-glow: 0 0 20px rgba(99, 102, 241, 0.15);  /* Accent glow */
```

### Component Specifications

#### Buttons

```
Primary:    bg-accent, text-white, hover:bg-accent-hover
            Rounded-md, px-4 py-2, font-medium

Secondary:  bg-transparent, border border-subtle, text-secondary
            hover:bg-card hover:text-primary

Danger:     bg-error-muted, text-error, hover:bg-error hover:text-white

Ghost:      bg-transparent, text-secondary, hover:text-primary hover:bg-card
```

All buttons same height (40px default), consistent padding.

#### Cards

```
- Background: bg-card
- Border: 1px solid border-subtle
- Border radius: radius-lg (12px)
- Padding: space-6 (24px)
- Hover: bg-card-hover, border-default (subtle lift)
- No harsh drop shadows - use border for definition
```

#### Inputs

```
- Background: bg-secondary
- Border: 1px solid border-subtle
- Border radius: radius-md (8px)
- Padding: space-3 horizontal, space-2 vertical
- Focus: border-accent, shadow-glow
- Placeholder: text-muted
- Height: 40px (matches buttons)
```

#### Modals

```
- Overlay: bg-black/60, backdrop-blur-sm
- Modal: bg-card, border border-subtle, radius-xl
- Max-width: 480px (forms), 640px (content)
- Padding: space-6
- Header: text-xl font-semibold, border-b border-subtle, pb-4
- Footer: border-t border-subtle, pt-4, flex justify-end gap-3
```

#### Tables/Lists

```
- Header: text-muted text-sm font-medium uppercase tracking-wide
- Rows: border-b border-subtle last:border-0
- Row hover: bg-card-hover
- Cell padding: space-4 vertical, space-6 horizontal
- Alternating backgrounds: NO (use hover instead)
```

### Layout Guidelines

#### Page Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Nav: h-16, border-b border-subtle, px-6                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Content: max-w-6xl mx-auto px-6 py-8                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Section: space-y-6 between major sections          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Grid

```
- 12-column grid for complex layouts
- gap-6 (24px) between grid items
- Cards: span 4 (3-column), span 6 (2-column) on desktop
- Stack to single column on tablet/mobile
```

### Micro-interactions

```css
/* Transitions - consistent timing */
--transition-fast: 150ms ease;
--transition-base: 200ms ease;
--transition-slow: 300ms ease;

/* Apply to interactive elements */
button, a, input, .card {
  transition: all var(--transition-fast);
}
```

**What to animate:**
- Button hover/active states
- Card hover (subtle border/background change)
- Modal enter/exit (fade + scale)
- Toast enter/exit (slide from bottom)
- Loading spinners
- Focus rings

**What NOT to animate:**
- Page content (no fade-in on load)
- Text color changes
- Layout shifts

### Component Checklist

Build these with design specs above:

- [ ] Button (primary, secondary, danger, ghost, loading state)
- [ ] Card (default, hoverable, selected states)
- [ ] Modal (with header, body, footer slots)
- [ ] Input (text, textarea, with label and error states)
- [ ] Select/Dropdown
- [ ] Table (sortable headers, row hover)
- [ ] Badge/Status (success, warning, error, neutral)
- [ ] Loading spinner (consistent size and color)
- [ ] Progress bar (determinate and indeterminate)
- [ ] Tabs (underline style, not boxed)
- [ ] Toast (error, success, info variants)
- [ ] Wallet address (truncated with copy button)
- [ ] Empty state (icon + message + action)

### Design References

For inspiration (not to copy, but to match quality level):

- **Vercel Dashboard** - Clean, minimal, excellent dark mode
- **Linear** - Polished micro-interactions, great spacing
- **Raycast** - Modern feel, consistent components
- **Stripe Dashboard** - Information density done right

### Consistency Checklist

Before shipping any page:

- [ ] All buttons use the same variants defined above
- [ ] All cards have the same border radius and padding
- [ ] All inputs are the same height as buttons
- [ ] Spacing between elements uses the spacing scale
- [ ] Text sizes follow the typography scale
- [ ] Colors only from the palette (no one-off hex values)
- [ ] Hover states on all interactive elements
- [ ] Focus states visible for keyboard navigation
- [ ] Loading states for async actions
- [ ] Empty states for lists with no data

### Key UI Patterns

#### Error Toast (Bottom of Screen)

```
┌─────────────────────────────────────────────────────┐
│  ❌ Transaction failed: Insufficient funds          │
│                                          [Dismiss]  │
└─────────────────────────────────────────────────────┘
```

- Position: Fixed bottom center
- Auto-dismiss after 5-10 seconds
- Manual dismiss button
- Red/error styling for errors
- Stack multiple toasts if needed

#### Success Modal (with CardanoScan Link)

```
┌────────────────────────────────────────────────────────┐
│                    ✓ Success!                          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Your transaction has been submitted.                  │
│                                                        │
│  Transaction ID:                                       │
│  abc123...def456                                       │
│                                                        │
│  [View on CardanoScan ↗]                              │
│                                                        │
│                      [Close]                           │
└────────────────────────────────────────────────────────┘
```

- Link format: `https://preprod.cardanoscan.io/transaction/{txHash}`
- Use `https://cardanoscan.io/transaction/{txHash}` for mainnet
- Opens in new tab

#### Wallet Component

Use MeshJS's built-in `<CardanoWallet />` component. Don't build custom wallet UI.

---

## Next Steps

### Before Preprod Deployment

1. **Phase 1-3**: Landing page + wallet connect (no stubs needed)
2. **Phase 4-6**: Backend + marketplace UI (with stub data)
3. **Phase 11**: SNARK WASM integration (independent of chain)
4. **Phase 9-10**: Create listing + bid UI (stub tx submission)
5. **Phase 7-8, 13**: My Sales/Purchases + decrypt UI (stub data)

### After Preprod Deployment

6. **Remove stubs**: Switch `VITE_USE_STUBS=false`
7. **Phase 12**: Full accept bid flow with real txs
8. **Phase 14-15**: E2E testing, polish

### Recommended Starting Point

Start with Phases 1-3 + 11 in parallel:
- **Track A**: Landing page, wallet, dashboard shell
- **Track B**: SNARK WASM proving in isolation

This lets you validate the hardest technical piece (SNARK in browser) while building out the UI foundation.

---

## Important Notes

### Transaction Building

Transaction building with MeshJS for Plutus V3 contracts requires careful attention:

1. **Reference MeshJS docs**: https://meshjs.dev/apis/transaction
2. **Manual testing required**: Build txs incrementally, test each step
3. **Expect iteration**: First attempts rarely work; debugging is normal
4. **Use Blockfrost simulation**: MeshJS uses this automatically
5. **Check redeemer/datum formats**: Must match on-chain expectations exactly

The shell scripts in `commands/` show the exact tx structure needed. Port these patterns to MeshJS, but expect to adjust for API differences.

### Why Chrome Only

- Eternl, Nami, Lace work best on Chrome
- WASM + 2GB memory works reliably on Chrome
- Other browsers have wallet compatibility issues
- Simplifies testing and support

---

## Critical Implementation Details

### Seller Secret Storage

When a seller creates an encryption, secrets `a` and `r` are generated. These MUST be stored locally until the seller accepts a bid (could be days/weeks later).

**Strategy:**
- Store encrypted in IndexedDB, keyed by encryption token name
- Encrypt with a key derived from wallet signature (user must sign to access)
- If secrets are lost, the seller cannot complete any sales for that listing
- Consider backup/export functionality

**Warning to users:** "Your encryption secrets are stored in this browser. If you clear browser data or use a different device, you will not be able to complete sales."

### Groth Withdrawal (SNARK Tx)

The SNARK transaction uses a **stake withdrawal** for on-chain Groth16 verification. This is an unusual pattern:

```
--withdrawal ${groth_address}+${rewardBalance}
--withdrawal-tx-in-reference="${groth_ref_utxo}#1"
--withdrawal-plutus-script-v3
--withdrawal-reference-tx-in-redeemer-file ../data/groth/witness-redeemer.json
```

MeshJS may require manual tx building for this. Verify support or use lower-level APIs.

### Token Name Computation

Token names are derived from the first UTxO used in the transaction:

```typescript
// Port from shell script logic
function computeTokenName(utxo: { txHash: string; outputIndex: number }): string {
  // CBOR encode the output index
  const txIdxCbor = cborEncode(utxo.outputIndex);
  // Concatenate and take first 64 hex chars
  const fullName = txIdxCbor + utxo.txHash;
  return fullName.slice(0, 64);
}
```

Need a CBOR library (e.g., `cbor-x` or `@meshsdk/core` utilities).

### Validity Intervals (SNARK Tx)

The SNARK transaction requires time bounds:

```typescript
// Calculate slot numbers from timestamps
const lowerBound = await getSlotFromTimestamp(Date.now());
const upperBound = await getSlotFromTimestamp(Date.now() + 5 * 60 * 1000); // +5 minutes

// TTL for pending state (stored in datum)
const pendingTtl = Date.now() + 20 * 60 * 1000; // +20 minutes
```

Use Koios or Blockfrost to convert timestamps to slots.

### Pending State TTL

When a seller submits the SNARK tx, the encryption enters "pending" state with a TTL.

- Show countdown timer in UI: "Complete sale within X minutes"
- If TTL expires, seller must use cancel endpoint to reset
- Buyer should see "Sale pending" status

### SNARK Download Timing

**Recommendation:** Download SNARK files just-in-time (when seller first tries to accept a bid).

Flow:
1. Seller clicks "Accept Bid"
2. Check IndexedDB for cached files
3. If not cached: show download modal with progress (~480 MB)
4. Once downloaded, proceed to proving
5. Cache for future use

Don't download on first visit - most users are buyers who don't need SNARK files.

### Data Refresh Strategy

- **Marketplace listings**: Fetch on page load, manual refresh button
- **My Sales/Purchases**: Fetch on tab switch, manual refresh button
- **After transaction**: Auto-refresh relevant data after tx confirmation
- **No WebSockets**: Keep it simple with manual/on-demand refresh
- Consider 30-60 second polling on active tabs (optional)

### Reference Script UTxOs

Transactions use reference scripts stored on-chain. These should be in backend config:

```typescript
// Protocol config endpoint should return:
{
  referenceScripts: {
    encryption: { txHash: "...", outputIndex: 1 },
    bidding: { txHash: "...", outputIndex: 1 },
    groth: { txHash: "...", outputIndex: 1 }
  },
  genesisToken: {
    policyId: "...",
    tokenName: "..."
  }
}
```

### Mobile Detection

Detect mobile devices and show warning:

```typescript
function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// On dashboard load
if (isMobile()) {
  showWarning("This app requires a desktop browser for full functionality. SNARK proving needs 2GB+ RAM.");
}
```

### Bid Amount and Suggested Price

**On-chain:** Bid amount is simply the lovelace attached to the bid UTxO.

**Off-chain (CIP-20 Metadata):**
- Seller provides metadata when creating listing
- Stored in transaction metadata (key 674), queryable via Koios/Blockfrost
- Buyers see suggested price but can bid any amount
- Seller decides which bid to accept

---

### CIP-20 Transaction Metadata

When creating an encryption listing, the transaction includes metadata following the [CIP-20 standard](https://cips.cardano.org/cip/CIP-20). This allows human-readable information to be attached to the listing transaction.

**Metadata Structure:**
```json
{
  "674": {
    "msg": [
      "DATA_DESCRIPTION",
      "SUGGESTED_PRICE",
      "STORAGE_LAYER_INFO"
    ]
  }
}
```

**Fields:**
| Index | Field | Description | Example |
|-------|-------|-------------|---------|
| 0 | `description` | Human-readable description of the encrypted data | "Premium API keys for crypto exchanges" |
| 1 | `suggestedPrice` | Suggested price in ADA (string) | "100" |
| 2 | `storageLayer` | Where the actual data is stored | "on-chain", "ipfs://Qm...", "arweave://Tx..." |

**Storage Layer Options:**
- `"on-chain"` - Encrypted data stored in the datum capsule
- `"ipfs://..."` - IPFS CID pointing to encrypted data
- `"arweave://..."` - Arweave transaction ID pointing to encrypted data
- Other URIs possible for future storage options

**Parsing in Backend (Phase 5):**
```typescript
// When querying from Koios, parse CIP-20 metadata
async function parseEncryptionMetadata(txHash: string): Promise<Cip20Metadata | null> {
  const txInfo = await koios.getTxInfo(txHash);
  const metadata = txInfo?.metadata;

  if (!metadata || !metadata['674']?.msg) {
    return null;
  }

  const msg = metadata['674'].msg;
  return {
    description: msg[0] || undefined,
    suggestedPrice: msg[1] ? parseFloat(msg[1]) : undefined,
    storageLayer: msg[2] || undefined,
  };
}
```

**Building in Frontend (Phase 9):**
```typescript
// When creating a listing, attach CIP-20 metadata
import { Transaction } from '@meshsdk/core';

const tx = new Transaction({ initiator: wallet });

// Add CIP-20 metadata
tx.setMetadata(674, {
  msg: [
    formData.description,           // e.g., "Premium API keys"
    formData.suggestedPrice.toString(), // e.g., "100"
    formData.storageLayer || 'on-chain', // e.g., "ipfs://Qm..."
  ]
});

// ... rest of tx building
```

**UI Display:**
- `EncryptionCard` shows description in a muted box below the header
- Storage layer shown as a badge (On-chain, IPFS, Arweave, External)
- List view shows truncated description (1 line)
- Grid view shows truncated description (2 lines)

**TypeScript Types (already in `fe/src/services/api.ts`):**
```typescript
// CIP-20 metadata parsed from transaction
export interface Cip20Metadata {
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
}

export interface EncryptionDisplay {
  tokenName: string;
  seller: string;
  sellerPkh: string;
  status: 'active' | 'pending' | 'completed';
  // CIP-20 metadata fields
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  // ... other fields
}
```

**Note:** CIP-20 metadata is immutable once the transaction is on-chain. If seller wants to change description, they must remove listing and create a new one.

---

## Data Structures Reference

### Source Files

| Category | Location | Description |
|----------|----------|-------------|
| **Aiken types** | `contracts/lib/types/*.ak` | On-chain datum/redeemer definitions |
| **Python crypto** | `src/*.py` | Encryption, proofs, key derivation |
| **Transaction patterns** | `commands/*.sh` | Shell scripts showing exact tx structure |
| **Compiled contracts** | `contracts/plutus.json` | Contract CBOR and hashes |

### TypeScript Datum Interfaces

Port these from `contracts/lib/types/` - they define what MeshJS must serialize:

```typescript
// From contracts/lib/types/encryption.ak
interface EncryptionDatum {
  owner_vkh: string;              // 28 bytes hex (VerificationKeyHash)
  owner_g1: Register;             // BLS12-381 public key register
  token: string;                  // 32 bytes hex (AssetName)
  half_level: HalfEncryptionLevel;
  full_level: FullEncryptionLevel | null;  // Option type
  capsule: Capsule;
  status: Status;
}

// From contracts/lib/types/register.ak
interface Register {
  generator: string;              // 48 bytes hex (compressed G1, always the standard generator)
  public_value: string;           // 48 bytes hex (compressed G1, = generator^secret)
}

// From contracts/lib/types/encryption.ak
interface Capsule {
  nonce: string;                  // 24 hex chars (12 bytes, AES-GCM nonce)
  aad: string;                    // 64 hex chars (32 bytes, additional auth data)
  ct: string;                     // variable hex (ciphertext + 16-byte GCM tag)
}

// From contracts/lib/types/level.ak
interface HalfEncryptionLevel {
  r1b: string;                    // 96 hex chars (48 bytes, compressed G1)
  r2_g1b: string;                 // 96 hex chars (48 bytes, compressed G1)
  r4b: string;                    // 192 hex chars (96 bytes, compressed G2)
}

interface FullEncryptionLevel {
  r1b: string;                    // 96 hex chars (compressed G1)
  r2_g1b: string;                 // 96 hex chars (compressed G1)
  r2_g2b: string;                 // 192 hex chars (compressed G2)
  r4b: string;                    // 192 hex chars (compressed G2)
}

// From contracts/lib/types/encryption.ak
type Status =
  | { type: 'Open' }
  | { type: 'Pending'; groth_public: number[]; ttl: number };

// From contracts/lib/types/bidding.ak
interface BidDatum {
  owner_vkh: string;              // 28 bytes hex
  owner_g1: Register;
  pointer: string;                // 32 bytes hex (encryption token name this bid is for)
  token: string;                  // 32 bytes hex (this bid's token name)
}
```

### Redeemer Interfaces

```typescript
// From contracts/lib/types/encryption.ak
type EncryptionMintRedeemer =
  | { type: 'EntryEncryptionMint'; schnorr: SchnorrProof; binding: BindingProof }
  | { type: 'LeaveEncryptionBurn'; token: string };

type EncryptionSpendRedeemer =
  | { type: 'RemoveEncryption' }
  | { type: 'UseEncryption'; r5_witness: string; r5: string; bid_token: string; binding: BindingProof }
  | { type: 'UseSnark' }
  | { type: 'CancelEncryption' };

// From contracts/lib/types/bidding.ak
type BidMintRedeemer =
  | { type: 'EntryBidMint'; schnorr: SchnorrProof }
  | { type: 'LeaveBidBurn'; token: string };

type BidSpendRedeemer =
  | { type: 'RemoveBid' }
  | { type: 'UseBid' };

// From contracts/lib/types/schnorr.ak
interface SchnorrProof {
  z_b: string;                    // scalar as hex (variable length, big-endian)
  g_r_b: string;                  // 96 hex chars (compressed G1)
}

interface BindingProof {
  z_a_b: string;                  // scalar as hex
  z_r_b: string;                  // scalar as hex
  t_1_b: string;                  // 96 hex chars (compressed G1)
  t_2_b: string;                  // 96 hex chars (compressed G1)
}
```

### Plutus JSON Format

Datums/redeemers use Plutus constructor encoding. See `src/*.py` `*_to_file()` functions for examples:

```typescript
// Example: Register to Plutus JSON (from src/register.py)
{
  "constructor": 0,
  "fields": [
    { "bytes": "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb" },  // generator
    { "bytes": "a1b2c3..." }  // public_value
  ]
}

// Example: Capsule to Plutus JSON (from src/ecies.py)
{
  "constructor": 0,
  "fields": [
    { "bytes": "..." },  // nonce
    { "bytes": "..." },  // aad
    { "bytes": "..." }   // ct
  ]
}

// Example: Status (Open) - constructor 0, no fields
{ "constructor": 0, "fields": [] }

// Example: Status (Pending) - constructor 1
{
  "constructor": 1,
  "fields": [
    { "list": [{ "int": 123 }, { "int": 456 }, ...] },  // groth_public (36 ints)
    { "int": 1706817600000 }  // ttl (Unix ms)
  ]
}
```

### SNARK Proving Interface

```typescript
// Input to WASM prover
interface SnarkProvingInput {
  // Secrets (from seller's IndexedDB storage)
  secretA: string;                // Big integer as DECIMAL string (not hex)
  secretR: string;                // Big integer as DECIMAL string (not hex)

  // Public inputs derived from on-chain data
  publicInputs: {
    v: string;                    // 96 hex chars (compressed G1) - buyer's public key
    w0: string;                   // 96 hex chars (compressed G1) - from encryption datum
    w1: string;                   // 96 hex chars (compressed G1) - from encryption datum
  };
}

// Output from WASM prover (from contracts/lib/types/groth.ak)
interface SnarkProvingOutput {
  proof: GrothProof;
  public: number[];               // 36 field elements as integers
  commitmentWire: string;         // hex string for IC multiplication
}

interface GrothProof {
  piA: string;                    // 96 hex chars (compressed G1)
  piB: string;                    // 192 hex chars (compressed G2)
  piC: string;                    // 96 hex chars (compressed G1)
  commitments: string[];          // list of compressed G1 points
  commitmentPok: string;          // 96 hex chars (compressed G1)
}
```

### Crypto Implementation Details

**Algorithm**: AES-256-GCM with HKDF-SHA3-256 key derivation (see `src/ecies.py`)

```typescript
// Key derivation (port from src/ecies.py)
// 1. Compute salt
const salt = hash(SLT_DOMAIN_TAG + context + KEM_DOMAIN_TAG);

// 2. Derive AES key via HKDF-SHA3-256
const aesKey = hkdf({
  algorithm: 'SHA3-256',
  ikm: kemBytes,           // shared secret from BLS scalar multiplication
  salt: salt,
  info: KEM_DOMAIN_TAG,
  length: 32
});

// 3. Compute AAD
const aad = hash(AAD_DOMAIN_TAG + context + MSG_DOMAIN_TAG);

// 4. Encrypt
const nonce = randomBytes(12);
const ct = aesGcmEncrypt(aesKey, nonce, plaintext, aad);
```

**Domain Tags** (from `src/constants.py`):
- `SCH_DOMAIN_TAG` = `"SCHNORR|PROOF|v1|"` (hex: `5343484e4f52527c50524f4f467c76317c`)
- `BIND_DOMAIN_TAG` = `"BINDING|PROOF|v1|"` (hex: `42494e44494e477c50524f4f467c76317c`)
- See `src/constants.py` for full list

**JS Libraries**:
- BLS12-381: `@noble/curves/bls12-381`
- AES-GCM: `crypto.subtle` (Web Crypto API) or `@noble/ciphers`
- HKDF: `@noble/hashes/hkdf` with `@noble/hashes/sha3`
- CBOR: `cbor-x` or `@meshsdk/core` utilities

**BLS12-381 Constants** (from `contracts/lib/types/register.ak`):
```typescript
// G1 generator (compressed)
const G1_GENERATOR = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";

// G1 identity/zero (compressed)
const G1_ZERO = "c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
```

### Schnorr Proof Generation

Port from `src/schnorr.py`:

```typescript
// Schnorr proof of knowledge: prove you know x such that u = g^x
function schnorrProof(register: { g: string; u: string; x: bigint }): SchnorrProof {
  const r = randomScalar();                    // random in Z_q
  const g_r_b = scaleG1(register.g, r);        // commitment g^r

  // Fiat-Shamir challenge
  const transcript = SCH_DOMAIN_TAG + register.g + g_r_b + register.u;
  const c = hashToScalar(transcript);

  // Response
  const z = (r + c * register.x) % CURVE_ORDER;

  return {
    z_b: bigintToHex(z),
    g_r_b: g_r_b
  };
}
```

### Production Note: CSP Headers

Production deployment requires Content Security Policy headers allowing WASM execution:

```
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval';
```

Or for stricter policies, use `'wasm-eval'` if supported by your target browsers.

---

## Infrastructure & Operations

### SNARK File CDN

The ~720 MB of SNARK files should NOT be served from the same origin as the app **in production**. Use a dedicated CDN:

**Development vs Production:**

| Environment | Strategy |
|-------------|----------|
| **Local dev** | Serve from `fe/public/` or local server. No CDN needed. |
| **Production** | Serve from CDN. Required for performance and cost. |

```typescript
// Environment config - fallback to local for dev
const SNARK_CDN_URL = import.meta.env.VITE_SNARK_CDN_URL || '/snark';

// In dev: fetches from /snark/pk.bin (served by Vite from public/)
// In prod: fetches from https://cdn.example.com/snark/v1/pk.bin
const pkResponse = await fetch(`${SNARK_CDN_URL}/pk.bin`);
```

**Local dev setup:**
```
fe/public/
└── snark/
    ├── pk.bin        # Symlink or copy from circuit/
    ├── ccs.bin
    ├── prover.wasm
    └── wasm_exec.js
```

Note: Don't commit the large `.bin` files to git. Add to `.gitignore` and document setup.

**Production CDN options:**
- Cloudflare R2 (S3-compatible, generous free tier)
- AWS S3 + CloudFront
- Bunny CDN

**Production requirements:**
- CORS headers: `Access-Control-Allow-Origin: *` (or specific origin)
- Compression: Brotli/gzip for `prover.wasm`, raw for `.bin` files (already compressed)
- Cache headers: Long cache TTL (files are immutable, versioned by hash)

**Versioning:** When proving key changes, deploy to new path (`/snark/v2/`) and update env var. Old versions stay cached for existing users.

### Error Monitoring

Use Sentry (or similar) for production error tracking. Critical for understanding real-world SNARK failures.

```bash
npm install @sentry/react
```

```typescript
// fe/src/main.tsx
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,

  // Capture WASM errors
  integrations: [
    new Sentry.BrowserTracing(),
  ],
});
```

**Key events to track:**
- SNARK proving failures (OOM, timeout, WASM errors)
- Transaction build failures
- Transaction submission failures
- Wallet connection errors
- IndexedDB storage failures

**Custom context:**
```typescript
// Add context before SNARK operations
Sentry.setContext('snark', {
  pkSize: pkBytes.length,
  ccsSize: ccsBytes.length,
  browserMemory: navigator.deviceMemory,
});
```

### Concurrent Action Prevention

Users may accidentally double-click or trigger multiple transactions simultaneously. Prevent this:

```typescript
// fe/src/hooks/useTransactionLock.ts
import { create } from 'zustand';

interface TransactionLockState {
  isLocked: boolean;
  lockReason: string | null;
  lock: (reason: string) => void;
  unlock: () => void;
}

export const useTransactionLock = create<TransactionLockState>((set) => ({
  isLocked: false,
  lockReason: null,
  lock: (reason) => set({ isLocked: true, lockReason: reason }),
  unlock: () => set({ isLocked: false, lockReason: null }),
}));
```

```typescript
// Usage in components
function AcceptBidButton({ bid }) {
  const { isLocked, lock, unlock } = useTransactionLock();

  const handleAccept = async () => {
    if (isLocked) return;

    lock('Accepting bid...');
    try {
      await acceptBid(bid);
    } finally {
      unlock();
    }
  };

  return (
    <button
      onClick={handleAccept}
      disabled={isLocked}
      className={isLocked ? 'opacity-50 cursor-not-allowed' : ''}
    >
      {isLocked ? 'Transaction in progress...' : 'Accept Bid'}
    </button>
  );
}
```

**Rules:**
- All transaction-triggering buttons check `isLocked` before proceeding
- Display current lock reason in a global indicator (e.g., in navbar)
- Unlock on success, failure, or user cancellation
- Consider a timeout unlock (e.g., 5 minutes) as safety net

### Wallet Session Persistence

MeshJS may or may not persist wallet connection across page refreshes. Verify behavior and implement if needed:

```typescript
// fe/src/hooks/useWalletPersistence.ts
import { useWallet } from '@meshsdk/react';
import { useEffect } from 'react';

const WALLET_KEY = 'peace_protocol_wallet';

export function useWalletPersistence() {
  const { connected, wallet, connect } = useWallet();

  // Save connected wallet name
  useEffect(() => {
    if (connected && wallet) {
      localStorage.setItem(WALLET_KEY, wallet.name);
    }
  }, [connected, wallet]);

  // Attempt reconnect on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem(WALLET_KEY);
    if (savedWallet && !connected) {
      // Attempt to reconnect to previously used wallet
      connect(savedWallet).catch(() => {
        localStorage.removeItem(WALLET_KEY);
      });
    }
  }, []);

  // Clear on disconnect
  const clearWalletSession = () => {
    localStorage.removeItem(WALLET_KEY);
  };

  return { clearWalletSession };
}
```

**Test scenarios:**
- [ ] Fresh visit → connect wallet → refresh page → still connected?
- [ ] Connect → close tab → reopen → still connected?
- [ ] Connect → disconnect → refresh → stays disconnected?

If MeshJS handles this natively, remove custom persistence. If not, implement as above.
