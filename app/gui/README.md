# Veiled — PEACE Protocol Desktop App

Veiled is the desktop client for the PEACE Protocol encrypted data marketplace. It bundles a local Cardano node, chain indexer, and SNARK prover into a single application so users can list, bid on, and decrypt data without relying on third-party infrastructure.

## What It Does

- Runs a local **Cardano node** (with Mithril fast-sync on first launch)
- Indexes relevant UTxOs via **Kupo** (through **Ogmios**)
- Generates **Groth16 SNARK proofs** for re-encryption (via a bundled Go prover)
- Builds and submits transactions using **MeshSDK**
- Manages wallet keys with **AES-256-GCM + Argon2id** encryption
- Supports file listings with client-side encryption and **Iagon** decentralized storage

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, Tailwind v4, MeshSDK |
| Backend | Express v5, TypeScript |
| Core | Rust (Tauri v2) |
| Sidecars | cardano-node, ogmios, kupo, mithril-client, cardano-cli, snark |

## Running the AppImage

Download or build the AppImage, then run it directly:

```bash
./Veiled-x86_64.AppImage
```

### Command-Line Options

| Flag | Description | Default |
|------|-------------|---------|
| `--max-cores N` | Limit CPU cores used by all subprocesses (node, indexer, prover) | All cores |

```bash
# Limit to 4 CPU cores
./Veiled-x86_64.AppImage --max-cores 4
```

The core limit can also be set via environment variable:

```bash
VEILED_MAX_CORES=4 ./Veiled-x86_64.AppImage
```

**How it works:** The limit is applied per-subprocess using the appropriate mechanism for each runtime — GHC RTS flags (`+RTS -N4 -RTS`) for Haskell binaries (cardano-node, ogmios, kupo), `GOMAXPROCS` for the Go SNARK prover, and `RAYON_NUM_THREADS` for Rust binaries (mithril-client). The Tauri app itself and the Express backend are unaffected.

## Development

### Prerequisites

- Node.js 20+
- Rust toolchain
- Sidecar binaries in `src-tauri/binaries/` (cardano-node, ogmios, kupo, mithril-client, cardano-cli, snark)
- WebKitGTK (Linux)

Run `bash check-prereqs.sh` to verify.

### Dev Mode

```bash
bash run.sh
```

This installs dependencies, starts a TypeScript watcher for the backend, and launches Tauri in dev mode. The frontend hot-reloads; **the backend does not** — it is compiled to `be/dist/` and changes require a rebuild (handled automatically by the watcher).

To pass CLI flags in dev mode:

```bash
bash run.sh --max-cores 4
```

### Building

```bash
bash build.sh        # Release build
bash build-debug.sh  # Debug build
```

### Testing

```bash
bash test.sh   # Frontend + backend tests
bash lint.sh   # ESLint, tsc, cargo fmt, clippy
```

### Project Layout

```
app/gui/
├── fe/           # React frontend (Vite)
├── be/           # Express backend (TypeScript → compiled to dist/)
├── src-tauri/    # Rust core (Tauri v2, process management, crypto, IPC)
│   ├── src/
│   │   ├── lib.rs          # App setup, CLI parsing, media server
│   │   ├── config.rs       # Contract addresses, network config
│   │   ├── process/        # Subprocess lifecycle (node, ogmios, kupo, etc.)
│   │   ├── commands/       # Tauri IPC command handlers
│   │   └── crypto/         # Wallet encryption, secrets management
│   ├── binaries/           # Sidecar binaries (gitignored)
│   └── resources/          # Bundled configs, SNARK setup files
├── run.sh                  # Dev launcher
├── build.sh                # Release build
└── CLAUDE.md               # Full architecture reference
```

## License

- **Code:** GPL-3.0-only
- **Documentation:** CC-BY-4.0

**Copyright (C) 2025-2026 Logical Mechanism LLC**
