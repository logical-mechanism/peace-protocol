# Veiled Desktop - Full Node Marketplace Application

## Overview

A fully decentralized Cardano desktop application for the PEACE Protocol encrypted data marketplace. Built with Tauri v2, it embeds a cardano-node, Ogmios, Kupo, and a native SNARK prover - eliminating all external API dependencies for current chain state.

The existing mock web UI (`app/ui/`) serves as the foundation. ~80% of the frontend code (React components, crypto modules, transaction builder) is reused directly. The desktop app adds a built-in wallet, local chain infrastructure, and native SNARK proving.

## Architecture

```
Tauri v2 Desktop App (app/gui/)
│
├── WebView (React Frontend)
│   ├── Marketplace UI components (reused from app/ui/fe/)
│   ├── MeshWallet (built-in, from 24-word mnemonic)
│   ├── MeshTxBuilder with OgmiosProvider (local tx evaluation)
│   ├── Crypto modules: BLS12-381, ECIES (reused unchanged)
│   ├── ZK key derivation: blake2b-224(wallet_key + domain_tag)
│   └── Tauri invoke() for SNARK, wallet storage, node status
│
├── Managed Process: cardano-node
│   ├── LMDB/OnDisk backend (~8GB RAM mainnet, ~4GB preprod)
│   ├── Network config: preprod (default), mainnet (toggle in settings)
│   └── Unix socket for Ogmios connection
│
├── Managed Process: Ogmios
│   ├── WebSocket bridge to cardano-node (localhost:1337)
│   ├── Tx evaluation → MeshSDK OgmiosProvider (IEvaluator)
│   ├── Tx submission → MeshSDK OgmiosProvider (ISubmitter)
│   └── Protocol parameters, chain tip queries
│
├── Managed Process: Kupo
│   ├── Filtered to contract addresses + user wallet addresses
│   ├── SQLite storage, ~256MB RAM
│   ├── HTTP API (localhost:1442) for UTxO queries
│   └── Feeds IFetcher interface via adapter
│
├── Backend Service (Express, adapted from app/ui/be/)
│   ├── Queries Kupo (local) for current UTxO/contract data
│   ├── Queries Koios (external, free tier, no key) for historical data
│   ├── Datum parsing, response formatting (reused from app/ui/be/)
│   └── localhost:3001 (same API contract as mock UI)
│
├── First-run: Mithril Client
│   ├── Downloads chain snapshot (~10-20 min)
│   └── Bootstraps cardano-node database
│
├── Sidecar: snark_cli (Go binary, ~18MB)
│   ├── Commands: prove, gtToHash, decryptToHash (and others)
│   ├── Setup files: pk.bin (~447MB) + ccs.bin (~52MB)
│   ├── Shipped compressed (~400MB) in installer
│   └── Decompressed to app data directory on first launch
│
└── Rust Core (Tauri backend)
    ├── Process lifecycle manager (node, ogmios, kupo, express, snark)
    ├── Mithril snapshot download + node bootstrap
    ├── Node sync status monitoring + chain tip polling
    ├── Encrypted mnemonic storage (AES-256-GCM, Argon2 KDF)
    ├── SNARK prover invocation (spawn snark_cli)
    ├── Network config management (preprod/mainnet toggle)
    └── App data directory management
```

## System Requirements

| Resource | Preprod (Default) | Mainnet |
|----------|-------------------|---------|
| RAM | ~4GB | ~8.5GB |
| Disk (chain data) | ~30GB | ~300GB |
| Disk (app + SNARK) | ~1.5GB | ~1.5GB |
| Mithril bootstrap | ~10 min | ~20 min |
| OS | Linux, macOS, Windows | Linux, macOS, Windows |

## Directory Structure

```
app/
├── ui/              # Mock web UI (unchanged, for development/testing)
├── gui/             # Desktop application (this project)
│   ├── src-tauri/        # Rust backend (Tauri v2)
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── lib.rs
│   │   │   ├── commands/         # Tauri invoke handlers
│   │   │   │   ├── wallet.rs     # Mnemonic encrypt/decrypt/store
│   │   │   │   ├── snark.rs      # SNARK prover invocation
│   │   │   │   ├── node.rs       # Node status, sync progress
│   │   │   │   └── config.rs     # Network settings, data dirs
│   │   │   ├── process/          # External process management
│   │   │   │   ├── manager.rs    # Start/stop/restart processes
│   │   │   │   ├── cardano.rs    # cardano-node config + lifecycle
│   │   │   │   ├── ogmios.rs     # Ogmios config + lifecycle
│   │   │   │   ├── kupo.rs       # Kupo config + lifecycle
│   │   │   │   ├── mithril.rs    # Mithril client operations
│   │   │   │   └── express.rs    # Express backend lifecycle
│   │   │   └── crypto/
│   │   │       └── wallet.rs     # AES-256-GCM + Argon2 for mnemonic
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   └── binaries/             # Platform-specific binaries
│   │       ├── cardano-node-*
│   │       ├── ogmios-*
│   │       ├── kupo-*
│   │       ├── mithril-client-*
│   │       └── snark_cli-*
│   │
│   ├── fe/                # React frontend (adapted from app/ui/fe/)
│   │   ├── src/
│   │   │   ├── main.tsx          # WalletProvider replaces MeshProvider
│   │   │   ├── App.tsx           # Route guards: wallet + node sync
│   │   │   ├── contexts/
│   │   │   │   ├── WalletContext.tsx    # MeshWallet lifecycle
│   │   │   │   └── NodeContext.tsx      # Node sync status
│   │   │   ├── pages/
│   │   │   │   ├── WalletSetup.tsx     # Create/import mnemonic
│   │   │   │   ├── WalletUnlock.tsx    # Password entry
│   │   │   │   ├── NodeSync.tsx        # Mithril bootstrap + sync
│   │   │   │   └── Dashboard.tsx       # (reused from app/ui/)
│   │   │   ├── components/       # (reused from app/ui/fe/)
│   │   │   ├── services/
│   │   │   │   ├── transactionBuilder.ts  # (reused unchanged)
│   │   │   │   ├── crypto/               # (reused unchanged)
│   │   │   │   ├── snark/
│   │   │   │   │   └── prover.ts         # invoke() replaces Web Worker
│   │   │   │   ├── kupoAdapter.ts        # IFetcher wrapping Kupo HTTP
│   │   │   │   ├── api.ts               # (reused, hits localhost:3001)
│   │   │   │   └── zkKeyDerivation.ts   # blake2b-224(key + domain_tag)
│   │   │   └── hooks/
│   │   │       ├── useNodeStatus.ts
│   │   │       └── useWalletLock.ts
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── be/                # Express backend (adapted from app/ui/be/)
│   │   ├── src/
│   │   │   ├── services/
│   │   │   │   ├── kupo.ts       # Kupo HTTP client (replaces Koios for current data)
│   │   │   │   └── koios.ts      # (kept for historical data only)
│   │   │   └── routes/           # (reused, data source swapped)
│   │   └── package.json
│   │
│   ├── goals.md           # This file
│   └── package.json       # Workspace root
│
├── contracts/       # Aiken smart contracts
├── snark/           # Go SNARK prover source (builds snark_cli)
└── scripts/         # CLI scripts
```

## Key Architectural Decisions

### 1. MeshWallet (Built-in Wallet)

MeshSDK's `MeshWallet` takes a 24-word mnemonic and implements the same `IWallet` interface used throughout the existing codebase. The user can create a new wallet or import an existing Eternl wallet via mnemonic.

```typescript
const wallet = new MeshWallet({
  networkId: 0, // preprod (1 for mainnet)
  fetcher: kupoAdapter,
  submitter: ogmiosProvider,
  key: { type: 'mnemonic', words: decryptedMnemonic },
})
```

**Code reuse impact**: `transactionBuilder.ts` (1818 lines) needs **zero changes** - every function takes `wallet: IWallet`.

### 2. ZK Key Derivation (No signData)

Instead of using CIP-30 `signData()` to derive BLS12-381 secrets (which would differ between wallet implementations), derive ZK keys directly from the HD wallet keys:

```typescript
// Derive ZK secret deterministically from wallet key material
const zkSecret = blake2b224(walletKey + ZK_DOMAIN_TAG)
```

This replaces `walletSecret.ts`'s `deriveSecretFromWallet()` function. The derivation is deterministic and tied to the mnemonic, not to any specific wallet's signing implementation.

### 3. Local Providers (No API Keys)

```typescript
const ogmios = new OgmiosProvider('ws://localhost:1337')
const txBuilder = new MeshTxBuilder({
  fetcher: kupoAdapter,  // Custom IFetcher wrapping Kupo HTTP
  evaluator: ogmios,     // Local Ogmios for execution units
})
```

Replaces `BlockfrostProvider` entirely. Zero API keys for tx building, evaluation, and submission.

### 4. Express Backend Retained

The Express backend stays as an abstraction layer between frontend and data sources. Only the data source changes:
- **Current state** (UTxOs, contract data): Kupo local HTTP API
- **Historical data** (tx metadata, address history): Koios free tier (no key)
- Frontend still talks to `localhost:3001` - same API contract

### 5. Network Toggle (Preprod Default)

Build for **preprod** by default. Settings toggle switches to mainnet. The toggle changes:
- cardano-node config files (topology, genesis)
- Ogmios network flag
- Kupo network flag
- Mithril aggregator URL
- MeshWallet networkId
- Contract addresses and policy IDs

Store network choice in app config. Switching networks requires restart and separate chain data directory.

### 6. SNARK Files Built-in

Ship `pk.bin` + `ccs.bin` compressed (~400MB) inside the installer. Decompress to app data directory on first launch. The `snark_cli` binary handles all SNARK operations (prove, gtToHash, decryptToHash, and other utilities).

## Binary Dependencies

| Binary | Size | Source |
|--------|------|--------|
| cardano-node | ~100MB | IntersectMBO/cardano-node releases |
| ogmios | ~30MB | CardanoSolutions/ogmios releases |
| kupo | ~30MB | CardanoSolutions/kupo releases |
| mithril-client | ~30MB | input-output-hk/mithril releases |
| snark_cli | ~18MB | Built from app/snark/ |
| pk.bin + ccs.bin | ~400MB compressed | Built from app/snark/ |

**Total installer size**: ~600-700MB compressed

## Data Flow

### Create Listing
```
User fills form → transactionBuilder.ts (unchanged)
  → MeshWallet.getUtxos() → Kupo (local)
  → MeshTxBuilder.complete() → OgmiosProvider.evaluateTx() (local)
  → MeshWallet.signTx() → signs with local keys
  → OgmiosProvider.submitTx() → cardano-node → network
  → Kupo indexes new UTxO → Express serves to frontend
```

### Accept Bid (SNARK Proof)
```
User clicks Accept → invoke('snark_prove', {...})
  → Rust spawns snark_cli prove → ~3 min (was 106 min in browser)
  → Proof returned to frontend
  → transactionBuilder.ts builds groth witness (unchanged)
  → MeshTxBuilder evaluates via Ogmios (local)
  → MeshWallet signs → Ogmios submits → network
  → Second tx: re-encryption → same flow
```

## Code Reuse Summary

### Reused Unchanged (~80% of frontend)
- `fe/src/services/transactionBuilder.ts` - all 1818 lines (IWallet interface)
- `fe/src/services/crypto/*` - all BLS12-381, ECIES, binding, register modules
- `fe/src/services/secretStorage.ts` - IndexedDB seller secrets
- `fe/src/services/bidSecretStorage.ts` - IndexedDB bid secrets
- `fe/src/services/acceptBidStorage.ts` - IndexedDB accept-bid secrets
- `fe/src/services/transactionHistory.ts` - localStorage tx history
- `fe/src/services/api.ts` - Express API client (localhost:3001)
- `fe/src/components/Dashboard.tsx` - main dashboard layout
- `fe/src/components/MarketplaceTab.tsx` - marketplace browsing
- `fe/src/components/MySalesTab.tsx` - seller view
- `fe/src/components/MyPurchasesTab.tsx` - buyer view
- `fe/src/components/EncryptionCard.tsx` - listing cards
- `fe/src/components/SalesListingCard.tsx` - sales cards
- `fe/src/components/CreateListingModal.tsx` - listing creation
- `fe/src/components/PlaceBidModal.tsx` - bid placement
- `fe/src/components/DecryptModal.tsx` - decryption UI
- `fe/src/components/SnarkProvingModal.tsx` - proving progress (adapted)
- `fe/src/components/Toast.tsx`, `Badge.tsx`, `ErrorBoundary.tsx` - common UI
- All CSS/Tailwind styling

### Adapted (minor changes)
- `fe/src/main.tsx` - MeshProvider → WalletProvider + NodeProvider
- `fe/src/App.tsx` - route guards: wallet unlocked + node synced
- `fe/src/services/snark/prover.ts` - invoke() replaces Web Worker
- `be/src/services/` - Kupo client replaces Koios for current-state queries

### Replaced
- `fe/src/pages/Landing.tsx` → WalletSetup.tsx + WalletUnlock.tsx
- `fe/src/services/crypto/walletSecret.ts` → zkKeyDerivation.ts
- `fe/src/contexts/WasmContext.tsx` → NodeContext.tsx
- `fe/src/pages/WasmLoadingScreen.tsx` → NodeSync.tsx
- `fe/src/hooks/useWalletPersistence.ts` → useWalletLock.ts

### Removed
- `fe/src/services/snark/storage.ts` (no IndexedDB SNARK caching)
- `fe/src/services/snark/worker.ts` (no Web Worker)
- Docker compose, `vite-plugin-wasm`, `vite-plugin-top-level-await`

### New
- `src-tauri/` - entire Rust backend
- Wallet UI pages (WalletSetup, WalletUnlock)
- Node management UI (NodeSync, sync indicator)
- Kupo adapter (IFetcher implementation)
- ZK key derivation module

---

# Implementation Phases

Each phase is designed to be **independently workable** in a separate AI context window. Phases 1-4 can be worked in parallel after Phase 0 establishes the scaffold. Each phase lists its inputs, outputs, and verification criteria.

---

## Phase 0: Project Scaffold [x]

**Goal**: Set up the Tauri v2 project structure, copy reusable code from `app/ui/`, and establish the development workflow.

**Inputs**: Existing `app/ui/fe/` and `app/ui/be/` code

**Tasks**:
1. Initialize Tauri v2 project in `app/gui/`
2. Set up the directory structure as defined above
3. Copy reusable frontend code from `app/ui/fe/` to `app/gui/fe/`:
   - All `src/components/` (unchanged)
   - All `src/services/crypto/` (unchanged)
   - `src/services/transactionBuilder.ts` (unchanged)
   - `src/services/secretStorage.ts`, `bidSecretStorage.ts`, `acceptBidStorage.ts` (unchanged)
   - `src/services/transactionHistory.ts` (unchanged)
   - `src/services/api.ts` (unchanged)
   - `src/index.css` and Tailwind config (unchanged)
   - `package.json` dependencies (minus WASM plugins, plus `@tauri-apps/api`)
4. Copy reusable backend code from `app/ui/be/` to `app/gui/be/`:
   - All routes (unchanged initially)
   - `src/services/koios.ts` (kept for historical data)
   - `src/stubs/` (for development)
   - `package.json` (minus blockfrost dependency)
5. Set up Vite config for Tauri (remove WASM plugins, add Tauri dev server integration)
6. Create stub `main.tsx` with placeholder providers
7. Create stub `src-tauri/` with minimal Rust skeleton
8. Verify: `cargo tauri dev` launches and shows the React app in WebView

**Outputs**: Working Tauri scaffold with copied code, compiles and launches

**Dependencies**: None (start here)

**Files to create**:
- `app/gui/package.json` (workspace root)
- `app/gui/src-tauri/Cargo.toml`
- `app/gui/src-tauri/tauri.conf.json`
- `app/gui/src-tauri/src/main.rs`
- `app/gui/src-tauri/src/lib.rs`
- `app/gui/fe/package.json`
- `app/gui/fe/vite.config.ts`
- `app/gui/fe/tsconfig.json`
- `app/gui/fe/index.html`
- `app/gui/be/package.json`

**Files to copy from app/ui/**:
- `fe/src/components/*` → `gui/fe/src/components/*`
- `fe/src/services/crypto/*` → `gui/fe/src/services/crypto/*`
- `fe/src/services/transactionBuilder.ts` → `gui/fe/src/services/transactionBuilder.ts`
- `fe/src/services/secretStorage.ts` → (and bid/accept variants)
- `fe/src/services/transactionHistory.ts`
- `fe/src/services/api.ts`
- `fe/src/index.css`
- `be/src/*` → `gui/be/src/*`

---

## Phase 1: Built-in Wallet [x]

**Goal**: Implement a Daedalus-style wallet with mnemonic creation, import, password protection, and MeshWallet integration.

**Inputs**: Phase 0 scaffold

**Tasks**:
1. **Rust: Encrypted mnemonic storage** (`src-tauri/src/commands/wallet.rs`)
   - `invoke('wallet_exists')` → check if encrypted mnemonic file exists
   - `invoke('create_wallet', { mnemonic, password })` → encrypt mnemonic with AES-256-GCM (Argon2 key derivation from password), save to app data dir
   - `invoke('unlock_wallet', { password })` → decrypt and return mnemonic words
   - `invoke('lock_wallet')` → clear mnemonic from memory
   - `invoke('delete_wallet')` → remove encrypted file (with confirmation)
   - Use `tauri::api::path::app_data_dir()` for storage location

2. **React: WalletContext** (`fe/src/contexts/WalletContext.tsx`)
   - Manages MeshWallet instance lifecycle
   - States: `no_wallet` → `locked` → `unlocked`
   - On unlock: receives mnemonic from Rust, creates MeshWallet instance
   - Provides `wallet: IWallet | null` to all components via context
   - Provides address, balance, network info

3. **React: WalletSetup page** (`fe/src/pages/WalletSetup.tsx`)
   - "Create New Wallet" flow:
     - Generate 24-word mnemonic (MeshWallet.brew() or bip39 library)
     - Display words with copy/write-down UI
     - Confirm: ask user to verify 3 random words
     - Set spending password (min 8 chars, confirm)
     - Call `invoke('create_wallet', { mnemonic, password })`
   - "Import Existing Wallet" flow:
     - 24-word input (paste or word-by-word)
     - Validate mnemonic (BIP-39 wordlist check)
     - Set spending password
     - Call `invoke('create_wallet', { mnemonic, password })`

4. **React: WalletUnlock page** (`fe/src/pages/WalletUnlock.tsx`)
   - Password input field
   - Call `invoke('unlock_wallet', { password })`
   - On success: create MeshWallet, navigate to dashboard
   - On failure: show error, allow retry
   - "Forgot password" → option to delete wallet and re-import

5. **React: ZK key derivation** (`fe/src/services/zkKeyDerivation.ts`)
   - Replace `walletSecret.ts`'s `deriveSecretFromWallet()`:
   - Derive ZK secret from wallet key material: `blake2b224(walletPaymentKey + ZK_DOMAIN_TAG)`
   - Deterministic: same mnemonic → same ZK secret
   - Update all call sites that use `deriveSecretFromWallet(wallet)` to use new derivation

6. **React: Update main.tsx and App.tsx**
   - Replace `MeshProvider` with `WalletProvider`
   - Route guards: redirect to WalletSetup (no wallet) or WalletUnlock (locked)
   - Dashboard only accessible when wallet is unlocked

**Verification**:
- Create wallet → 24 words shown → password set → encrypted file created
- Close app → reopen → password prompt → correct password unlocks
- Wrong password → error message
- Import 24 words from Eternl → same addresses shown
- `transactionBuilder.ts` receives MeshWallet via IWallet interface without changes

**Key dependencies**:
- Rust crates: `aes-gcm`, `argon2`, `serde`, `serde_json`
- npm: `@meshsdk/core` (MeshWallet class)

---

## Phase 2: Local Node Infrastructure [x]

**Goal**: Manage cardano-node, Ogmios, Kupo, and Mithril as child processes from Tauri. Provide sync status to the frontend.

**Inputs**: Phase 0 scaffold

### Implementation Status

**All code is written, compiles, and runs.** Both previous runtime issues are resolved. Mithril bootstrap downloads the preprod snapshot (~3.3GB, ~3 min), cardano-node replays the ledger from the snapshot (~10-30 min for preprod), then Ogmios and Kupo start automatically.

#### What's Done (compiles, not fully tested at runtime):
- `src-tauri/src/config.rs` — AppConfig with Network enum, directory helpers, Mithril URLs
- `src-tauri/src/process/mod.rs` — module declarations
- `src-tauri/src/process/manager.rs` — NodeManager with Arc<Mutex<HashMap>> process tracking, sidecar spawning via tauri-plugin-shell, stdout/stderr capture, Tauri event emission
- `src-tauri/src/process/cardano.rs` — CardanoNodeConfig, bundled config file copying from resources, CLI arg building
- `src-tauri/src/process/ogmios.rs` — args, health check, sync progress from /health endpoint
- `src-tauri/src/process/kupo.rs` — args, health check, default match patterns
- `src-tauri/src/process/mithril.rs` — digest fetching from aggregator API, progress parsing
- `src-tauri/src/commands/node.rs` — 6 Tauri commands (get_node_status, get_process_status, start_node, stop_node, start_mithril_bootstrap, get_process_logs), orchestrated startup (mithril → cardano-node → ogmios → kupo)
- `src-tauri/src/commands/config.rs` — 4 Tauri commands (get_network, set_network, get_data_dir, get_app_config)
- `src-tauri/src/lib.rs` — updated with config/process modules, shell plugin, state management, graceful shutdown
- `fe/src/contexts/NodeContext.tsx` — NodeProvider with event listeners + 5s polling
- `fe/src/pages/NodeSync.tsx` — full sync UI with progress bar, stage indicator, console log
- `fe/src/App.tsx` — /node-sync route, root redirect based on wallet + node state
- `fe/src/pages/Dashboard.tsx` — node sync indicator in nav (green/yellow/red/gray dot)
- `src-tauri/capabilities/default.json` — shell:allow-spawn, shell:allow-kill added
- `src-tauri/resources/cardano/preprod/` — config.json, topology.json, all genesis files present

#### Resolved: WebKitGTK Crash

**Fix**: Clearing the WebKit cache directory resolves the intermittent crash:
```bash
rm -rf ~/.local/share/com.peace-protocol.veiled-desktop/{WebKitCache,CacheStorage,storage,mediakeys,hsts-storage.sqlite}
```
Combined with the env vars already in `lib.rs`:
```rust
std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
```

#### Resolved: Mithril Client Command

**Fix**: Use `cardano-db download <digest> --backend v1` instead of the deprecated `snapshot download`.
- The raw HTTP API at `/artifact/snapshots` returns a `digest` field (not `hash` — the CLI reformats it)
- The v2 backend has a server-side bug on preprod; `--backend v1` works correctly
- v1 backend extracts to a `db/` subdirectory within `--download-dir`
- cardano-node `--database-path` must point to that `db/` subdirectory

#### Configuration Notes

- `tauri.conf.json` has `externalBin` in bundle config for all 4 sidecars
- `capabilities/default.json` has **scoped** `shell:allow-spawn` with `"sidecar": true` for each binary — bare `shell:allow-spawn` is insufficient
- In dev mode, `resource_dir()` points to `target/debug/` which may have stale resources; the code falls back to `src-tauri/resources/` (source tree)
- `devUrl` is `"http://127.0.0.1:5173"` (not localhost — WebKitGTK DNS workaround)
- `reqwest` needs `rustls-tls` feature for HTTPS: `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }`
- Preprod config files include `peer-snapshot.json` (required by cardano-node 10.5.x with GenesisMode)
- Real binaries are in `src-tauri/binaries/` with `-x86_64-unknown-linux-gnu` suffix (gitignored)

### Original Task List

**Tasks**:
1. **Rust: Process manager** (`src-tauri/src/process/manager.rs`)
   - Generic process lifecycle: start, stop, restart, health check
   - Stdout/stderr capture and logging
   - Graceful shutdown on app close (SIGTERM → wait → SIGKILL)
   - Auto-restart on crash (with backoff)
   - Process status enum: `Starting`, `Running`, `Syncing`, `Ready`, `Stopped`, `Error`

2. **Rust: cardano-node management** (`src-tauri/src/process/cardano.rs`)
   - Generate node config for selected network (preprod/mainnet)
   - Bundle config files: topology.json, config.json, genesis files
   - Start cardano-node with LMDB backend
   - Socket path management (for Ogmios connection)
   - Chain data directory per network: `app_data/preprod/node/` or `app_data/mainnet/node/`

3. **Rust: Ogmios management** (`src-tauri/src/process/ogmios.rs`)
   - Start Ogmios connected to cardano-node socket
   - Configure host/port (default: localhost:1337)
   - Health check: WebSocket connection test

4. **Rust: Kupo management** (`src-tauri/src/process/kupo.rs`)
   - Start Kupo connected to cardano-node socket (or Ogmios)
   - Configure match patterns: contract addresses + user wallet address
   - HTTP API on localhost:1442
   - SQLite database in app data directory
   - Update patterns when user address changes or contract config changes

5. **Rust: Mithril integration** (`src-tauri/src/process/mithril.rs`)
   - On first launch (no chain data): download snapshot via mithril-client
   - Progress reporting to frontend
   - Verify snapshot certificate
   - Extract to cardano-node data directory
   - Handle UTXO-HD format conversion if needed (cardano-node v10.4+)

6. **Rust: Node status commands** (`src-tauri/src/commands/node.rs`)
   - `invoke('get_node_status')` → { syncProgress, tip, epoch, slot, networkName }
   - `invoke('get_process_status')` → { node, ogmios, kupo, mithril } statuses
   - `invoke('start_node')` / `invoke('stop_node')` - manual control
   - `invoke('start_mithril_bootstrap')` → trigger snapshot download
   - Polling endpoint for frontend (or Tauri event system for push updates)

7. **Rust: Network config** (`src-tauri/src/commands/config.rs`)
   - `invoke('get_network')` → current network name
   - `invoke('set_network', { network })` → switch network (requires restart)
   - `invoke('get_data_dir')` → app data directory path
   - Store config in `app_data/config.json`

8. **React: NodeContext** (`fe/src/contexts/NodeContext.tsx`)
   - Polls `get_node_status` periodically
   - Provides sync status to all components
   - States: `bootstrapping` → `syncing` → `synced` → `error`

9. **React: NodeSync page** (`fe/src/pages/NodeSync.tsx`)
   - First-run: "Downloading blockchain snapshot..." with Mithril progress
   - Subsequent: "Syncing with network..." with block height progress
   - Show sync percentage, current epoch, estimated time remaining
   - Allow navigating to dashboard once sufficiently synced (e.g., 99%+)

10. **React: Header sync indicator**
    - Small indicator in dashboard header showing sync status
    - Green dot: fully synced, yellow: syncing, red: node not running

**Verification**:
- First launch: Mithril downloads preprod snapshot → cardano-node starts → Ogmios connects → Kupo starts indexing
- Subsequent launch: node resumes from last state → catches up to tip
- All processes shut down cleanly when app closes
- `invoke('get_node_status')` returns accurate sync progress
- Kupo HTTP API returns UTxOs for configured addresses

**Key dependencies**:
- Bundled binaries: cardano-node, ogmios, kupo, mithril-client
- Bundled configs: preprod + mainnet topology/genesis/config files
- Rust crates: `tokio` (async process management), `serde`, `reqwest` (health checks)

**Notes for implementer**:
- cardano-node configs can be downloaded from [IntersectMBO/cardano-playground](https://github.com/IntersectMBO/cardano-playground) or IOG's Cardano documentation
- Ogmios connects via the cardano-node socket file, not TCP
- Kupo can connect to either cardano-node directly or via Ogmios
- Mithril aggregator URLs differ per network (preprod vs mainnet)

---

## Phase 3: Data Layer (Kupo Adapter + Backend Swap) [x]

**Goal**: Wire the frontend's MeshTxBuilder to use local Ogmios (evaluation/submission) and Kupo (UTxO fetching). Adapt the Express backend to query Kupo for current state and Koios for historical data.

**Inputs**: Phase 0 scaffold, Phase 2 running infrastructure

**Tasks**:
1. **TypeScript: Kupo HTTP adapter** (`fe/src/services/kupoAdapter.ts`)
   - Implement MeshSDK's `IFetcher` interface
   - Methods to implement:
     - `fetchAddressUTxOs(address, asset?)` → query Kupo `GET /matches/{address}?unspent`
     - `fetchUTxOs(txHash, index?)` → query Kupo `GET /matches/{txHash}@{index}?unspent`
     - `fetchProtocolParameters()` → query Ogmios (or hardcode/cache)
     - `fetchAccountInfo(address)` → may need Koios fallback
   - Translate Kupo response format → MeshSDK UTxO format:
     - Kupo returns: `{ transaction_id, output_index, address, value, datum_hash, datum_type, script_hash, ... }`
     - MeshSDK expects: `{ input: { txHash, outputIndex }, output: { address, amount, dataHash, plutusData, scriptRef, ... } }`
   - Handle inline datums (Kupo returns datum content directly)
   - Handle native assets (Kupo's value format → MeshSDK's amount format)
   - Reference: [Kupo HTTP API docs](https://cardanosolutions.github.io/kupo/) and [kupo-js-starter-kit](https://github.com/CardanoSolutions/kupo-js-starter-kit)

2. **TypeScript: Wire MeshTxBuilder providers** (adapt `transactionBuilder.ts` initialization)
   - The transaction builder functions take `wallet: IWallet` and create MeshTxBuilder internally
   - Find where `BlockfrostProvider` is instantiated and replace with:
     ```typescript
     const ogmios = new OgmiosProvider('ws://localhost:1337')
     const kupo = new KupoAdapter('http://localhost:1442')
     const txBuilder = new MeshTxBuilder({
       fetcher: kupo,
       evaluator: ogmios,
     })
     ```
   - MeshWallet should also use these providers:
     ```typescript
     const wallet = new MeshWallet({
       networkId: 0,
       fetcher: kupo,
       submitter: ogmios,
       key: { type: 'mnemonic', words: mnemonic },
     })
     ```
   - Note: `transactionBuilder.ts` creates `BlockfrostProvider` in a few places for direct API calls (`fetchRewardBalance`, `fetchCurrentSlot`). These need Kupo/Ogmios equivalents.

3. **TypeScript: Backend Kupo client** (`be/src/services/kupo.ts`)
   - HTTP client for Kupo's REST API
   - Methods matching current `koios.ts` interface:
     - `getAddressUtxos(address)` → Kupo `GET /matches/{address}?unspent`
     - `getAssetUtxos(policyId, assetName)` → Kupo `GET /matches/{policyId}.{assetName}?unspent`
     - `getScriptUtxos(scriptHash)` → Kupo `GET /matches/{scriptHash}/*?unspent`
   - Parse Kupo datums (inline datums returned directly)

4. **TypeScript: Adapt backend routes**
   - `be/src/routes/encryptions.ts` → use Kupo client for current encryption UTxOs
   - `be/src/routes/bids.ts` → use Kupo client for current bid UTxOs
   - `be/src/routes/protocol.ts` → protocol params from Ogmios, reference UTxOs from Kupo
   - Keep Koios for: `getTxInfo()`, `getTxMetadata()`, address history queries

5. **TypeScript: Handle two direct Blockfrost calls in transactionBuilder.ts**
   - `fetchRewardBalance(stakeAddress)` (line ~1754): use Ogmios Local State Query or Koios
   - `fetchCurrentSlot()` (line ~1780): use Ogmios chain tip query

**Verification**:
- KupoAdapter.fetchAddressUTxOs() returns correctly formatted MeshSDK UTxOs
- MeshTxBuilder.complete() successfully evaluates a Plutus transaction via Ogmios
- Express `/api/encryptions` returns listings from Kupo (same format as before)
- Express `/api/bids` returns bids from Kupo
- End-to-end: build a create-listing transaction using local stack only

**Reference files**:
- `app/ui/fe/src/services/transactionBuilder.ts` - lines 180-190 (BlockfrostProvider creation), lines 1754-1790 (direct API calls)
- `app/ui/be/src/services/koios.ts` - current data fetching interface to match
- [Kupo HTTP API reference](https://cardanosolutions.github.io/kupo/)
- [MeshSDK OgmiosProvider](https://meshjs.dev/providers/ogmios)

---

## Phase 4: Native SNARK Prover [x]

**Goal**: Replace the browser WASM SNARK prover with native `snark_cli` invocation via Tauri. Ship setup files compressed in the installer.

**Inputs**: Phase 0 scaffold, `app/snark/` (existing Go prover source)

**Tasks**:
1. **Rust: SNARK commands** (`src-tauri/src/commands/snark.rs`)
   - `invoke('snark_prove', { a, r, v, w0, w1 })`:
     - Spawn `snark_cli prove -a <a> -r <r> -v <v> -w0 <w0> -w1 <w1> -setup <setup_dir> -out <out_dir>`
     - Stream progress via Tauri events (if snark_cli outputs progress)
     - Return: `{ proofJson, publicJson }` parsed from output files
   - `invoke('snark_gt_to_hash', { a })`:
     - Spawn `snark_cli gt-to-hash -a <a> -setup <setup_dir>`
     - Return: hash string
   - `invoke('snark_decrypt_to_hash', { g1b, r1, shared, g2b })`:
     - Spawn `snark_cli decrypt-to-hash -g1b <g1b> -r1 <r1> -shared <shared> -g2b <g2b>`
     - Return: hash string
   - `invoke('snark_check_setup')` → verify pk.bin + ccs.bin exist in app data dir
   - `invoke('snark_decompress_setup')` → decompress shipped files on first launch

2. **Rust: Setup file management**
   - On install: compressed pk.bin.zst + ccs.bin.zst in app bundle
   - On first launch: decompress to `app_data/snark/` directory
   - Progress reporting for decompression
   - Verify file integrity (size check or checksum)

3. **TypeScript: Replace SnarkProver** (`fe/src/services/snark/prover.ts`)
   - Remove Web Worker dependency
   - Replace `worker.postMessage()` calls with `invoke()`:
     ```typescript
     // Before (WASM Web Worker):
     this.worker.postMessage({ type: 'prove', secretA, secretR, ... })
     // After (Tauri native):
     const result = await invoke('snark_prove', { a: secretA, r: secretR, ... })
     ```
   - Keep the same `SnarkProver` class API so components don't change
   - Remove: `storage.ts` (IndexedDB caching), `worker.ts` (Web Worker)
   - Remove: download/cache logic, WASM loading progress

4. **React: Update SnarkProvingModal**
   - Remove WASM loading states (loading-wasm, loading-keys stages)
   - Simplify to: checking-setup → proving → complete
   - Update time estimate: "~3 minutes" instead of "10-30 seconds" (WASM was aspirational)

5. **Build: snark_cli binary**
   - Build from `app/snark/` for each target platform:
     - `GOOS=linux GOARCH=amd64 go build -o snark_cli-x86_64-unknown-linux-gnu`
     - `GOOS=darwin GOARCH=amd64 go build -o snark_cli-x86_64-apple-darwin`
     - `GOOS=darwin GOARCH=arm64 go build -o snark_cli-aarch64-apple-darwin`
     - `GOOS=windows GOARCH=amd64 go build -o snark_cli-x86_64-pc-windows-msvc.exe`
   - Place in `src-tauri/binaries/`
   - Configure in `tauri.conf.json` externalBin

6. **Build: Compress setup files**
   - Compress `pk.bin` + `ccs.bin` with zstd (best compression ratio for binary data)
   - Include compressed files as Tauri resources
   - Document the compression/decompression in build scripts

**Verification**:
- `invoke('snark_check_setup')` returns true after first-launch decompression
- `invoke('snark_prove', ...)` completes in ~3 minutes and returns valid proof
- `invoke('snark_gt_to_hash', ...)` returns correct hash
- `invoke('snark_decrypt_to_hash', ...)` returns correct hash
- SnarkProvingModal shows progress and completes successfully
- Old WASM files (prover.wasm, wasm_exec.js) are not included in build

**Reference files**:
- `app/snark/main.go` - CLI entry point with all commands
- `app/ui/fe/src/services/snark/prover.ts` - current WASM prover API to match
- `app/ui/fe/src/services/snark/worker.ts` - current Web Worker (to be replaced)
- `app/ui/fe/src/components/SnarkProvingModal.tsx` - UI to adapt

---

## Phase 5: Integration + Polish + Packaging [ ]

**Goal**: Wire all phases together, implement the complete first-run experience, build installers for all platforms.

**Inputs**: All previous phases complete

**Tasks**:
1. **First-run experience flow**:
   - App launches → check for wallet → WalletSetup (create/import)
   - After wallet setup → check for chain data → Mithril bootstrap (NodeSync page)
   - Decompress SNARK setup files (can run alongside node sync)
   - After sync reaches 99%+ → navigate to Dashboard
   - All processes running: node, ogmios, kupo, express

2. **Settings page**:
   - Network toggle (preprod/mainnet) with restart required notice
   - Node status display (sync %, tip, epoch)
   - Wallet info (address, balance, option to view mnemonic with password re-entry)
   - Data directory location and disk usage
   - Advanced: process status, logs viewer

3. **Error handling & recovery**:
   - Node crash → auto-restart with backoff
   - Ogmios disconnect → reconnect loop
   - Kupo crash → auto-restart
   - Express crash → auto-restart
   - Network issues → offline indicator, queue transactions
   - Mithril download failure → retry with resume

4. **App lifecycle**:
   - On launch: start processes in order (node → ogmios → kupo → express)
   - On close: graceful shutdown (SIGTERM all processes, wait, SIGKILL)
   - System tray: minimize to tray option (node keeps running)
   - Auto-update: Tauri's built-in updater

5. **Platform packaging**:
   - Linux: AppImage or deb (bundled binaries)
   - macOS: dmg (bundled binaries, codesign)
   - Windows: msi or nsis (bundled binaries)
   - Include all binaries per platform in `src-tauri/binaries/`
   - Include compressed SNARK files as resources
   - Include network config files (preprod + mainnet)

6. **Testing**:
   - Full marketplace flow on preprod:
     1. Create wallet → verify address and balance
     2. Create encryption listing → appears in marketplace
     3. (Second wallet) Place bid → appears in seller's view
     4. Accept bid (SNARK) → proof in ~3 min → tx submits
     5. Decrypt → buyer sees the original data
   - App restart: node resumes, wallet locks, everything recovers
   - Network switch: preprod → mainnet config changes correctly

**Verification**:
- Complete end-to-end marketplace flow works on preprod
- App installs clean on Linux, macOS, Windows
- First-run experience is smooth (Mithril → wallet → dashboard)
- All processes manage lifecycle correctly (start, stop, crash recovery)
- Settings network toggle works (separate chain data directories)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| cardano-node 8GB RAM (mainnet) too heavy | Medium | High | Default preprod (~4GB). Document requirements. |
| 300GB disk for mainnet | Medium | Medium | Preprod default (~30GB). Mainnet opt-in. |
| MeshWallet missing IFetcher/ISubmitter methods | Low | High | Test in Phase 1. Fallback: create custom wallet wrapper. |
| Kupo → MeshSDK UTxO format translation errors | Medium | High | Use kupo-js-starter-kit as reference. Extensive testing. |
| Cross-platform binary bundling complexity | High | Medium | Start with Linux only. Add macOS/Windows incrementally. |
| cardano-node version incompatible with Ogmios/Kupo | Medium | High | Pin compatible versions. Test together. |
| Mithril snapshot UTXO-HD format conversion | Medium | Medium | Follow Mithril docs for cardano-node v10.4+ conversion. |
| Large installer (~700MB) deters users | Low | Medium | Compressed installer. Clear UX about what's included. |

---

## Version Compatibility Matrix

Pin these versions together (update as a set):

| Component | Version | Notes |
|-----------|---------|-------|
| cardano-node | 10.4.x | LMDB/OnDisk backend, UTXO-HD |
| ogmios | 6.x | Must match node version |
| kupo | 2.x | Works with node 10.x |
| mithril-client | 0.11.x | Must match aggregator version |
| MeshSDK | 1.8.x+ | MeshWallet + OgmiosProvider |
| Tauri | 2.x | Current stable |
| snark_cli | (custom) | Built from app/snark/ |

---

## Quick Reference: What Each AI Context Window Needs

### Phase 0 context:
- This goals.md file (architecture + directory structure)
- `app/ui/fe/package.json` (dependencies to copy)
- `app/ui/be/package.json` (dependencies to copy)
- Tauri v2 docs: https://v2.tauri.app/start/

### Phase 1 context:
- This goals.md Phase 1 section
- `app/ui/fe/src/main.tsx` (current entry point)
- `app/ui/fe/src/App.tsx` (current routing)
- `app/ui/fe/src/services/crypto/walletSecret.ts` (to be replaced)
- `app/ui/fe/src/hooks/useWalletPersistence.ts` (to be replaced)
- MeshSDK MeshWallet docs: https://meshjs.dev/apis/wallets/mesh-wallet
- Tauri commands docs: https://v2.tauri.app/develop/calling-rust/

### Phase 2 context:
- This goals.md Phase 2 section
- Mithril bootstrap: https://mithril.network/doc/manual/getting-started/bootstrap-cardano-node/
- Ogmios docs: https://ogmios.dev/
- Kupo docs: https://cardanosolutions.github.io/kupo/
- cardano-node configs: https://book.play.dev.cardano.org/environments.html
- Tauri process management / sidecar docs

### Phase 3 context:
- This goals.md Phase 3 section
- `app/ui/fe/src/services/transactionBuilder.ts` (provider replacement points)
- `app/ui/be/src/services/koios.ts` (interface to match)
- `app/ui/be/src/routes/encryptions.ts` (data queries to adapt)
- `app/ui/be/src/routes/bids.ts`
- Kupo HTTP API: https://cardanosolutions.github.io/kupo/
- MeshSDK provider interfaces: https://meshjs.dev/providers

### Phase 4 context:
- This goals.md Phase 4 section
- `app/snark/main.go` (CLI commands and flags)
- `app/ui/fe/src/services/snark/prover.ts` (API to preserve)
- `app/ui/fe/src/services/snark/worker.ts` (to be removed)
- `app/ui/fe/src/services/snark/storage.ts` (to be removed)
- `app/ui/fe/src/components/SnarkProvingModal.tsx` (to adapt)
- Tauri sidecar docs: https://v2.tauri.app/develop/sidecar/

### Phase 5 context:
- This goals.md Phase 5 section
- All outputs from previous phases
- Tauri packaging docs: https://v2.tauri.app/distribute/
- Tauri updater docs: https://v2.tauri.app/plugin/updater/
