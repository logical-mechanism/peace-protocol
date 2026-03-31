# Contributing to the PEACE Protocol

Thank you for your interest in contributing to the PEACE Protocol.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.12+ | CLI, cryptography, tests |
| Go | 1.25+ | gnark SNARK prover |
| Aiken | v1.1.21 | Smart contract compiler |
| Node.js | 22+ | Desktop app (Tauri) + Web UI |
| Rust | 1.77.2+ | Tauri backend |
| cardano-cli | latest | Transaction building (happy path only) |

## Repository Structure

```
.
├── app/
│   ├── contracts/    # Aiken smart contracts (validators + types + tests)
│   ├── src/          # Python CLI modules
│   ├── snark/        # Go/gnark SNARK prover
│   ├── gui/          # Veiled desktop app (Tauri + React + Express)
│   ├── commands/     # Happy path shell scripts
│   └── tests/        # Python test suite
└── documentation/    # Technical report, milestones, use cases
```

## Development Setup

```bash
git clone https://github.com/logical-mechanism/peace-protocol.git
cd peace-protocol/app
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./setup.sh
```

For the desktop app (Tauri):

```bash
cd app/gui
bash run.sh          # Checks prerequisites, starts dev environment
# Or manually:
npm run install:all  # Install all deps + build backend
npx tauri dev        # Start Vite dev server + Tauri window
```

## Running Tests

Run all test suites:

```bash
cd app
./run_tests.sh
```

Or run individual suites:

```bash
# Aiken (smart contracts)
cd app/contracts && aiken check

# Python (CLI + crypto)
cd app && python -m pytest -s -vv

# Go (gnark prover)
cd app/snark && go test ./... -count=1 -v -timeout 60m

# Desktop app (Tauri)
cd app/gui && bash test.sh
```

## Linting and Formatting

Run all linters:

```bash
cd app
./lint.sh
```

Or individually:

```bash
# Python
ruff format . && ruff check . --fix && mypy .

# Aiken
cd contracts && aiken fmt

# Go
cd snark && gofmt -w . && go vet ./...

# Desktop app (Tauri)
cd gui && bash lint.sh
```

## Version Bump Checklist

When releasing a new version, update ALL of these files:

1. `app/gui/src-tauri/tauri.conf.json` — `version` field
2. `app/gui/src-tauri/Cargo.toml` — `version` field
3. `app/gui/package.json` — `version` field
4. `app/gui/fe/package.json` — `version` field
5. `app/gui/be/package.json` — `version` field
6. `app/contracts/aiken.toml` — `version` field
7. `app/gui/CHANGELOG.md` — add new entry at top

## Branch Workflow

- **main** — stable releases
- Feature branches are created from `main` with descriptive names

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass (`./run_tests.sh`)
4. Run `./lint.sh` and fix any issues
5. Open a PR with a clear description of the changes
6. PRs require review before merging

## License

By contributing, you agree that your contributions will be licensed under:

- **Code:** GPL-3.0-only
- **Documentation:** CC-BY-4.0

Copyright (C) 2025-2026 Logical Mechanism LLC