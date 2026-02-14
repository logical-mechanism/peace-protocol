# The PRE-ECIES-AES-GCM Encryption (PEACE) Protocol

PEACE is a re-encryption protocol that enables the transfer of decryption rights on Cardano. Data remains encrypted at all times. The right to decrypt may be traded through a multi-hop, unidirectional proxy re-encryption scheme. PEACE is data-layer-agnostic — it provides the rails for re-encryption while projects build their own UI/UX on top.

## Architecture

PEACE consists of five on-chain validators and an off-chain toolchain:

| Component | Language | Purpose |
|-----------|----------|---------|
| Smart Contracts | Aiken (Plutus v3) | On-chain validation |
| CLI | Python | Wallet management, encryption, transaction building |
| SNARK Prover | Go (gnark) | Groth16 proof generation |
| Web UI | TypeScript (React + MeshJS) | Browser-based interface |

### Validators

| Validator | Size | Role |
|-----------|------|------|
| genesis | 1,055 B | One-shot token mint to bootstrap protocol |
| reference | 103 B | Stores verification key and script hashes as on-chain reference data |
| encryption | 8,042 B | Manages encryption UTxOs (mint, spend, re-encrypt) |
| bidding | 3,302 B | Manages bid UTxOs for decryption rights trading |
| groth | 1,642 B | Groth16 SNARK witness verification |

### Protocol Flow

1. **Entry Encryption** — Alice encrypts data and creates an encryption UTxO
2. **Bid Placement** — Bob places a bid for decryption rights
3. **Re-encryption** — Alice generates a SNARK proof and re-encrypts to Bob
4. **Decryption** — Bob decrypts using his private key

Re-encryption hops can repeat: Bob can sell to Carol, Carol to Dave, and so on.

## Project Structure

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

## Quick Start

See [app/README.md](./app/README.md) for full setup and happy path instructions.

## Testing

Run all test suites:

```bash
cd app && ./run_tests.sh
```

Individual suites:

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

## Documentation

- [Technical Report (PDF)](./documentation/technical_report.pdf)
- [Architecture and Data Model](./documentation/architecture.md)
- [Use Cases](./documentation/use-cases.md)
- [Smart Contract Audit](./app/contracts/claude-audit.md)
- [Groth Optimization History](./app/contracts/groth-optimization.md)
- [Encrypted Payload CDDL](./app/peace-payload.cddl)

## Funding

*This project was funded in Fund 14 of Project Catalyst.*

- [Proposal](https://projectcatalyst.io/funds/14/cardano-use-cases-concepts/decentralized-on-chain-data-encryption)
- [Milestones](https://milestones.projectcatalyst.io/projects/1400046)

## License

- **Code:** GPL-3.0-only
- **Documentation:** CC-BY-4.0

**Copyright (C) 2025 Logical Mechanism LLC**
