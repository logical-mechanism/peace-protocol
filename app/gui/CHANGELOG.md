# Changelog

All notable changes to the Veiled desktop application will be documented in this file.

## [0.3.0] - 2026-02-17

### Added
- Built-in wallet with mnemonic creation, import, and AES-256-GCM encrypted storage
- Local node infrastructure: cardano-node, Ogmios, Kupo managed as child processes
- Mithril snapshot bootstrap for fast first-run sync
- Native SNARK prover via snark_cli sidecar (~3 min vs browser WASM)
- Kupo adapter implementing MeshSDK IFetcher interface
- Node sync UI with progress tracking and stage indicators
- ZK key derivation from wallet key material (replaces CIP-30 signData)
- Express backend adapted to query Kupo for current state, Koios for historical data
- AppImage packaging for Linux

### Changed
- Renamed app from "Veiled Desktop" to "Veiled"
- Synchronized version numbers across all components (Tauri, Cargo, npm packages, Aiken contracts)
