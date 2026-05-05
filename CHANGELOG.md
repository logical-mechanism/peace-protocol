# Changelog

All notable changes to the PEACE Protocol are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.5.3] - 2026-05-04

### Added
- Updater: accurate download progress with rolling-window speed and ETA, route toast Download to Settings, expand release notes into a modal, cancel an in-flight download (#128)
- Activity: wallet send/receive transactions in the History tab, sourced from a new `/api/chain/activity/:pkh` backend endpoint with scroll-to-top button on the virtualized list (#129)
- History: CSV export of historical sales and purchases for tax records, sourced from on-chain re-encryption events (#130)
- UI: Dusk three-color palette (lilac / mint / sand), marketplace and library card hierarchy with image banner / hero / quiet footer, tighter dashboard status pills, equal-height stat and listing cards, atmospheric empty state, welcome treatment for the wallet mode chooser, celebration toast on first wallet creation, type scale and `--text-*` token roles (#131)
- Marketplace: fuzzy near-match suggestion when a search yields no results, segmented control for Place Bid quick actions, Decrypt "How it works" collapses to a disclosure after first decrypt (#131)
- i18n: locale-aware `formatAda` / `formatDate` / `formatRelativeTime` helpers, lint guard against hardcoded a11y attribute strings, EN-key backfill for polish-pass strings, translated Dashboard tab badge aria-labels (#132)
- Inputs: thousands-separator comma formatting on Place Bid, Update Bid, and Update Price currency inputs, with a centralized `formatWithCommas` / `stripCommas` helper (D16) (#133)
- Typography: Bricolage Grotesque display face for hero text, with Inter and JetBrains Mono tracked via `@fontsource-variable` (#134)

### Fixed
- Updater: auto-check timer survives StrictMode double-invoke (#128)
- History: `reconcileWithOnChain` now refreshes existing records' fields from on-chain instead of insert-only, and reads `tx_timestamp` from Koios `/tx_info` (closes a long-silent stale-field bug) (#129)
- Activity: include wallet activity in the manual refresh path; `bundle:be` runs on `run.sh` startup so backend changes are not stale at runtime (#129)
- A11y: EncryptionCard description uses a real button instead of a `role=button` wrapper (#131)
- Library: equal-height grid cards regardless of imageLink presence (#131)
- Cards: scrim wrapper on image overlays, NSFW badge relocated to top-right, price + ADA and bid count + storage chips locked on one line (#131)
- MySales: stack price and storage badge on narrow cards; card price font scales with card width via container queries (#133)

## [0.5.2] - 2026-04-22

### Added
- i18n: extracted strings from core pages (WalletSetup, WalletUnlock, NodeSync) (#109)
- i18n: extracted Settings section strings (#110)
- i18n: extracted Dashboard tab strings (#111)
- i18n: extracted Dashboard modal strings (#113)
- i18n: extracted card, overlay, banner, and toast strings (#114)
- i18n: replaced ad-hoc pluralization with i18next count interpolation (#115)
- i18n: extracted Settings and Dashboard page shell strings (#116)
- i18n: extracted remaining component string leftovers (#117)
- 16 new locales: Spanish, French, German, Chinese, Japanese, Korean, Dutch, Russian, Indonesian, Vietnamese, Turkish, Portuguese, Italian, Polish, Hindi, Thai (#118)
- Tutorial: first-listing guided walkthrough with Restart Tutorials button in Settings (#119)
- Settings: Tutorials & Help hub with per-flow replay (#120)
- Tutorial: first-bid inline hints + spotlight overlay for PlaceBidModal (#121)
- Tutorial: first-decrypt walkthrough for buyers, with banner + Settings replay (#122)
- Tutorial: first-bid-accepted walkthrough for sellers, gated on a real pending bid (#123)
- Tutorial: Iagon setup primer for first file listing, synced to live connection status (#124)
- Iagon: detect expired API keys and flip connection indicator to disconnected
- Contracts: `audits/` folder with 2026-04-20 claude-opus-4-7 audit

### Fixed
- Data Layer: Verify button no longer flashes briefly on auth-failure race
- Data Layer: Verify button width no longer animates on click
- Tutorials: Iagon primer Start button now opens Settings → Data Layer directly
- Tutorials: eliminate choppy transitions when the spotlight moves between anchors — dedupe polling renders, scroll once per step, grace window across modal/tab handoffs, smooth spotlight slide (#125)
- i18n: translate hierarchical sub-categories (eg. `categories.text.message`, `audio.music.rock`) — `SubCategorySelector`, `CategoryFilter`, and modal pickers now render localized labels across all 17 locales
- i18n: localize the DecryptModal "How decryption works" helper — was hardcoded English, now state-driven with translated steps and WASM status across all 17 locales
- Badge: add `whitespace-nowrap` so longer translations of `Active`, `Pending`, etc. no longer wrap awkwardly inside small chips

## [0.5.1] - 2026-04-14

### Added
- Related listings: clickable seller and category chips on EncryptionCard, filter chips in MarketplaceTab, SET_SELLER_FILTER reducer, sellerPkh filter logic (#96)
- Accessibility: ARIA dialog semantics on modals and overlays, InfoTooltip ARIA, ImportListingModal input/error linking, focus trap stack-awareness, DOM-order focus, footer Close focus, focus ring, deferred blur validation (#97)
- System theme option that follows OS dark/light preference via `matchMedia`, with live subscription while 'system' is selected (#98)
- Settings: Contact & Support section (#100)
- Split Settings into dedicated Preferences tab for appearance/notification prefs (#101)
- i18n framework bootstrap: react-i18next + English locale (#102)
- Migrated remaining native `<select>` dropdowns to shared Select component (#103)
- Command palette (Ctrl+K) (#104)
- Tutorial framework: state machine, overlay, and storage (#105)
- Iagon storage usage indicator in Settings (#106)

### Fixed
- Crypto: handle BLS12-381 identity point in compressG1/G2 (#99)
- Seller display: render sellerPkh on cards instead of contract address; copy bech32 seller address instead of payment key hash; drop redundant seller bech32 field and use sellerPkh end-to-end (#96)
- Lock in legacy ContentMetadataJson migration behavior with regression test (#96)

### Changed
- Consolidated inline spinner SVGs onto shared LoadingSpinner component (#107)

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
