# PEACE Protocol — Repo Guide

Quick orientation for anyone (human or agent) working on this monorepo. For deep architecture details on the desktop app, see [app/gui/CLAUDE.md](./app/gui/CLAUDE.md). For contributor onboarding, see [CONTRIBUTING.md](./CONTRIBUTING.md). For the user-facing pitch, see [README.md](./README.md).

## What lives where

```
.
├── app/
│   ├── contracts/     # Aiken smart contracts (Plutus v3) — 5 validators
│   ├── gui/           # Veiled desktop app (Tauri v2 + React 19) ← active dev
│   ├── snark/         # Go/gnark Groth16 prover (+ WASM build)
│   ├── src/           # Python CLI (crypto + tx building)
│   ├── tests/         # Python test suite
│   ├── commands/      # Happy-path shell scripts (numbered 00–08, 99)
│   └── node/          # Cardano node helpers
├── documentation/     # Technical report, milestones, use cases
└── CHANGELOG.md       # Releases, latest entry first
```

The five on-chain validators live in [app/contracts/validators](./app/contracts/validators):

| Validator    | Role                                                         |
|--------------|--------------------------------------------------------------|
| `genesis`    | One-shot mint that bootstraps the protocol                   |
| `reference`  | Holds the verification key and script hashes as on-chain ref |
| `encryption` | Mint, spend, and re-encrypt encryption UTxOs                 |
| `bidding`    | Bid UTxOs that trade decryption rights                       |
| `groth`      | Groth16 SNARK witness verification                           |

Latest sizes are recorded in [app/contracts/groth-optimization.md](./app/contracts/groth-optimization.md). To recompute, parse `plutus.json` validators' `compiledCode` hex length divided by 2.

## Toolchain at a glance

| Component           | Language / Stack                                              |
|---------------------|---------------------------------------------------------------|
| Smart contracts     | Aiken **v1.1.21**, Plutus v3, stdlib **v3.0.0**               |
| SNARK prover        | Go 1.25+ / `gnark`                                            |
| Python CLI + tests  | Python 3.12+                                                  |
| Veiled desktop app  | Tauri v2 (Rust 1.77.2+) + React 19 (Vite) + Express v5        |
| Cardano node tools  | `cardano-cli`, Ogmios, Kupo, Mithril (sidecars in the GUI)    |

## Build & test cheat sheet

```bash
# Smart contracts
cd app/contracts && aiken check          # All tests must pass
cd app/contracts && aiken build          # Generates plutus.json
cd app/contracts && bash compile.sh      # Full compile pipeline

# SNARK prover
cd app/snark && go test ./... -count=1 -v -timeout 60m

# Python CLI
cd app && python -m pytest -s -vv

# Desktop app
cd app/gui && bash run.sh                # Dev (handles prereqs + bg services)
cd app/gui && bash test.sh               # fe + be vitest
cd app/gui && bash lint.sh               # eslint + tsc + clippy + cargo fmt

# Everything
cd app && ./run_tests.sh                 # All test suites
cd app && ./lint.sh                      # All linters
```

## Smart-contract gotchas worth knowing

These are non-obvious lessons from past optimization work. Re-discovering them costs days.

- **Aiken stdlib imports are expensive.** Removing `use aiken/collection/list` from `lib/types/groth.ak` cut the groth validator by **32%** (23,395 → 15,805 bytes) and the encryption validator by **20%** (12,865 → 10,308 bytes). The `list.length` calls were the only reason the list module compiled in; replacing them with pattern matching (`when x is { [] -> ... }` and `expect [ck] = vk.commitmentKeys`) eliminated the entire stdlib list module from the output. Always check whether removing a stdlib import is possible after eliminating its last call site.
- **BLS12-381 builtins are cheap in UPLC.** `bls12_381_g2_neg` compiles to a single UPLC builtin node — removing it saves only ~4 bytes. Don't pre-negate G2 points off-chain just to skip a builtin; the off-chain pipeline complexity is not worth the gain.
- **Aiken withdraw handlers need an explicit type annotation.** The `self: Transaction` parameter is not inferred — declare it explicitly or compilation fails confusingly.
- **Groth validator is parameterized.** Like `encryption` and `bidding`, it now takes `genesis_pid` / `genesis_tkn`. After Phase 5 of the optimization plan it is **1,642 bytes** (down from 23,415 — 93% total reduction). The encryption validator is **8,042 bytes** (from 10,308). Trade-off: bidding and genesis each grew ~229 bytes from the larger `ReferenceDatum` deserialization.

## Veiled desktop app (app/gui/)

All active product development happens here. The full architecture reference lives in [app/gui/CLAUDE.md](./app/gui/CLAUDE.md) — read that before changing anything in `app/gui/`. A few load-bearing facts to surface up here:

- **App name:** "Veiled" (single word — spaces produce awkward binary names).
- **Identifier:** `com.peace-protocol.veiled-desktop` (kept stable for app data dir compatibility).
- **Backend requires explicit build AND re-bundle.** Tauri runs `node dist/index.js`, *not* `tsx src/index.ts`. Worse, it loads from a *bundled* copy at `app/gui/src-tauri/resources/be/dist/`, not from `app/gui/be/dist/`. So a backend change needs `cd app/gui/be && npm run build` *and* `cd app/gui && npm run bundle:be` (copies `be/dist/` into `src-tauri/resources/be/dist/`) before restarting Tauri. `run.sh` runs both on startup, but the `tsc --watch` it leaves running only updates `be/dist/` — the bundled copy stays stale until you re-run `bundle:be` and restart. The frontend hot-reloads via Vite; the backend does not.
- **127.0.0.1 not localhost.** WebKitGTK on Linux has DNS resolution issues; all local URLs use `127.0.0.1`.
- **No CLAUDE.md duplication.** This file deliberately stays out of GUI internals — see `app/gui/CLAUDE.md` for context boundaries, modal patterns, IPC commands, and other GUI-specific conventions.

## Workflow

### Branches

- `main` — stable releases. Tagged `v0.X.Y` per release.
- `dev` — integration branch where feature PRs land.
- Feature branches: `feature/<name>` or `fix/<name>`, branched from `dev`.

PRs target `dev`. Releases are PRs from `dev` → `main`.

### GitHub project board (no Issues, no Done)

The repo intentionally does not use GitHub Issues. Track work as **draft items** on the [Veiled Application project board](https://github.com/orgs/logical-mechanism/projects/5):

```
Todo  →  In progress  →  Next release
```

Items do **not** move to Done. The "Next release" column accumulates everything that ships in the upcoming tag — that's the source of truth for the changelog. When prepping a release PR, query that column to enumerate what's in scope; the user moves prior-release items out at PR-creation time, not at version-bump time.

### Version bump checklist

Releasing a new version means updating **all eight** of these in lockstep:

1. `app/gui/src-tauri/tauri.conf.json` — `version`
2. `app/gui/src-tauri/Cargo.toml` — `version`
3. `app/gui/src-tauri/Cargo.lock` — the `[[package]] name = "veiled"` block
4. `app/gui/package.json` — `version` (and `package-lock.json`'s root + first-package entry)
5. `app/gui/fe/package.json` — `version` (and untracked fe `package-lock.json`)
6. `app/gui/be/package.json` — `version` (and untracked be `package-lock.json`)
7. `app/contracts/aiken.toml` — `version`
8. `CHANGELOG.md` (root) — new entry at top, dated, grouped Added / Fixed / Changed

### Commit conventions

Use Conventional Commits prefixes that map to changelog sections:

- `feat(area):` — new feature → **Added**
- `fix(area):` — bug fix → **Fixed**
- `chore(area):` / `refactor(area):` — maintenance → **Changed** (often skipped from changelog)
- `docs(area):` — documentation only → usually skipped

Example areas: `tutorials`, `i18n`, `data-layer`, `iagon`, `crypto`, `contracts`, `snark`. Match the existing log style.

## Cross-cutting gotchas

- **Barrel re-exports rot silently.** When you rename or remove an export inside a directory with an `index.ts` (e.g. `app/gui/fe/src/services/crypto/`), update the barrel re-export list. `tsc --noEmit` and the vitest suite can both pass while the barrel still names a removed binding — Vite catches it at runtime with `SyntaxError: Indirectly exported binding name 'X' is not found`, which presents as a blank white screen and a console error only. After any rename, `grep -rn '<OldName>' app/gui/fe/src` is the cheap check.
- **Don't commit secrets.** The `wallets/`, `data/`, `app/snark/secret.hash`, and any `.env` files contain or can contain key material. The `.gitignore` covers most of these; double-check `git status` before staging.
- **Sidecar binaries are gitignored.** `app/gui/src-tauri/binaries/` (~600 MB of `cardano-node`, `ogmios`, `kupo`, `mithril-client`, `snark`, `cardano-cli`) must be present locally for `tauri dev` / `tauri build`. `app/gui/check-prereqs.sh` validates them; `bash run.sh` sources it.

## License

- Code: GPL-3.0-only
- Documentation: CC-BY-4.0

Copyright © 2025–2026 Logical Mechanism LLC.
