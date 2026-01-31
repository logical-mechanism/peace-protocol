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
| **Phase 11** | SNARK WASM proving (independent of chain) |

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
| **Phase 12** | Full SNARK tx + re-encryption flow |
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
2. **SNARK proving** - Completely independent of chain
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

### Phase 6: Dashboard - Marketplace Tab

- [ ] Create encryption card component
- [ ] Implement grid/list view
- [ ] Add filtering/sorting
- [ ] Connect to backend API
- [ ] Add loading states
- [ ] Add empty states

### Phase 7: Dashboard - My Sales Tab

- [ ] List user's encryptions
- [ ] Show bids on each encryption
- [ ] Add remove listing functionality
- [ ] Add "View Bids" expand/modal
- [ ] Implement status indicators

### Phase 8: Dashboard - My Purchases Tab

- [ ] List user's bids
- [ ] Show bid status
- [ ] Add cancel bid functionality
- [ ] Add decrypt button (for won bids)

### Phase 9: Create Listing Flow

- [ ] Create listing form component
- [ ] Port Python crypto logic to JS (encryption, schnorr proofs, etc.)
- [ ] Build transaction with MeshJS
- [ ] Sign and submit transaction
- [ ] Show success/error feedback
- [ ] Refresh listings

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
// Example MeshJS transaction building
import { Transaction } from '@meshsdk/core';

const tx = new Transaction({ initiator: wallet });
tx.mintAsset(encryptionScript, asset, redeemer);
tx.sendAssets(encryptionContractAddress, assets, { datum });
const unsignedTx = await tx.build();
const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);
```

**Debugging tip:** If MeshJS tx fails but cli works, serialize both to CBOR and diff them.

### Phase 10: Place Bid Flow

- [ ] Create bid form/modal
- [ ] Build bid transaction
- [ ] Sign and submit
- [ ] Show success/error feedback
- [ ] Refresh bids

### Phase 11: SNARK Integration

**This is the most complex phase. See `snark/browser-support.md` for details.**

- [ ] Set up WASM loading infrastructure
- [ ] Implement IndexedDB caching for pk.bin/ccs.bin
- [ ] Create download progress UI
- [ ] Create Web Worker for SNARK proving
- [ ] Implement proving interface
- [ ] Build SNARK transaction
- [ ] Handle proving errors gracefully

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

### Phase 12: Accept Bid Flow (SNARK + Re-encryption)

- [ ] Trigger SNARK proving modal
- [ ] Generate proof in Web Worker
- [ ] Build and submit SNARK tx
- [ ] Wait for confirmation
- [ ] Build and submit re-encryption tx
- [ ] Update UI state

### Phase 13: Decrypt Flow

- [ ] Query encryption history from Koios
- [ ] Implement recursive decryption (port from Python)
- [ ] Display decrypted message
- [ ] Handle decryption errors

### Phase 14: Polish & Testing

- [ ] Error handling throughout (toast notifications)
- [ ] Loading states throughout
- [ ] Success modals with CardanoScan links
- [ ] Unit tests for utils/services
- [ ] Manual E2E testing on Chrome with Eternl
- [ ] Mobile not required (desktop-focused for SNARK proving)

### Phase 15: Local Development Setup

- [ ] Create docker-compose for local testing
- [ ] Document environment setup
- [ ] Add seed scripts for test data
- [ ] Create README with setup instructions

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

**Off-chain (UI only):**
- Seller can set a "suggested price" when creating listing
- Stored in backend/displayed in UI, NOT on-chain
- Buyers see suggested price but can bid any amount
- Seller decides which bid to accept

```typescript
// Create listing form
interface ListingForm {
  secretMessage: string;
  suggestedPrice?: number;  // ADA, optional, UI-only
}

// Display in marketplace
interface ListingDisplay {
  tokenName: string;
  seller: string;
  suggestedPrice?: number;  // From backend, not chain
  // ... other fields from datum
}
```

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
