/**
 * Transaction Builder Service
 *
 * Builds and submits Cardano transactions for the Peace Protocol.
 * Uses MeshTxBuilder with local Kupo (fetcher) and Ogmios (evaluator).
 *
 * This file is a compatibility shim — all implementation has moved to
 * the transactions/ directory, split by domain:
 *   - transactions/txUtils.ts    — shared utilities, types, constants
 *   - transactions/listings.ts   — listing lifecycle (create, retry, remove, cancel)
 *   - transactions/bids.ts       — bidding lifecycle (place, cancel)
 *   - transactions/acceptBid.ts  — SNARK proof + re-encryption (accept bid flow)
 *   - transactions/index.ts      — barrel re-export
 */

export * from './transactions';
