# Veiled Desktop App — Architecture Reference

## Architecture Overview

Three-layer Tauri v2 desktop app for the PEACE Protocol encrypted data marketplace.

```
React Frontend (fe/)          ← UI, crypto, tx building
    ↕ REST (localhost:3001)       ↕ Tauri IPC (invoke/listen)
Express Backend (be/)         Rust Core (src-tauri/)
    ↕ HTTP                        ↕ child processes
Kupo (UTxOs) + Koios (history)    cardano-node, Ogmios, Kupo, Mithril, snark
```

**Process startup order:** Mithril bootstrap (first run) → cardano-node → Ogmios → Kupo → Express

**Communication channels:**
- **Tauri IPC** (`invoke`/`listen`): wallet ops, node control, SNARK proving, secrets storage, config
- **REST API** (port 3001): blockchain data queries (encryptions, bids, protocol config)
- **WebSocket** (port 1337): Ogmios for tx evaluation & submission (used by MeshTxBuilder)
- **HTTP** (port 1442): Kupo for UTxO fetching (used by KupoAdapter)

## Directory Structure

```
app/gui/
├── fe/                              # React 19 frontend (Vite)
│   ├── src/
│   │   ├── App.tsx                  # Router + auth/state guards
│   │   ├── main.tsx                 # Entry: ErrorBoundary → Wallet → Node → Wasm → Router
│   │   ├── index.css                # CSS variables (dark theme) + Tailwind v4
│   │   ├── config/                 # App configuration
│   │   │   └── categories.ts      # File category definitions + integration flags
│   │   ├── contexts/               # WalletContext, NodeContext, WasmContext
│   │   ├── pages/                   # WalletSetup, WalletUnlock, NodeSync, Dashboard, Settings
│   │   ├── components/              # Tabs, modals, cards, presentational
│   │   ├── services/
│   │   │   ├── api.ts               # REST client for backend
│   │   │   ├── providers.ts         # Kupo + Ogmios singletons
│   │   │   ├── kupoAdapter.ts       # IFetcher implementation for MeshSDK
│   │   │   ├── transactionBuilder.ts # All tx building (~1780 lines)
│   │   │   ├── autolock.ts          # Inactivity auto-lock timer config (localStorage)
│   │   │   ├── imageCache.ts        # Tauri IPC client for image download/cache/ban
│   │   │   ├── secretCleanup.ts     # Deferred secret deletion after on-chain confirmation
│   │   │   ├── crypto/              # BLS12-381, Schnorr, ECIES, CBOR, ZK key derivation
│   │   │   ├── snark/               # Native SNARK prover interface
│   │   │   └── *Storage.ts          # localStorage: secrets, bids, accept-bid, tx history
│   │   ├── hooks/                   # useSnarkProver
│   │   └── utils/                   # clipboard, network (blockscout URLs)
│   └── vite.config.ts               # WASM, top-level-await, node polyfills
├── be/                              # Express v5 backend (TypeScript)
│   ├── src/
│   │   ├── index.ts                 # Server entry (port 3001, CORS)
│   │   ├── config/index.ts          # Env-based config (network, ports, contracts)
│   │   ├── routes/                  # encryptions, bids, protocol, chain
│   │   ├── services/
│   │   │   ├── kupo.ts              # Kupo HTTP client (current UTxOs)
│   │   │   ├── cbor.ts              # CBOR decoder + slot-to-time (extracted from kupo.ts)
│   │   │   ├── koios.ts             # Koios REST client (history, metadata, params)
│   │   │   ├── encryptions.ts       # Encryption query logic
│   │   │   ├── bids.ts              # Bid query logic
│   │   │   └── parsers.ts           # CBOR/Plutus datum → TypeScript
│   │   ├── types/index.ts           # All backend type definitions
│   │   └── stubs/                   # Hardcoded sample data for dev mode
│   └── dist/                        # Compiled JS (tsc output) — Tauri runs this
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                   # App setup, plugins, state, event handlers
│   │   ├── config.rs                # AppConfig, Network, ContractConfig
│   │   ├── crypto/
│   │   │   ├── wallet.rs            # AES-256-GCM + Argon2id wallet encryption
│   │   │   └── secrets.rs           # AES key derivation for secrets storage
│   │   ├── process/
│   │   │   ├── manager.rs           # Generic process lifecycle + restart policy
│   │   │   ├── cardano.rs           # cardano-node config & lifecycle
│   │   │   ├── ogmios.rs            # Ogmios (port 1337)
│   │   │   ├── kupo.rs              # Kupo (port 1442)
│   │   │   ├── mithril.rs           # Mithril snapshot bootstrap
│   │   │   └── express.rs           # Express backend (port 3001)
│   │   └── commands/
│   │       ├── wallet.rs            # create, unlock, lock, delete, reveal
│   │       ├── node.rs              # start, stop, status, bootstrap
│   │       ├── config.rs            # get/set network, disk usage
│   │       ├── snark.rs             # prove, gt-to-hash, decrypt-to-hash, setup
│   │       ├── secrets.rs           # store/get/remove seller, bid, accept-bid secrets
│   │       └── media.rs             # image download, cache, ban/unban, delete
│   ├── resources/
│   │   ├── config.json              # Contract addresses, policy IDs, ports
│   │   ├── cardano/{network}/       # Node configs (topology, genesis files)
│   │   └── snark/vk.json            # SNARK verification key
│   ├── binaries/                    # Sidecar binaries (gitignored, ~600MB)
│   ├── capabilities/default.json    # Scoped permissions (shell:allow-spawn)
│   ├── tauri.conf.json              # Window 1280x800, devUrl 127.0.0.1:5173
│   └── Cargo.toml                   # Rust deps: tauri, serde, argon2, aes-gcm
├── build.sh                         # Runs `npm run install:all && tauri build`
├── run.sh                           # Runs `npm run install:all && tauri dev` (with WebKit env vars)
├── lint.sh                          # eslint (fe), tsc (be), cargo fmt, clippy
├── test.sh                          # vitest (fe) + vitest (be)
└── CHANGELOG.md                     # Version history
```

## Frontend Patterns

**Stack:** React 19 + Vite 7 + Tailwind v4 + React Router v7 + MeshSDK 1.8

**State management — 3 React Contexts** (nested in main.tsx):
- `WalletContext` — lifecycle (`loading`→`no_wallet`→`locked`→`unlocked`), MeshWallet instance, address, balance, payment key hex
- `NodeContext` — stage (`stopped`→`bootstrapping`→`starting`→`syncing`→`synced`→`error`), sync progress, tip slot/height, process info
- `WasmContext` — SNARK setup files (`idle`→`checking-cache`→`decompressing`→`ready`→`error`)

**Routing** (App.tsx guards based on wallet + node state):
| Route | Guard | Component |
|---|---|---|
| `/wallet-setup` | no_wallet | WalletSetup (create/import mnemonic) |
| `/wallet-unlock` | locked | WalletUnlock (password entry) |
| `/node-sync` | unlocked + node not synced | NodeSync (progress bars) |
| `/dashboard` | unlocked + node synced | Dashboard (4 tabs) |
| `/settings` | unlocked | Settings |

**Component hierarchy:** Pages → Tab components (Marketplace, MySales, MyPurchases, History) → Modal components (CreateListing, PlaceBid, Decrypt, SnarkProving, SnarkDownload, Bids, Confirm, Description) → Card components (EncryptionCard, SalesListingCard, MyPurchaseBidCard, ListingImage) + descriptionUtils

**Transaction building** (fe/src/services/transactionBuilder.ts ~1780 lines):
- `createListing()`, `placeBid()`, `cancelBid()`, `removeListing()`, `cancelPendingListing()`
- `acceptBidSnark()`, `prepareSnarkInputs()`, `completeReEncryption()`
- `extractPaymentKeyHash()`, `isRealTransactionsAvailable()`, `getTransactionStubWarning()`
- Uses MeshTxBuilder with local Kupo (IFetcher) + Ogmios (ISubmitter/IEvaluator)

**Crypto services** (fe/src/services/crypto/):
- `bls12381.ts` — BLS12-381 G1/G2 operations via @noble/curves
- `schnorr.ts` — Schnorr signature proofs
- `ecies.ts` — ECIES encryption/decryption
- `binding.ts` — Binding proofs for secrets
- `register.ts` — BLS12-381 key registers
- `payload.ts` — CBOR serialization via cborg
- `createEncryption.ts` / `createBid.ts` — Full artifact creation
- `zkKeyDerivation.ts` — Deterministic ZK secret from wallet key material
- `constants.ts` — Domain tags, public G2 points
- `decrypt.ts` — Decryption flow (native CLI required for BLS pairings)
- `hashing.ts` — Hashing utilities
- `level.ts` — HalfLevel/FullLevel type definitions
- `walletSecret.ts` — BLS secret derivation from wallet signature

**Local storage** (fe/src/services/*Storage.ts + autolock.ts):
- `secretStorage` — encryption secrets by token name
- `bidSecretStorage` — bid secrets for later decryption
- `acceptBidStorage` — accept-bid workflow state (A0, R0, Hk, proof)
- `transactionHistory` — tx log with timestamps and hashes
- `autolock` — inactivity timeout in minutes (default 15, 0 = never)

**Styling:** Dark theme via CSS custom properties in index.css, Tailwind utility classes, fonts Inter + JetBrains Mono. Hard-coded dark mode (no light theme). All colors via CSS variables (`--bg-*`, `--text-*`, `--accent`, `--success`, `--error`, etc.) with `--radius-*`, `--shadow-*`, `--transition-*` tokens. No per-component CSS files — all inline Tailwind utilities + variables.

**Error handling — two tiers:**
- `ErrorBoundary` (class component) wraps the entire app in main.tsx — catches React render errors only, NOT async/promise rejections. `InlineErrorBoundary` variant for section-level recovery.
- `useToast()` hook (components/Toast.tsx) — `success()`, `error()`, `warning()`, `info()`, and `transactionSuccess(title, txHash)` which auto-links to CardanoScan. Default 5000ms auto-dismiss; error default 8000ms; `duration: 0` = sticky (never auto-dismisses).
- Async errors in event handlers/tx submission must be caught with explicit try-catch → shown via `toast.error()`.

**Modal pattern (critical — all modals follow this):**
- **Two separate useEffect hooks** to avoid form reset on every keystroke:
  - Effect 1: `[isOpen]` — resets form state, clears errors (fires only on open/close transition)
  - Effect 2: `[isOpen, isSubmitting, onClose]` — Escape key handler + `body.style.overflow`
- Combining these into one effect will clear the form on every state change
- Rendering: fixed `z-50` backdrop (`bg-black/60 backdrop-blur-sm`), click-to-close disabled during `isSubmitting`
- Form validation: `validateForm()` on submit, field errors cleared on keystroke, submit errors shown separately
- No modal library (no Radix Dialog) — all manual with consistent pattern

**Data refresh & polling:**
- `NodeContext` polls `get_node_status` every 5000ms via `setInterval`
- Balance refreshed when `tipSlot` changes (App.tsx); eager refresh on Dashboard mount
- Tx confirmation: escalating `setTimeout` — 20s → 45s → 90s → 180s after submission
- No React Query/SWR — all manual polling with setInterval/setTimeout
- `lovelace` from WalletContext can be `null` before Kupo is running — all consumers must handle nullish

**Transaction flow** (user action → confirmation):
1. User action → modal opens
2. Form submit → `isSubmitting = true`, UI disabled
3. Dashboard callback (e.g., `placeBid()`) calls `transactionBuilder.ts`
4. MeshTxBuilder assembles tx → `wallet.submitTx()` → returns `{ success, txHash, error }`
5. `recordTransaction()` stores as pending in localStorage (keyed by wallet PKH)
6. `toast.transactionSuccess()` with CardanoScan link
7. Escalating polling (20/45/90/180s) checks `/api/chain/confirmations/:txHash`
8. No automatic retry on failure — user must retry manually

## Backend Patterns

**Stack:** Express v5, TypeScript, port 3001. Stateless and read-only — all state lives on-chain.

**Two data sources:**
- **Kupo** (localhost:1442) — current UTxO state at contract addresses
- **Koios** (preprod.koios.rest) — historical tx data, CIP-20 metadata, protocol params

**Route groups:**
- `GET /api/encryptions[/:tokenName|/user/:pkh|/status/:status|/:tokenName/levels]`
- `GET /api/bids[/:tokenName|/user/:pkh|/encryption/:token|/status/:status]`
- `GET /api/protocol[/config|/reference|/scripts|/params]`
- `GET /api/chain/confirmations/:txHash`
- `GET /health` — status, network, useStubs, timestamp

**Datum parsing** (be/src/services/parsers.ts): Decodes CBOR/Plutus JSON inline datums into TypeScript types. Handles indefinite-length byte strings (G2 points > 64 bytes are CBOR-chunked).

**CIP-20 metadata** (key 674): Encryption creation tx includes `{ msg: [description, suggestedPrice, storageLayer, imageLink?, category?] }`. Bid creation tx includes `{ msg: [futurePrice] }`.

**Error responses:** All routes return `{ error: { code, message } }` on failure. 500 for internal errors (real message in dev, generic in prod), 404 for missing endpoints. Malformed datums at contract addresses are silently skipped with a console warning — frontend sees incomplete data. No retry/circuit-breaker for Kupo/Koios failures.

**Stub mode:** When `USE_STUBS=true`, all endpoints return hardcoded sample data. No Kupo/Koios needed.

## Tauri/Rust Core

**Process management** (src-tauri/src/process/):
- 5 child processes: cardano-node, Ogmios, Kupo, Mithril, Express (node.js)
- Two spawn methods: sidecar (`tauri_plugin_shell`) for bundled binaries vs `tokio::process::Command` for Express/Node.js
- Auto-restart with exponential backoff (max 5 retries, 1s initial delay, 2x multiplier → up to 31s total)
- Circular log buffer (500 lines per process), emitted as Tauri events
- SIGTERM → 10s wait → SIGKILL; total shutdown budget 30s
- Linux: uses `libc::kill` directly (avoids AppImage /usr/bin/kill issues)
- Orphan cleanup on startup: reads `managed_pids.json` from previous session → SIGTERM → 30s → SIGKILL; also port-scans 3001/1337/1442
- Health check: only Express has one (`GET /health`); no built-in checks for cardano-node/Ogmios/Kupo

**Wallet** (src-tauri/src/crypto/wallet.rs):
- AES-256-GCM encryption with Argon2id KDF (m=64MiB, t=3, p=4)
- Stored as JSON: `{ version, salt, nonce, ciphertext }` at `app_data_dir/wallet.json`
- Mnemonic held in memory only while unlocked; zeroed on lock

**Secrets** (src-tauri/src/commands/secrets.rs):
- AES key derived from mnemonic via `derive_secrets_key()` — Argon2id with light params (4 MiB, 1 iter), fixed salt `"PEACE_SECRETS_V1"`
- File format: `{ version: 1, nonce: hex(12 bytes), ciphertext: hex }` (AES-256-GCM)
- Three secret types stored in `app_data_dir/secrets/`:
  - `seller/{token_name}.json` — `{ a, r }` scalars
  - `bid/{encryption_token}.json` — array of `{ bidTokenName, sk_bid }`
  - `accept-bid/{encryption_token}.json` — `{ A0, R0, Hk, proof }` workflow state
- Secure delete: overwrite zeros → flush → `fs::remove_file()`
- All Tauri commands return `Result<T, String>` — no custom error types, all stringified

**SNARK** (src-tauri/src/commands/snark.rs):
- Sidecar binary `binaries/snark` with CLI: `snark prove -a <a> -r <r> -v <v> -w0 <w0> -w1 <w1> -setup <dir> -out <dir>`, `snark hash -a <a>`, `snark decrypt -g1b <g1b> -r1 <r1> -shared <shared> [-g2b <g2b>]`
- Setup files (`pk.bin.zst` ~350MB, `ccs.bin.zst` ~250MB) decompressed on first launch to `app_data_dir/snark/`
- Prove outputs `proof.json` + `public.json` in temp directory; returned as raw text to frontend
- ~3 min proving time (vs 106 min in browser WASM); no timeout

**Config** (src-tauri/src/config.rs):
- `resources/config.json` is the single source of truth for contract addresses and policy IDs
- Network toggle (preprod/mainnet) with separate chain data directories
- Express env vars generated from config: NETWORK, KUPO_URL, contract addresses

## Key Types

**On-chain datums** (defined in both fe and be):
- `EncryptionDatum` — owner_vkh, owner_g1 (Register), token, half_level, full_level|null, capsule, status (Open|Pending)
- `BidDatum` — owner_vkh, owner_g1 (Register), pointer (bid token), token (encryption token)
- `Register` — { generator: hex, public_value: hex } (BLS12-381 G1 points, 96 hex chars each)
- `Capsule` — { nonce: 24 hex, aad: 64 hex, ct: variable hex } (ChaCha20-Poly1305)
- `HalfEncryptionLevel` — { r1b, r2_g1b, r4b } (G1, G1, G2)
- `FullEncryptionLevel` — { r1b, r2_g1b, r2_g2b, r4b } (G1, G1, G2, G2)

**Display models** (be types, consumed by fe):
- `EncryptionDisplay` — tokenName, seller, sellerPkh, status, description?, suggestedPrice?, storageLayer?, imageLink?, category?, createdAt, utxo, datum
- `BidDisplay` — tokenName, bidder, bidderPkh, encryptionToken, amount, futurePrice?, status, createdAt, utxo, datum
- `ProtocolConfig` — network, contracts (addresses + policy IDs), referenceScripts (UTxO refs), genesisToken

**Frontend state types:**
- `WalletLifecycle`: loading | no_wallet | locked | unlocked
- `NodeStage`: stopped | bootstrapping | starting | syncing | synced | error
- `WasmStage`: idle | checking-cache | decompressing | ready | error

## API Surface

**Tauri commands** (invoke from frontend):
- Wallet: `wallet_exists`, `create_wallet`, `unlock_wallet`, `lock_wallet`, `delete_wallet`, `reveal_mnemonic`
- Node: `start_node`, `stop_node`, `get_node_status`, `get_process_status`, `start_mithril_bootstrap`, `get_process_logs`
- Config: `get_network`, `set_network`, `get_data_dir`, `get_app_config`, `get_disk_usage`
- SNARK: `snark_check_setup`, `snark_decompress_setup`, `snark_prove`, `snark_gt_to_hash`, `snark_decrypt_to_hash`
- Secrets: `store_seller_secrets`, `get_seller_secrets`, `remove_seller_secrets`, `list_seller_secrets`, `store_bid_secrets`, `get_bid_secrets`, `get_bid_secrets_for_encryption`, `remove_bid_secrets`, `store_accept_bid_secrets`, `get_accept_bid_secrets`, `remove_accept_bid_secrets`, `has_accept_bid_secrets`
- Media: `download_image`, `get_cached_image`, `list_cached_images`, `ban_image`, `unban_image`, `delete_cached_image`, `save_content`

**Tauri events** (listen from frontend):
- `process-status` — stdout/stderr log lines from child processes
- `mithril-progress` — download percentage during bootstrap
- `snark-setup-progress` — decompression progress for setup files

## Development Workflow

**Start dev environment:**
```bash
cd app/gui && npx tauri dev    # Starts Vite (5173) + Tauri window
# Backend must be built separately if changed:
cd app/gui/be && npm run build  # REQUIRED after any backend TS change
```

**CRITICAL:** Tauri runs `node dist/index.js`, NOT `tsx src/index.ts`. Frontend hot-reloads via Vite; backend does NOT. Every backend change needs `cd be && npm run build`.

**Stub mode:** Set `USE_STUBS=true` in `be/.env` to develop without running cardano-node/Kupo.

**Tests:** `cd app/gui && bash test.sh` (runs both frontend + backend tests)
- Frontend: `cd fe && npm test` (Vitest + jsdom)
- Backend: `cd be && npm test` (Vitest + node)
- Frontend test locations:
  - `fe/src/services/crypto/__tests__/` — bls12381, hashing, payload, snark-inputs, schnorr, binding, ecies, register, level, constants, zkKeyDerivation, createEncryption, createBid, walletSecret
  - `fe/src/services/__tests__/` — transactionBuilder, transactionHistory, autolock
  - `fe/src/config/__tests__/` — categories
  - `fe/src/hooks/__tests__/` — usePasswordStrength
  - `fe/src/utils/` — clipboard, network
- Backend test locations:
  - `be/src/services/__tests__/` — parsers (datum + CIP-20), kupo-cbor, kupo (matchToKoiosUtxo)
- Setup file (`fe/src/test/setup.ts`) mocks `matchMedia`, `clipboard`, `ResizeObserver` (guarded for node environment)
- Tests using WebCrypto (ecies) use `// @vitest-environment node` pragma
- Tests importing transactionBuilder mock `@meshsdk/core`, `@meshsdk/provider`, and Tauri storage modules to avoid libsodium WASM
- No component or integration tests — adding them requires mocking Tauri invoke + context providers

**Production build:** `npx tauri build` (creates platform installer with bundled binaries)

**Version bump** (update ALL of these):
1. `src-tauri/tauri.conf.json` — version
2. `src-tauri/Cargo.toml` — version
3. `package.json` — version
4. `fe/package.json` — version
5. `be/package.json` — version
6. `CHANGELOG.md` — new entry at top

## Conventions & Gotchas

- **127.0.0.1 not localhost** — WebKitGTK on Linux has DNS resolution issues; all local URLs use 127.0.0.1
- **WebKitGTK env vars** — `WEBKIT_DISABLE_DMABUF_RENDERER=1` and sandbox disabled (Linux only, set in lib.rs)
- **Kupo CBOR chunking** — G2 points (>64 bytes) use indefinite-length CBOR byte strings; parser handles chunk reassembly
- **Slot-to-time conversion** — Network-specific Shelley era offsets (preprod vs mainnet); implemented in be/src/services/cbor.ts
- **Sidecar binaries** — gitignored, platform-specific (~600MB total); must be placed in `src-tauri/binaries/` before build
- **CSP is null** — permissive content security policy; acceptable for desktop but not web
- **FixedOgmiosProvider** — Patches Ogmios response tags (WITHDRAW → REWARD) for MeshTxBuilder compatibility
- **MeshWallet** — Uses same IWallet interface as browser wallets; zero changes needed in transactionBuilder.ts
- **No path aliases** — all frontend imports are relative (`../`, `./`); no `@/` shortcuts configured
- **Node polyfills required** — `buffer`, `crypto`, `stream`, `util`, `events`, `process` polyfilled via vite-plugin-node-polyfills for MeshSDK
- **Balance is nullable** — `lovelace` from WalletContext can be `null` before Kupo runs; handle with `??` or `?.`
- **ErrorBoundary doesn't catch async** — only React render errors; async rejections need explicit try-catch + toast
- **Modal two-effect pattern** — combining form reset + keyboard effects into one useEffect clears form on every keystroke
- **No Express param validation** — tokenName, pkh params are not sanitized or validated (except status enum)
- **Datum parsing failures are silent** — bad datums logged as warnings, skipped from results; frontend sees incomplete data
- **Auto-lock timer** — configurable inactivity timeout (default 15 min, 0 = never); stored in localStorage; timer runs in WalletContext
- **Secret cleanup** — secrets deleted only after on-chain confirmation (15+ blocks); prevents data loss on chain rollback
- **Provider nesting order** — WalletProvider → NodeProvider → WasmProvider (in main.tsx); order matters for context dependencies
- **File categories** — Defined in `fe/src/config/categories.ts`. Only `text` is enabled (on-chain); other categories (document, audio, image, video, other) gated by `enabled` flag until data layer is implemented. Category stored in CIP-20 metadata msg[4]. Decrypted content saved to `media/content/{category}/{tokenName}/` via Tauri `save_content` command
