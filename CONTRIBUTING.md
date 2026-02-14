# Contributing to the PEACE Protocol

Thank you for your interest in contributing to the PEACE Protocol.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.12+ | CLI, cryptography, tests |
| Go | 1.25+ | gnark SNARK prover |
| Aiken | v1.1.21 | Smart contract compiler |
| Node.js | 22+ | Web UI |
| cardano-cli | latest | Transaction building (happy path only) |

## Repository Structure

```
.
├── app/
│   ├── contracts/    # Aiken smart contracts (validators + types + tests)
│   ├── src/          # Python CLI modules
│   ├── snark/        # Go/gnark SNARK prover
│   ├── ui/           # TypeScript web UI (React frontend + Node.js backend)
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

For the web UI:

```bash
cd ui/fe
npm install
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

# TypeScript (UI)
cd app/ui/fe && npx vitest run
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

# TypeScript
cd ui && npm run lint
```

## Branch Workflow

- **main** — stable releases
- **dev** — integration branch
- Feature branches are created from `dev` with descriptive names

## Pull Request Process

1. Create a feature branch from `dev`
2. Make your changes
3. Ensure all tests pass (`./run_tests.sh`)
4. Run `./lint.sh` and fix any issues
5. Open a PR with a clear description of the changes
6. PRs require review before merging

## License

By contributing, you agree that your contributions will be licensed under:

- **Code:** GPL-3.0-only
- **Documentation:** CC-BY-4.0

Copyright (C) 2025 Logical Mechanism LLC
