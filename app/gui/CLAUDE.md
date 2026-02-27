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
│   │   ├── main.tsx                 # Entry: initializeTheme → ErrorBoundary → ShutdownOverlay → Wallet → Node → Wasm → Router → Modal → App
│   │   ├── index.css                # CSS variables (dark/light theme) + Tailwind v4
│   │   ├── fonts.css                # @font-face declarations for Inter + JetBrains Mono (self-hosted woff2)
│   │   ├── config/                 # App configuration
│   │   │   └── categories.ts      # File category definitions + integration flags
│   │   ├── contexts/               # WalletContext, NodeContext, WasmContext, ModalContext
│   │   ├── pages/                   # WalletSetup, WalletUnlock, NodeSync, Dashboard, Settings
│   │   ├── components/              # Tabs, modals, cards, PdfViewer, overlays, InfoTooltip, presentational
│   │   ├── services/
│   │   │   ├── api.ts               # REST client for backend
│   │   │   ├── providers.ts         # Kupo + Ogmios singletons
│   │   │   ├── kupoAdapter.ts       # IFetcher implementation for MeshSDK
│   │   │   ├── transactionBuilder.ts # All tx building (~2174 lines)
│   │   │   ├── autolock.ts          # Inactivity auto-lock timer config (localStorage)
│   │   │   ├── imageCache.ts        # Tauri IPC client for image download/cache/ban
│   │   │   ├── libraryService.ts    # Tauri IPC client for library (list/read/delete content)
│   │   │   ├── secretCleanup.ts     # Deferred secret deletion after on-chain confirmation
│   │   │   ├── metadata.ts          # CIP-20 metadata: 64-byte string chunking + structured builders
│   │   │   ├── iagonApi.ts          # Iagon HTTP endpoints via Tauri invoke (CORS bypass)
│   │   │   ├── iagonAuth.ts         # CIP-8 wallet auth + API key management for Iagon
│   │   │   ├── contentStorage.ts    # Saves decrypted files + metadata to media/content/; uses fileExtension (payload field 3) for correct filename, falls back to category default
│   │   │   ├── listingDraftStorage.ts # Persists multi-step listing creation state (Tauri-backed)
│   │   │   ├── listingFormDraftStorage.ts # Pre-upload listing form state recovery (localStorage)
│   │   │   ├── bidFormDraftStorage.ts # Bid form draft state recovery (localStorage)
│   │   │   ├── crypto/              # BLS12-381, Schnorr, ECIES, CBOR, ZK key derivation, file encryption
│   │   │   ├── snark/               # Native SNARK prover interface
│   │   │   │   ├── index.ts         # Barrel export
│   │   │   │   └── prover.ts        # SNARK CLI wrapper
│   │   │   ├── bidNotifications.ts   # localStorage: seen-bid state for notification diffing
│   │   │   ├── tabStorage.ts        # localStorage: active Dashboard tab persistence
│   │   │   ├── favoritesStorage.ts  # localStorage: marketplace listing favorites (PKH-keyed)
│   │   │   ├── filterStorage.ts     # localStorage: marketplace filter state persistence (PKH-keyed)
│   │   │   ├── onboardingStorage.ts # localStorage: multi-step onboarding tour state
│   │   │   ├── errorMessages.ts     # User-facing error message mapping (pattern-matched from raw errors)
│   │   │   ├── toastSettings.ts     # localStorage: toast auto-dismiss duration configuration
│   │   │   ├── themeStorage.ts      # localStorage: dark/light theme persistence + apply before first paint
│   │   │   ├── fileExport.ts        # Text file export via Tauri native save dialog
│   │   │   ├── pdfSearch.ts         # PDF full-text search + highlight for library PdfViewer
│   │   │   ├── apiCache.ts          # In-memory TTL cache for frontend API responses
│   │   │   ├── desktopNotifications.ts # OS-level notifications via @tauri-apps/plugin-notification
│   │   │   ├── notificationSound.ts # Programmatic WAV notification ping generation + volume control
│   │   │   ├── walletManagement.ts  # Collateral creation + UTxO defragmentation (MeshTxBuilder)
│   │   │   ├── transactionHistory.ts # Transaction record persistence (pending/confirmed/failed, PKH-keyed)
│   │   │   └── *Storage.ts          # localStorage: secrets, bids, accept-bid
│   │   ├── hooks/                   # useSnarkProver, useBidNotifications, usePasswordStrength, useAsyncAction, useDataRefresh, useTabFilterState, useModalStack, useDebounce, useFocusTrap, useVisibility, useWalletHealth
│   │   └── utils/                   # clipboard, network, truncate, nodeSyncHelpers, walletErrors, formatBytes, formatAda, time, logClassification, contentType, formatDate
│   └── vite.config.ts               # WASM, top-level-await, node polyfills
├── be/                              # Express v5 backend (TypeScript)
│   ├── src/
│   │   ├── index.ts                 # Server entry (imports createApp, listens on port 3001)
│   │   ├── app.ts                   # Express app factory (CORS, middleware, routes, error handler)
│   │   ├── config/index.ts          # Env-based config (network, ports, contracts)
│   │   ├── routes/                  # encryptions, bids, protocol, chain
│   │   ├── middleware/
│   │   │   ├── validate.ts          # Param validators (pkh, tokenName, txHash, encryptionToken)
│   │   │   ├── requestLogger.ts     # Request/response JSON logging with request IDs
│   │   │   ├── pagination.ts        # Query param pagination (default 50, max 200, offset-based)
│   │   │   └── timeout.ts           # Request timeout middleware (30s default, returns 504)
│   │   ├── services/
│   │   │   ├── kupo.ts              # Kupo HTTP client (current UTxOs)
│   │   │   ├── cbor.ts              # CBOR decoder + slot-to-time (extracted from kupo.ts)
│   │   │   ├── koios.ts             # Koios REST client with circuit breaker (history, metadata, params)
│   │   │   ├── encryptions.ts       # Encryption query logic
│   │   │   ├── bids.ts              # Bid query logic
│   │   │   ├── parsers.ts           # CBOR/Plutus datum → TypeScript
│   │   │   ├── cache.ts             # TTL cache with stale fallback (15s default, shared singleton)
│   │   │   ├── circuitBreaker.ts    # Circuit breaker (5 failures → 30s cooldown → half-open probe)
│   │   │   ├── fetchWithRetry.ts    # Exponential backoff fetch (3 retries, 1s initial, 2x multiplier)
│   │   │   ├── health.ts            # Health check with Kupo/Koios dependency latency tracking
│   │   │   └── logger.ts            # JSON structured logger (configurable level via LOG_LEVEL env)
│   │   ├── types/index.ts           # All backend type definitions
│   │   └── stubs/                   # Hardcoded sample data for dev mode
│   └── dist/                        # Compiled JS (tsc output) — Tauri runs this
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                   # App setup, plugins, state, event handlers
│   │   ├── config.rs                # AppConfig, Network, ContractConfig
│   │   ├── crypto/
│   │   │   ├── wallet.rs            # AES-256-GCM + Argon2id wallet encryption
│   │   │   ├── secrets.rs           # AES key derivation for secrets storage
│   │   │   ├── audit.rs             # Cryptographic audit utilities
│   │   │   └── migration.rs         # Secret format migration
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
│   │       ├── secrets.rs           # store/get/remove seller, bid, accept-bid, listing-draft secrets
│   │       ├── iagon.rs             # Iagon API key storage + HTTP proxy (reqwest, CORS bypass)
│   │       ├── media.rs             # image download, cache, ban/unban, delete, content save
│   │       └── chain.rs             # get_network_tip (Koios direct)
│   ├── resources/
│   │   ├── config.json              # Contract addresses, policy IDs, ports
│   │   ├── cardano/{network}/       # Node configs (topology, genesis files)
│   │   └── snark/vk.json            # SNARK verification key
│   ├── binaries/                    # Sidecar binaries (gitignored, ~600MB)
│   ├── capabilities/default.json    # Scoped permissions (shell:allow-spawn, notification:default)
│   ├── tauri.conf.json              # Window 1280x800, devUrl 127.0.0.1:5173
│   └── Cargo.toml                   # Rust deps: tauri, serde, argon2, aes-gcm, reqwest
├── build.sh                         # Sources check-prereqs.sh, installs deps, runs `tauri build`
├── build-debug.sh                   # Sources check-prereqs.sh, installs deps, runs `tauri build --debug`
├── run.sh                           # Sources check-prereqs.sh, kills WebKit orphans, Wayland→X11 fallback, tsc watch for be, runs `tauri dev`
├── check-prereqs.sh                 # Prerequisite validator (Node 20+, npm, Rust, sidecar binaries, WebKitGTK)
├── lint.sh                          # eslint (fe), tsc + eslint (be), cargo fmt, clippy
├── test.sh                          # vitest (fe) + vitest (be)
└── CHANGELOG.md                     # Version history
```

## Frontend Patterns

**Stack:** React 19 + Vite 7.2 + Tailwind v4 + React Router v7 + TypeScript 5.9 + MeshSDK 1.8

**State management — 4 React Contexts** (nested in main.tsx):
- `WalletContext` — lifecycle (`loading`→`no_wallet`→`locked`→`unlocked`), MeshWallet instance, address, balance, payment key hex
- `NodeContext` — stage (`stopped`→`bootstrapping`→`starting`→`syncing`→`synced`→`error`), sync progress, tip slot/height, process info
- `WasmContext` — SNARK setup files (`idle`→`checking-cache`→`decompressing`→`ready`→`error`)
- `ModalContext` — Stack-based modal management, tracks open modals so only topmost handles Escape; provides z-index stacking (base 50, +2 per level)

**Routing** (App.tsx guards based on wallet + node state):
| Route | Guard | Component |
|---|---|---|
| `/wallet-setup` | no_wallet | WalletSetup (create/import mnemonic) |
| `/wallet-unlock` | locked | WalletUnlock (password entry) |
| `/node-sync` | unlocked + node not synced | NodeSync (progress bars) |
| `/dashboard` | unlocked + node synced | Dashboard (5 tabs) |
| `/settings` | unlocked | Settings |

**Component hierarchy:** Pages → Tab components (Marketplace, MySales, MyPurchases, History, Library) → Modal components (CreateListing, PlaceBid, Decrypt, SnarkProving, SnarkDownload, Bids, Confirm, Description, LibraryContent) → Card components (EncryptionCard, SalesListingCard, MyPurchaseBidCard, LibraryCard, ListingImage) + PdfViewer + ImageViewer + VideoPlayer + AudioPlayer + Overlays (ShutdownOverlay, OnboardingOverlay, KeyboardShortcutsOverlay) + Banners (OfflineBanner, SessionWarningBanner) + UI primitives (Badge, LoadingSpinner, SkeletonCard, EmptyState, EmptyStateIllustrations, TransactionLink, MnemonicInput, PasswordStrengthIndicator, ScrollToTop, HighlightText, BidTimeline, PriceRangeSlider, InfoTooltip) + descriptionUtils

**Transaction building** (fe/src/services/transactionBuilder.ts ~2174 lines):
- `createListing()`, `placeBid()`, `cancelBid()`, `removeListing()`, `cancelPendingListing()`
- `acceptBidSnark()`, `prepareSnarkInputs()`, `completeReEncryption()`
- `estimateMinLovelace()`, `computeTokenName()`, `getStorageLayerUri()`
- `extractPaymentKeyHash()`, `isRealTransactionsAvailable()`, `getTransactionStubWarning()`
- `ListingCreationStep` type exported for multi-step progress UI callbacks
- Uses MeshTxBuilder with local Kupo (IFetcher) + Ogmios (ISubmitter/IEvaluator)

**Crypto services** (fe/src/services/crypto/):
- `index.ts` — Barrel export
- `bls12381.ts` — BLS12-381 G1/G2 operations via @noble/curves
- `schnorr.ts` — Schnorr signature proofs
- `ecies.ts` — ECIES encryption/decryption
- `binding.ts` — Binding proofs for secrets
- `register.ts` — BLS12-381 key registers
- `payload.ts` — CBOR peace-payload encoding/decoding via cborg (fields: 0=locator, 1=secret, 2=digest, 3=filetype)
- `createEncryption.ts` / `createBid.ts` — Full artifact creation
- `zkKeyDerivation.ts` — Deterministic ZK secret from wallet key material
- `constants.ts` — Domain tags, public G2 points
- `decrypt.ts` — Decryption flow (native CLI required for BLS pairings)
- `hashing.ts` — Hashing utilities
- `level.ts` — HalfLevel/FullLevel type definitions
- `walletSecret.ts` — BLS secret derivation from wallet signature
- `fileEncryption.ts` — AES-256-GCM file encryption/decryption via Web Crypto API (pre-upload to Iagon)

**Local storage** (fe/src/services/*Storage.ts + autolock.ts):
- `secretStorage` — encryption secrets by token name
- `bidSecretStorage` — bid secrets for later decryption
- `acceptBidStorage` — accept-bid workflow state (A0, R0, Hk, proof)
- `transactionHistory` — tx record persistence (pending/confirmed/failed states, PKH-keyed)
- `bidNotifications` — seen-bid state for seller notification diffing (PKH-keyed)
- `listingDraftStorage` — multi-step listing creation state (Tauri-backed encrypted JSON, not localStorage). Lifecycle: uploading → uploaded → verified → signing → submitted → confirmed/failed/abandoned. Prevents re-uploading to Iagon on retry/crash.
- `listingFormDraftStorage` — pre-upload listing form state recovery (localStorage-backed)
- `bidFormDraftStorage` — bid form draft state for recovery (localStorage-backed)
- `contentStorage` — saves decrypted files + metadata to `media/content/{category}/{tokenName}/` via Tauri `save_content` command
- `autolock` — inactivity timeout in minutes (default 15, 0 = never)
- `tabStorage` — active Dashboard tab persistence (localStorage, defaults to 'marketplace')
- `favoritesStorage` — marketplace listing favorites, PKH-keyed Set<string> in localStorage
- `filterStorage` — marketplace filter state persistence, PKH-keyed in localStorage
- `onboardingStorage` — multi-step onboarding tour state (4 steps)
- `toastSettings` — toast auto-dismiss duration in ms (localStorage, default 5000, 0 = never)
- `themeStorage` — dark/light theme preference (localStorage, default dark); applied before first paint via `initializeTheme()`

**Styling:** Dark/light theme via CSS custom properties in index.css, Tailwind utility classes, self-hosted fonts Inter + JetBrains Mono (declared in fonts.css as @font-face with woff2 files). Theme toggle via `themeStorage.ts` (`data-theme` attribute on `<html>`); dark is default. All colors via CSS variables (`--bg-*`, `--text-*`, `--accent`, `--success`, `--error`, etc.) with `--radius-*`, `--shadow-*`, `--transition-*`, `--space-*` spacing tokens. No per-component CSS files — all inline Tailwind utilities + variables.

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
- `ModalContext` + `useModalStack` hook: stack-based z-index management, only topmost modal handles Escape

**Data refresh & polling:**
- `NodeContext` polls `get_node_status` every 5000ms via `setInterval`
- Balance refreshed when `tipSlot` changes (App.tsx); eager refresh on Dashboard mount
- Bid notifications: `useBidNotifications` hook in Dashboard watches `tipSlot` changes, checks for new bids on seller's listings (30s throttle), diffs against localStorage seen-bid state, shows tab badge + toast
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
- `GET /api/chain[/confirmations/:txHash|/tip]`
- `GET /health` — status (healthy/degraded/unhealthy), uptimeSeconds, kupo/koios dependency health (reachable, latencyMs, lastSuccess, error?), network, useStubs
- `GET /health/ready` — readiness probe (returns 503 if unhealthy)

**Datum parsing** (be/src/services/parsers.ts): Decodes CBOR/Plutus JSON inline datums into TypeScript types. Handles indefinite-length byte strings (G2 points > 64 bytes are CBOR-chunked).

**CIP-20 metadata** (key 674): Two formats exist (Cardano metadata strings have a 64-byte limit):
- **New (structured)**: `{ msg: [...descriptionChunks], p: "price", s: "storageLayer", i: [...imageLinkChunks], c: "category" }`. Long strings (description, imageLink) are split into <=64-byte UTF-8 chunks via `fe/src/services/metadata.ts`. Detected by presence of `p` key.
- **Old (flat array)**: `{ msg: [description, suggestedPrice, storageLayer, imageLink?, category?] }`. Breaks if any string exceeds 64 bytes.
- **Bid tx**: `{ msg: [futurePrice] }` (unchanged; futurePrice is always short).
- Backend `parseCip20Fields()` in `be/src/services/encryptions.ts` handles both formats via backward-compatible detection.

**Error responses:** All routes return `{ error: { code, message } }` on failure. 400 for invalid params (validate middleware), 500 for internal errors (real message in dev, generic in prod), 404 for missing endpoints. Malformed datums at contract addresses are silently skipped with a console warning — frontend sees incomplete data.

**Resilience:** Koios requests use a circuit breaker (5 consecutive failures → 30s OPEN cooldown → HALF_OPEN probe) with TTL cache (15s default) providing stale fallback when the circuit is open. `fetchWithRetry` provides exponential backoff (3 retries, 1s initial delay, 2x multiplier) for transient failures. JSON structured logging via `logger.ts` (configurable level via LOG_LEVEL env).

**Middleware:** `requestLogger` logs method/path/status/duration for every request with 8-char request IDs. `validate.ts` provides param validators (`validatePkhParam`, `validateTokenNameParam`, `validateTxHashParam`, `validateEncryptionTokenParam`, `validateStatusParam`) that return 400 with `INVALID_PARAM` or `INVALID_STATUS` code on invalid input. `pagination.ts` adds offset-based pagination (default 50, max 200) with `{ total, limit, offset, hasMore }` response meta. `timeout.ts` enforces 30s request timeout (returns 504 Gateway Timeout).

**Stub mode:** When `USE_STUBS=true`, all endpoints return hardcoded sample data. No Kupo/Koios needed.

## Iagon Decentralized Storage

**Purpose:** Off-chain file storage for non-text file categories. Text content remains on-chain in the ECIES capsule; all other categories (document, audio, image, video, other) are encrypted client-side and uploaded to Iagon (`gw.iagon.com/api/v2`).

**Auth flow** (fe/src/services/iagonAuth.ts):
1. `addressToHex(bech32Address)` — convert wallet address for Iagon API
2. `getNonce(hexAddress)` → UUID nonce from `POST /public/nonce`
3. `wallet.signData(nonce, address)` → CIP-8 signature (via MeshSDK)
4. `verifySignature(hex, sig, key)` → session JWT from `POST /public/verify`
5. `generateApiKey(jwt, "veiled-desktop")` → persistent API key from `POST /key/generate`
6. API key stored encrypted in `secrets/iagon/api_key.json` (same AES scheme as other secrets)

**CORS bypass:** All Iagon HTTP requests are proxied through Rust Tauri commands (`src-tauri/src/commands/iagon.rs`) using `reqwest` (60s timeout, rustls-tls). The frontend never calls Iagon directly — all calls go through `invoke()` wrappers in `fe/src/services/iagonApi.ts`.

**Upload flow** (for file-based listings):
1. `encryptFileForUpload(fileBytes)` → AES-256-GCM encrypted blob + random key + nonce + SHA-256 digest
2. `iagon_upload(apiKey, encryptedBlob, filename)` → `IagonFileInfo` with `_id` for download/delete
3. Key + nonce (44 bytes) packed into peace-payload capsule secret field; original file extension stored in field 3 (filetype)
4. Buyer decrypts capsule → `decodeFileSecret()` + extracts fileExtension (field 3) → `iagon_download()` → `decryptDownloadedFile()` → `verifyFileDigest()` → file saved with original extension
5. Files uploaded as `visibility: public` (content is already client-side encrypted)

**Listing draft recovery** (fe/src/services/listingDraftStorage.ts):
- Each file listing creation generates a draft ID and persists state at each step
- If the app closes after Iagon upload but before tx submission, the draft survives (Tauri filesystem-backed, not IndexedDB)
- `getRecoverableDrafts()` finds drafts that can resume from the last successful step
- `getOrphanedDrafts()` finds abandoned uploads for Iagon cleanup

## Tauri/Rust Core

**Process management** (src-tauri/src/process/):
- 5 child processes: cardano-node, Ogmios, Kupo, Mithril, Express (node.js)
- Two spawn methods: sidecar (`tauri_plugin_shell`) for bundled binaries vs `tokio::process::Command` for Express/Node.js
- Auto-restart with exponential backoff (max 5 retries, 1s initial delay, 2x multiplier → up to 31s total)
- Circular log buffer (500 lines per process), emitted as Tauri events
- SIGTERM → configurable wait → SIGKILL: cardano-node 45s (flush in-memory ledger), mithril-client 30s, others 10s
- `user_stopped` flag prevents auto-restart after intentional shutdown
- Linux: uses `libc::kill` directly (avoids AppImage /usr/bin/kill issues)
- Orphan cleanup on startup: reads `managed_pids.json` from previous session → SIGTERM → 30s → SIGKILL; also port-scans 3001/1337/1442
- Health check: only Express has one (`GET /health`); no built-in checks for cardano-node/Ogmios/Kupo

**Wallet** (src-tauri/src/crypto/wallet.rs):
- AES-256-GCM encryption with Argon2id KDF (m=64MiB, t=3, p=4)
- Stored as JSON: `{ version, salt, nonce, ciphertext }` at `app_data_dir/wallet.json`
- Mnemonic held in memory only while unlocked; zeroed on lock

**Secrets** (src-tauri/src/commands/secrets.rs + iagon.rs):
- AES key derived from mnemonic via `derive_secrets_key()` — Argon2id with light params (4 MiB, 1 iter), fixed salt `"PEACE_SECRETS_V1"`
- File format: `{ version: 1, nonce: hex(12 bytes), ciphertext: hex }` (AES-256-GCM)
- Five secret types stored in `app_data_dir/secrets/`:
  - `seller/{token_name}.json` — `{ a, r }` scalars
  - `bid/{encryption_token}.json` — array of `{ bidTokenName, sk_bid }`
  - `accept-bid/{encryption_token}.json` — `{ A0, R0, Hk, proof }` workflow state
  - `listing-drafts/{draftId}.json` — multi-step listing creation state (form data, Iagon file ID, AES key/nonce, tx hash)
  - `iagon/api_key.json` — Iagon persistent API key
- Secure delete: overwrite zeros → flush → `fs::remove_file()`
- All Tauri commands return `Result<T, String>` — no custom error types, all stringified

**SNARK** (src-tauri/src/commands/snark.rs):
- Sidecar binary `binaries/snark` with CLI. Secrets passed via temp JSON file (`-input <secrets.json>`) to avoid CLI arg exposure; non-secret paths remain as CLI args:
  - `snark prove -input <secrets.json> -setup <dir> -out <dir>` (secrets: a, r, v, w0, w1)
  - `snark hash -input <secrets.json>` (secrets: a)
  - `snark decrypt -input <secrets.json>` (secrets: g1b, r1, shared, g2b)
  - Temp file created via `tempfile::NamedTempFile` (auto-cleaned); PID registered with NodeManager for cleanup on app exit
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

**Tauri commands** (68 commands, invoke from frontend):
- Wallet: `wallet_exists`, `create_wallet`, `unlock_wallet`, `lock_wallet`, `delete_wallet`, `reveal_mnemonic`
- Node: `start_node`, `stop_node`, `get_node_status`, `get_process_status`, `start_mithril_bootstrap`, `get_process_logs`
- Chain: `get_network_tip`
- Config: `get_network`, `set_network`, `get_data_dir`, `get_app_config`, `get_disk_usage`, `get_available_disk_space`
- SNARK: `snark_check_setup`, `snark_decompress_setup`, `snark_prove`, `snark_gt_to_hash`, `snark_decrypt_to_hash`
- Secrets: `store_seller_secrets`, `get_seller_secrets`, `remove_seller_secrets`, `list_seller_secrets`, `store_bid_secrets`, `get_bid_secrets`, `get_bid_secrets_for_encryption`, `remove_bid_secrets`, `store_accept_bid_secrets`, `get_accept_bid_secrets`, `remove_accept_bid_secrets`, `has_accept_bid_secrets`
- Listing Drafts: `store_listing_draft`, `update_listing_draft`, `get_listing_draft`, `list_listing_drafts`, `remove_listing_draft`
- Iagon Keys: `store_iagon_api_key`, `get_iagon_api_key`, `remove_iagon_api_key`, `has_iagon_api_key`
- Iagon HTTP: `iagon_get_nonce`, `iagon_verify`, `iagon_generate_api_key`, `iagon_verify_api_key`, `iagon_upload`, `iagon_download`, `iagon_delete_file`, `iagon_search_files`, `iagon_list_files`
- Media: `download_image`, `get_cached_image`, `list_cached_images`, `ban_image`, `unban_image`, `delete_cached_image`, `save_content`
- Library: `list_library_items`, `read_library_content`, `read_subtitle_file`, `delete_library_item`, `export_library_content`, `export_text_file`, `open_with_system`

**Tauri events** (listen from frontend):
- `process-status` — stdout/stderr log lines from child processes
- `mithril-progress` — download percentage during bootstrap
- `snark-setup-progress` — decompression progress for setup files
- `config-warning` — warning if config.json not found (using defaults)
- `app-shutting-down` — signal to show shutdown overlay before exit

## Development Workflow

**Start dev environment:**
```bash
cd app/gui && bash run.sh       # Checks prereqs, kills orphan WebKit processes, starts tsc watch for be, runs tauri dev
# Or manually:
cd app/gui && npx tauri dev     # Starts Vite (5173) + Tauri window
# If running manually, backend must be built separately:
cd app/gui/be && npm run build  # REQUIRED after any backend TS change (or use `npm --prefix be run watch`)
```

**CRITICAL:** Tauri runs `node dist/index.js`, NOT `tsx src/index.ts`. Frontend hot-reloads via Vite; backend does NOT. `run.sh` starts `tsc --watch` automatically; if running `tauri dev` manually, every backend change needs `cd be && npm run build`.

**Stub mode:** Set `USE_STUBS=true` in `be/.env` to develop without running cardano-node/Kupo.

**Tests:** `cd app/gui && bash test.sh` (runs both frontend + backend tests)
- Frontend: `cd fe && npm test` (Vitest + jsdom)
- Backend: `cd be && npm test` (Vitest + node)
- Frontend test locations:
  - `fe/src/services/crypto/__tests__/` — bls12381, hashing, payload, snark-inputs, schnorr, binding, ecies, register, level, constants, zkKeyDerivation, createEncryption, createBid, walletSecret (14 files)
  - `fe/src/services/__tests__/` — api, apiCache, autolock, bidFormDraftStorage, bidNotifications, contentStorage, desktopNotifications, errorMessages, favoritesStorage, filterStorage, iagonApi, iagonAuth, kupoAdapter, libraryService, listingDraftStorage, listingFormDraftStorage, metadata, notificationSound, onboardingStorage, pdfSearch, secretCleanup, snarkProver, tabStorage, themeStorage, toastSettings, transactionBuilder, transactionBuilder.integration, transactionHistory, walletManagement (29 files)
  - `fe/src/config/__tests__/` — categories (1 file)
  - `fe/src/hooks/__tests__/` — useAsyncAction, useBidNotifications, useDataRefresh, useDebounce, useFocusTrap, useModalStack, usePasswordStrength, useSnarkProver, useTabFilterState, useVisibility, useWalletHealth (11 files)
  - `fe/src/contexts/__tests__/` — ModalContext, NodeContext, WalletContext, WasmContext (4 files)
  - `fe/src/components/__tests__/` — AudioPlayer, BidsModal, BidTimeline, ConfirmModal, CreateListingModal, DecryptModal, DelayedSpinner, DescriptionModal, ErrorBoundary, HighlightText, HistoryTab, ImageViewer, InfoTooltip, KeyboardShortcutsOverlay, LibraryCard, LibraryTab, ListingImage, MarketplaceTab, MnemonicInput, MyPurchaseBidCard, MyPurchasesTab, MySalesTab, OfflineBanner, PdfViewer, PlaceBidModal, SalesListingCard, SessionWarningBanner, ShutdownOverlay, SnarkDownloadModal, SnarkProvingModal, Toast, VideoPlayer (32 files)
  - `fe/src/pages/__tests__/` — Dashboard, NodeSync, nodeSyncHelpers, Settings, settingsLogHelpers, WalletSetup, WalletUnlock, walletUnlockErrors (8 files)
  - `fe/src/utils/` — clipboard, contentType, formatAda, formatBytes, logClassification, network, time, truncate, walletErrors (9 files)
  - `fe/src/test/factories.ts` — Test data factory helpers
  - `fe/src/test/__mocks__/tauri.ts` — Tauri API mocks for testing
  - `fe/src/test/__mocks__/tauri-notification.ts` — Tauri notification plugin mock
- Backend test locations:
  - `be/src/services/__tests__/` — bids, cache, circuitBreaker, encryptions, fetchWithRetry, health, koios, kupo, kupo-cbor, logger, parsers (11 files)
  - `be/src/routes/__tests__/` — encryptions, bids, protocol, chain, health (5 files)
  - `be/src/middleware/__tests__/` — validate, pagination, requestLogger, timeout (4 files)
- Setup file (`fe/src/test/setup.ts`) mocks `matchMedia`, `clipboard`, `ResizeObserver` (guarded for node environment)
- Tests using WebCrypto (ecies) use `// @vitest-environment node` pragma
- Tests importing transactionBuilder mock `@meshsdk/core`, `@meshsdk/provider`, and Tauri storage modules to avoid libsodium WASM
- Component tests (AudioPlayer, PlaceBidModal) and context tests (all 4 contexts) use Tauri mock at `fe/src/test/__mocks__/tauri.ts`

**Production build:** `npx tauri build` (creates platform installer with bundled binaries)

**Version bump** (update ALL of these):
1. `src-tauri/tauri.conf.json` — version
2. `src-tauri/Cargo.toml` — version
3. `package.json` — version
4. `fe/package.json` — version
5. `be/package.json` — version
6. `CHANGELOG.md` — new entry at top

## Common Modification Patterns

**Adding a new Tauri command (Rust → frontend):**
1. Create or edit the command file in `src-tauri/src/commands/your_module.rs`:
```rust
#[tauri::command]
pub async fn your_command(arg: String, state: tauri::State<'_, SomeState>) -> Result<ReturnType, String> {
    // All errors are stringified — no custom error types
    Ok(result)
}
```
2. If new module: add `pub mod your_module;` to `src-tauri/src/commands/mod.rs`
3. Register in `src-tauri/src/lib.rs` inside `tauri::generate_handler![...]` (order doesn't matter)
4. Call from frontend:
```typescript
import { invoke } from '@tauri-apps/api/core';  // Tauri v2, NOT '@tauri-apps/api'
const result = await invoke<ReturnType>('your_command', { arg: 'value' });
// Args are camelCase in TS → snake_case in Rust (auto-converted by Tauri)
```

**Adding a new backend API endpoint:**
1. Create or edit route file in `be/src/routes/your_route.ts`:
```typescript
import { Router } from 'express';
import { validateTokenNameParam } from '../middleware/validate.js';  // .js extension required (ESM output)
import { logger } from '../services/logger.js';
const router = Router();
router.get('/:tokenName', validateTokenNameParam, async (req, res) => { ... });
export default router;
```
2. If new route file: register in `be/src/routes/index.ts`:
```typescript
import yourRouter from './your_route.js';
router.use('/your-path', yourRouter);
```
3. Routes mount under `/api/` (set in `be/src/app.ts`), so final URL is `GET /api/your-path/:tokenName`
4. **Rebuild backend**: `cd be && npm run build` (or rely on `tsc --watch` from `run.sh`)

**Calling backend from frontend:**
```typescript
// fe/src/services/api.ts pattern — all calls go through 127.0.0.1:3001
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';
const res = await fetch(`${API_URL}/api/your-path/${tokenName}`);
const json: ApiResponse<YourType> = await res.json();
```

**Adding a new frontend service:**
1. Create `fe/src/services/yourService.ts`
2. For Tauri IPC: wrap `invoke()` calls (see `imageCache.ts` as template)
3. For localStorage: follow `tabStorage.ts` pattern (simple) or `secretStorage.ts` (PKH-keyed)
4. For Tauri-backed encrypted storage: follow `listingDraftStorage.ts` pattern (uses `invoke` for read/write/delete)
5. Add test file at `fe/src/services/__tests__/yourService.test.ts`

**Adding a new React hook:**
1. Create `fe/src/hooks/useYourHook.ts`
2. Add test at `fe/src/hooks/__tests__/useYourHook.test.ts`

**Adding a new modal:**
1. Create `fe/src/components/YourModal.tsx` following the two-effect pattern:
   - Effect 1 `[isOpen]`: reset form state
   - Effect 2 `[isOpen, isSubmitting, onClose]`: Escape key + body overflow
2. Use `useModalStack('YourModal')` for z-index stacking
3. Wire up open/close state in the parent tab component

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
- **Express param validation** — `validate.ts` middleware validates pkh (56 hex chars), tokenName (1-64 hex chars), txHash (64 hex chars), encryptionToken (1-64 hex chars) with 400 `INVALID_PARAM` responses. Status enum still validated inline in route handlers
- **Datum parsing failures are silent** — bad datums logged as warnings, skipped from results; frontend sees incomplete data
- **Auto-lock timer** — configurable inactivity timeout (default 15 min, 0 = never); stored in localStorage; timer runs in WalletContext
- **Secret cleanup** — secrets deleted only after on-chain confirmation (15+ blocks); prevents data loss on chain rollback
- **Provider nesting order** — ErrorBoundary → ShutdownOverlay → WalletProvider → NodeProvider → WasmProvider → BrowserRouter → ModalProvider → App (in main.tsx); `initializeTheme()` called before `createRoot()` to prevent flash; order matters for context dependencies
- **File categories** — Defined in `fe/src/config/categories.ts`. All categories now enabled. `text` uses on-chain storage (capsule only); all other categories (document, audio, image, video, other) use Iagon off-chain storage (AES-256-GCM encrypted before upload). Category stored in CIP-20 metadata. Decrypted content saved to `media/content/{category}/{tokenName}/` via Tauri `save_content` command
- **Library tab** — Reads from local `media/content/` directory (not on-chain). `list_library_items` scans for metadata JSON files, `read_library_content` loads file bytes, `delete_library_item` removes the token directory, `export_library_content` opens native save dialog. LibraryContentModal lazy-loads PdfViewer, ImageViewer, AudioPlayer, VideoPlayer via React `lazy()` + `Suspense`. Uses wide modal (`max-w-4xl`) for rich media. View mode determined by `getViewMode()`: prioritizes fileExtension from payload field 3, falls back to category. Modes: text (inline), PDF (PdfViewer), image (ImageViewer), audio (AudioPlayer), video (VideoPlayer), or download-only fallback. LibraryCard supports grid/compact modes like SalesListingCard
- **PdfViewer** — Uses `react-pdf` (pdfjs-dist worker). Renders decrypted PDFs from `Uint8Array` via Blob URL. Zoom 0.5x-3.0x, page navigation, fullscreen overlay at `z-[60]` (above modal `z-50`). Blob URL created in useEffect to handle React StrictMode double-mount
- **ImageViewer** — Renders decrypted images from `Uint8Array` via Blob URL with MIME type derived from fileExtension. Zoom and fullscreen overlay at `z-[60]` (above modal `z-50`). Supports PNG, JPEG, GIF, WebP, SVG, BMP
- **AudioPlayer** — Winamp-style player using native `<audio>` element for GStreamer playback (bypasses broken WebKitGTK Web Audio API). Custom FFT visualization (32 bars, Cooley-Tukey radix-2). Transport controls: play, pause, stop, skip ±10s. Volume slider. Graceful fallback if PCM decode fails. Supports: mp3, wav, flac, ogg, aac, m4a, opus
- **VideoPlayer** — Native `<video>` element with FFmpeg.wasm remux fallback. Attempts native playback first; if unsupported format detected, remuxes to MP4 via FFmpeg.wasm in-browser. Fullscreen overlay at `z-[60]` (above modal `z-50`). Supports common video formats
- **WebKitGTK Web Audio API broken** — `AnalyserNode` and `AudioContext` don't work reliably in WebKitGTK; AudioPlayer uses native `<audio>` element (which routes through GStreamer) instead of Web Audio API
- **Iagon requires internet** — Iagon operations (upload, download, auth) require internet access. Unlike on-chain text listings, file-based listings fail if `gw.iagon.com` is unreachable. The `reqwest` client has a 60s timeout
- **Listing drafts persist across WebView resets** — Stored as encrypted JSON in `secrets/listing-drafts/` (filesystem), not IndexedDB (which WebKitGTK can clear). This is why `listingDraftStorage` uses Tauri invoke instead of localStorage
- **File encryption key in capsule** — The peace-payload capsule for file listings contains: field 0 (Iagon file ID), field 1 (AES key + nonce, 44 bytes), field 2 (SHA-256 digest), field 3 (original file extension). Losing the capsule means losing access to the file
- **ModalContext stacking** — `ModalProvider` wraps `App` inside `BrowserRouter`. Modals register with the stack via `useModalStack` hook; only the topmost modal handles Escape. Z-index starts at 50, increments by 2. Media viewer fullscreen overlays at `z-[60]` remain above all modals
- **Error message mapping** — `errorMessages.ts` pattern-matches raw error strings into `FriendlyError` objects with title, message, action, and recoverable flag. Used by `useAsyncAction` hook for consistent error UX
- **Tab filter state** — `useTabFilterState` provides useReducer-based filter/sort/pagination state for each Dashboard tab (Marketplace, MySales, MyPurchases, History, Library). Each tab has its own reducer and initial state
- **Favorites** — `favoritesStorage.ts` persists marketplace favorites in localStorage keyed by wallet PKH
- **Toast settings** — `toastSettings.ts` allows users to configure toast auto-dismiss duration (3s/5s/8s/never) stored in localStorage
- **Resilient Koios** — Koios requests go through a circuit breaker (5 failures → 30s cooldown) with TTL cache stale fallback and fetch retry (3 attempts, exponential backoff). Prevents cascading failures when Koios is temporarily unavailable
- **Backend structured logging** — All backend logging goes through `logger.ts` which outputs JSON entries with level, timestamp, message, and arbitrary context. Log level configurable via `LOG_LEVEL` env var (default: info)
- **Prerequisite checks** — `check-prereqs.sh` validates Node 20+, npm, Rust toolchain, sidecar binaries (cardano-node, ogmios, kupo, mithril-client, snark), and WebKitGTK (Linux). Sourced by run.sh, build.sh, build-debug.sh
- **ShutdownOverlay** — Full-screen overlay shown during app shutdown; listens to Tauri `app-shutting-down` events, rendered above all other content in main.tsx
- **Onboarding system** — `OnboardingOverlay` + `onboardingStorage.ts` provide a multi-step guided tour on first launch (4 steps); state persisted in localStorage
- **Desktop notifications** — `desktopNotifications.ts` uses `@tauri-apps/plugin-notification` for OS-level notifications; `notificationSound.ts` generates programmatic WAV notification pings
- **Wallet management** — `walletManagement.ts` provides collateral creation + UTxO defragmentation via MeshTxBuilder; `useWalletHealth` hook monitors UTxO health (collateral presence, fragmentation)
- **Theme toggle** — `themeStorage.ts` persists dark/light preference in localStorage; `initializeTheme()` applies before first paint to prevent flash; uses `data-theme` attribute on `<html>`
- **Virtual scrolling** — `@tanstack/react-virtual` available for large list performance optimization
- **Focus traps** — `useFocusTrap` hook manages Tab key focus wrapping + focus restoration within modal/overlay containers (accessibility)
- **Request timeout** — Backend `timeout.ts` middleware enforces 30s request timeout, returns 504 Gateway Timeout
- **Pagination** — Backend `pagination.ts` middleware provides offset-based pagination (default 50, max 200 items) with `{ total, limit, offset, hasMore }` meta
- **Background cleanup** — Hourly async task in lib.rs: securely deletes orphaned SNARK temp files older than 1 hour, evicts cached images older than 30 days or exceeding 500MB total
