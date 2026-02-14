# Changelog

All notable changes to the PEACE Protocol are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.3] - 2026-02-13

### Added

- GitHub Actions CI pipeline with jobs for Aiken, Python, Go, and TypeScript
- Architecture documentation with validator interaction map and data model (`documentation/architecture.md`)
- Community files: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`

### Changed

- README rewritten with architecture overview, validator size table, project structure, quick start, and testing instructions
- Go CI runs short tests only (`-short` flag)

### Removed

- Legacy `app/snark/.github/workflows/continuous-integration.yml` (replaced by root CI)

## [0.2.2] - 2026-02-12

### Changed

- Standardized encrypted payload format with CDDL schema (`peace-payload.cddl`)
- Payload is now data-layer-agnostic (supports IPFS CID, Arweave TX ID, URLs, or inline data)
- Happy path commands updated for new payload format

### Fixed

- Decrypt command updated to handle new payload structure

## [0.2.1] - 2026-02-10

### Added

- Claude security audit for smart contracts (`app/contracts/claude-audit.md`)
- Claude security audit for SNARK prover (`app/snark/claude-audit.md`)

### Changed

- Expanded Go/gnark test coverage with documentation on all exported functions
- Expanded Python test coverage to 80%+ per module
- Improved linting across all components (`lint.sh`, `run_tests.sh`)

## [0.2.0] - 2026-02-05

### Added

- Groth16 SNARK verification with gnark Pedersen commitment extension
- Multi-step re-encryption flow (UseSnark + UseEncryption)
- Pending/Open state machine for encryption UTxOs
- CancelEncryption with TTL-based expiry
- Web UI with WASM-based in-browser proving (React + MeshJS)
- Docker Compose for UI development and production
- Happy path shell scripts for end-to-end transaction building

### Changed

- Groth validator optimized from 23,415 to 1,642 bytes (93% reduction)
- Encryption validator reduced from 12,865 to 8,042 bytes (22% reduction)
- All validators parameterized with `genesis_pid`/`genesis_tkn`
- Verification key moved to on-chain ReferenceDatum

## [0.1.0] - 2026-01-01

### Added

- Initial PEACE Protocol implementation (MVP)
- Five validators: genesis, reference, encryption, bidding, groth
- Python CLI for wallet management, encryption, and transaction building
- Go/gnark SNARK prover with proof export
- BLS12-381 proxy re-encryption (Wang-Cao scheme)
- Schnorr sigma protocol and binding proof verification
- ECIES key encapsulation with AES-256-GCM
- Technical report, methodology, and milestone documentation
- Project Catalyst Fund 14 milestone proofs (M1-M4)
