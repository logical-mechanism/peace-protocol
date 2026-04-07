# Changelog

All notable changes to the PEACE Protocol are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.5.0] - 2026-04-05

### Added
- Auto-accept bid queue: background queue for automated bid acceptance with sequential SNARK proof processing (#80)
- Queue management UI panel and automation settings section (#80)
- Auto-accept bid detection hook for incoming bids (#80)
- Re-sold purchase handling: owner-scoped decrypt and bid-secret discovery (#81)
- Marketplace seller filter, date range filter, multi-select category filter, and alphabetical sort (#82)
- Search match highlighting in seller address on EncryptionCard (#82)
- `react-day-picker` date picker with app accent color theming (#82)
- `kupo_since` config option to skip syncing from genesis (#82)
- Filter storage migration for categoryFilter string-to-array upgrade (#82)
- Extracted marketplace filter/sort logic into pure testable functions with comprehensive tests (#82)

### Fixed
- UTxO value lookup failures for pre-`--since` UTxOs: replaced Koios merge in `fetchAddressUTxOs` with live Koios fallback in `fetchUTxOs` to avoid stale spent UTxOs polluting wallet state
- `kupo_since` slot moved before reference script deployment to ensure Kupo indexes all protocol UTxOs
- BidTimeline showing "complete" immediately for re-purchased content: now compares library `decryptedAt` against bid `createdAt` to only mark complete for the current purchase
- Optimistic listing price displayed as raw ADA instead of lovelace
- Price inputs now clamp to Cardano max supply (45B ADA) instead of erroring
- Accept-bid queue: memoize context, fix dedup bug, type safety, safe PKH derivation (#80)
- Accept-bid queue: decouple queue processing from Dashboard lifecycle (#80)
- Purchased card layout: flex-wrap for badges, consistent token hex truncation (#81)
- Date picker: document-level listener to dismiss WebKitGTK date picker (#82)
- Lint fixes: eslint-disable placement, unused vars, setState-in-effect (#80, #82)

### Changed
- Marketplace "You have a bid" indicator updates instantly via optimistic store (no API round-trip delay)
- Transaction success toasts show clickable "View History" link instead of auto-switching to the History tab
- Marketplace filter controls evenly distributed across full panel width (#82)
- Hide-own-listings toggle changed to icon-only next to favorites (#82)
- CategoryFilter extracted into its own component (#82)

## [0.4.3] - 2026-03-20

### Added
- Import from Iagon: create listing and relisting from existing uploads (#71)
- Relist as icon button for quicker re-listing workflow (#71)
- App update downloader (#70)
- ARIA accessibility attributes for screen readers (BidTimeline, PasswordStrengthIndicator, MnemonicInput, EncryptionCard favorites, InfoTooltip) (#71)
- Keyboard hint for Library select mode Cancel button (#71)
- Additional MIME types (.3gp, .m2ts, .wma, .wmv) in media server (#71)

### Fixed
- Price math and text auto-populate for listings (#71)
- Event listener leak in useUpdateCheck on fast unmount (#71)
- Backend API resilience: exact PKH match, no empty cache entries, flush on shutdown (#71)
- SnarkProvingModal setState calls after unmount (#71)
- Media server bind failure now handled gracefully instead of panicking (#71)
- File-open error type distinction in media server (#71)
- Stale lock file detection and removal in secrets file locking (#71)
- Invalid block_time guard in createdAt conversion (#71)
- Cached health status invalidation when circuit breaker leaves OPEN state (#71)
- CBOR indefinite-length parsing bounds checks to prevent infinite loops (#71)
- Replaced alert() fallbacks with console.warn in sales/purchases tabs (#71)

### Changed
- Backend metadata batch fetch logs warning when fewer results than requested (#71)
- CI caches all three package-lock.json files (#71)
- Config validation requires contracts section (#71)

## [0.4.2] - 2026-03-18

### Added
- Transaction chaining for accept-bid + re-encryption flow (#62)
- Block-based background polling for transaction confirmation (#63)

### Fixed
- Wallet unlock hang caused by CPU-intensive sync operations (#65)
- Reduced Koios API calls by over 90% (#65)
- Modal background scroll prevention (#57)
- Helper text / tooltip z-index layering (#64)
- AppImage Ogmios connection issues (#58)

### Changed
- Improved wallet login flow (#60)
- Improved marketplace loading flow (#61)
- Refactored large frontend files for improved maintainability (#66)
- Updated copyright headers to 2025-2026 across all source files (#66)

## [0.4.1] - 2026-03-09

### Fixed
- Mithril snapshot playback and CORS issues (HTTP proxy via reqwest, LMDB conversion, node/CLI updates)
- Modal scroll lock centralized in ModalContext and ScrollToTop hidden behind modals

## [0.4.0] - 2026-03-08

### Added
- Improved GUI with enhanced video player, audio player, and accessibility features
- Bid timelock to mitigate grief attacks on the smart contracts
- File upload limit increased from 100 MB to 1 GB

### Changed
- Kupo port from 1442 to 44203
- FFmpeg WASM bundled locally (no CDN dependency)
- Removed proof-of-concept statements as the project matures

## [0.3.0] - 2026-02-15

### Added

- MPC trusted setup ceremony for SNARK prover with CLI subcommands (`ceremony.go`)
- Network-based configuration files (`config.local.json`, `config.preprod.json`, `config.mainnet.json`)
- Shared `search.ak` library for reusable token/datum/redeemer lookup functions
- Example environment file (`example.env`) with network selection

### Changed

- Reference validator is now immutable (spend handler removed; datum cannot be updated or removed)
- Mainnet builds compile without traces (`--trace-level silent`); local/preprod retain full traces
- Shell commands source a single `.env` with `NETWORK` variable to select the target network
- Validators refactored to use shared `search` library (deduplicated `has`, `no_output_holds_token`)
- Bidding validator uses selective stdlib import (`list.{has}`) and drops `option` import
- Removed `?` trace operators from bidding and encryption validators for cleaner boolean logic

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
