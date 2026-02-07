# Peace Protocol UI - Remaining Implementation Guide (v2)

This document focuses on the remaining work for the Peace Protocol UI. For completed phase details and implementation notes, reference `ui-goals.md`.

---

## Quick Reference

| Phase | Status | Dependency |
|-------|--------|------------|
| Phase 5: Blockchain Data Layer | **COMPLETE** | Contracts deployed (preprod) |
| Phase 11.5: WASM Loading Screen | **COMPLETE** | - |
| Phase 12a: Create Encryption Tx | **COMPLETE** | Phase 5 |
| Phase 12b: Remove Encryption Tx | **COMPLETE** | Phase 12a |
| Phase 12c: Create Bid Tx | **COMPLETE** | Phase 12a |
| Phase 12d: Remove Bid Tx | **COMPLETE** | Phase 12c |
| Phase 12e: SNARK Proof Tx | **TODO** | Phase 12a, 12c, Phase 11.5 |
| Phase 12f: Re-encryption Tx | **TODO** | Phase 12e |
| E2E Testing | **TODO** | Phase 12f |

**Contracts are deployed to preprod. MeshJS AI skills installed (`mesh-transaction`, `mesh-wallet`, `mesh-core-cst`).**

---

## Architecture Reference

```
ui/
├── fe/                          # Frontend (React)
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Page components
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # API calls, blockchain interactions
│   │   │   ├── snark/           # SNARK prover (worker, storage, prover)
│   │   │   └── crypto/          # BLS12-381, encryption, proofs
│   │   └── utils/               # Helpers
│   └── public/
│       └── snark/               # WASM prover files (pk.bin, ccs.bin, prover.wasm)
│
├── be/                          # Backend (Node.js)
│   └── src/
│       ├── routes/              # API routes
│       ├── services/            # Koios/Blockfrost clients, parsers
│       └── stubs/               # Development stub data
│
└── ui-goals.md                  # Complete implementation history
```

**Key External Files:**
- `contracts/lib/types/*.ak` - On-chain type definitions
- `contracts/plutus.json` - Compiled contract data
- `commands/*.sh` - Transaction building patterns (source of truth for each tx structure)
- `snark/wasm_main.go` - WASM prover source

---

## Existing Services to Reuse

These services are already implemented and should be reused:

| Service | Location | Purpose |
|---------|----------|---------|
| `secretStorage` | `fe/src/services/secretStorage.ts` | Seller secrets (a, r) in IndexedDB |
| `bidSecretStorage` | `fe/src/services/bidSecretStorage.ts` | Bidder secrets (b) in IndexedDB |
| `transactionBuilder` | `fe/src/services/transactionBuilder.ts` | Real MeshTxBuilder txs (create/remove encryption + create/remove bid implemented) |
| `transactionHistory` | `fe/src/services/transactionHistory.ts` | localStorage tx history with on-chain reconciliation |
| `HistoryTab` | `fe/src/components/HistoryTab.tsx` | Pending/confirmed/failed tx display with Blockfrost resolution |
| `SnarkProver` | `fe/src/services/snark/prover.ts` | WASM prover API with `generateProof()`, `gtToHash()`, `decryptToHash()` |
| `Toast` | `fe/src/components/Toast.tsx` | Notifications via `useToast()` hook |
| `SnarkProvingModal` | `fe/src/components/SnarkProvingModal.tsx` | Progress modal during proving |
| `SnarkDownloadModal` | `fe/src/components/SnarkDownloadModal.tsx` | Download progress for circuit files |
| `WasmContext` | `fe/src/contexts/WasmContext.tsx` | Global WASM state management |
| Crypto modules | `fe/src/services/crypto/*` | BLS12-381, schnorr, binding, ECIES, etc. |

**Key Crypto Functions (already implemented):**
```typescript
import {
  g1Point, scale, combine, rng,  // BLS12-381 operations
  schnorrProof,                   // Schnorr proof generation
  bindingProof,                   // Binding proof generation
  deriveSecretFromWallet,         // Wallet signature → secret derivation
} from '@/services/crypto'

import { getSnarkProver } from '@/services/snark'
const prover = getSnarkProver()
await prover.gtToHash(secretA)           // For encryption KEM
await prover.decryptToHash(g1b, r1, shared, g2b)  // For decryption/re-encryption
await prover.generateProof(inputs)       // SNARK proving
```

---

## Phase 5: Blockchain Data Layer (COMPLETE)

**Status**: COMPLETE — all endpoints return real preprod data when `USE_STUBS=false`.

### What Was Built

Replaced stub data with real Koios blockchain queries.

**Files Created:**
- `be/src/services/parsers.ts` — Plutus JSON datum parsing (field order matches Aiken types exactly)
- `be/src/services/encryptions.ts` — Query encryption contract UTxOs → `EncryptionDisplay`
- `be/src/services/bids.ts` — Query bidding contract UTxOs → `BidDisplay`

**Files Modified:**
- `be/src/services/koios.ts` — Auth token, `_extended: true`, switched to `/address_utxos` endpoint, added `getTxMetadata()`
- `be/src/config/index.ts` — Added `koiosToken`, `genesisTokenName` to config
- `be/src/routes/encryptions.ts` — Wired up real service calls
- `be/src/routes/bids.ts` — Wired up real service calls
- `be/src/routes/protocol.ts` — Real reference UTxO queries, real protocol params from Koios

**Verified endpoints:**
- `GET /api/protocol/config` — Returns real contract addresses, genesis token, reference address
- `GET /api/protocol/params` — Returns live protocol parameters from Koios
- `GET /api/encryptions` — Queries encryption contract, parses inline datums
- `GET /api/bids` — Queries bidding contract, parses inline datums

**Note (12c addition):** `ProtocolConfig.contracts.referenceAddress` was added during Phase 12c — needed for looking up the genesis token UTxO via `BlockfrostProvider.fetchAddressUTxOs()` in the frontend transaction builder. Updated in BE types, BE route, BE stubs, and FE types.

**Note:** CIP-20 metadata (description, suggestedPrice, storageLayer) is now fetched via `koios.getTxMetadata()` for each UTxO. See Koios gotcha below.

### Datum Parsing Reference

Koios returns `inline_datum.value` as pre-parsed Plutus JSON — no CBOR library needed:
```typescript
{ constructor: 0, fields: [{ bytes: "..." }, { int: 42 }, ...] }
```

**Constructor Index Mapping** (from Aiken types):
- `Status::Open` = constructor 0
- `Status::Pending` = constructor 1
- `Option::Some(x)` = constructor 0, fields: [x]
- `Option::None` = constructor 1, fields: []

**Field Order** (critical — must match Aiken definitions):
- `EncryptionDatum`: owner_vkh, owner_g1, token, half_level, full_level, capsule, status
- `BidDatum`: owner_vkh, owner_g1, pointer, token

---

## Phase 11.5: WASM Loading Screen (COMPLETE)

**Status**: Implemented

**Key Files:**
- `fe/src/pages/WasmLoadingScreen.tsx` - Loading screen component
- `fe/src/contexts/WasmContext.tsx` - WASM state management
- `fe/src/App.tsx` - Route guard integration

**Flow:** Wallet Connect → WASM Loading Screen → Dashboard (skips if already loaded)

---

## Phase 12a: Create Encryption Transaction (COMPLETE)

**Status**: COMPLETE — tested on preprod, listing appears in marketplace with CIP-20 metadata.

**Shell Script Reference:** `commands/03_createEncryptionTx.sh`
**Validator:** `validators/encryption.ak`
**Key Types:** `types/encryption.ak`, `types/level.ak`, `types/register.ak`, `types/schnorr.ak`

### What Was Built

Real `createListing()` in `transactionBuilder.ts` using `MeshTxBuilder`. Generates all crypto artifacts browser-side, builds the Plutus datum, mints the encryption token via reference script, and attaches CIP-20 metadata.

### Implementation Notes

- **PKH extraction**: `deserializeAddress(address).pubKeyHash` from `@meshsdk/core` — used everywhere for user-specific filtering (not bech32 address comparison)
- **UTxO sorting**: Sort wallet UTxOs by `txHash + outputIndex` before selecting the first one for token name computation. Without sorting, the UTxO order is non-deterministic and token name won't match what ends up in the tx.
- **Reference script**: Use `mintTxInReference(refTxHash, refIndex)` with output index `1` (not `0`) — the encryption policy reference script sits at index 1.
- **Inline datum**: Pass as Plutus JSON object to `.txOutInlineDatumValue(datum, 'JSON')`.
- **CIP-20 metadata**: `.metadataValue(674, { msg: [description, price, storageLayer] })` — stored as key 674 per CIP-20 standard.
- **Dashboard**: All tabs use `userPkh` prop (not `userAddress`) — compare `e.sellerPkh === userPkh` and `b.bidderPkh === userPkh` for filtering.
- **Post-tx UX**: After successful tx submission, redirect to History tab (`setActiveTab('history')`) for immediate pending tx feedback. Auto-refresh timer (20s) updates data after block confirmation.

---

## Phase 12b: Remove Encryption Transaction (COMPLETE)

**Status**: COMPLETE — tested on preprod, listing removed and token burned.

**Shell Script Reference:** `commands/04a_removeEncryptionTx.sh`
**Validator:** `validators/encryption.ak`
**Key Types:** `types/encryption.ak` (RemoveEncryption redeemer)

### What Was Built

Real `removeListing()` in `transactionBuilder.ts`. Spends the encryption UTxO, burns the token, returns ADA to seller.

### Implementation Notes

- **Spend redeemer**: `RemoveEncryption` = `{ constructor: 0, fields: [] }`
- **Mint redeemer**: `LeaveEncryptionBurn` = `{ constructor: 1, fields: [{ bytes: tokenName }] }`
- **Burn**: Use `.mint('-1', policyId, tokenName)` — the `-1` string triggers a burn.
- **Inline datum witness**: Use `.txInInlineDatumPresent()` — tells the tx builder the datum is inline (no separate datum hash needed).
- **Reference script**: Same pattern as 12a — `spendingTxInReference(refTxHash, refIndex)` and `mintTxInReference(refTxHash, refIndex)` both pointing to index 1.
- **No confirmation dialog**: Removed after user feedback — the wallet signing popup is sufficient confirmation.

### MeshTxBuilder Pattern for Spend + Burn

```typescript
const mesh = new MeshTxBuilder({ fetcher, submitter, evaluator });
mesh
  .spendingPlutusScriptV3()
  .txIn(utxo.txHash, utxo.outputIndex)
  .spendingTxInReference(refTxHash, refIndex)
  .txInInlineDatumPresent()
  .txInRedeemerValue(spendRedeemer, 'JSON', { mem: 14000000, steps: 10000000000 })
  .mintPlutusScriptV3()
  .mint('-1', policyId, tokenName)
  .mintTxInReference(refTxHash, refIndex)
  .mintRedeemerValue(mintRedeemer, 'JSON')
  .txInCollateral(collateral.txHash, collateral.outputIndex, collateral.amount, collateral.address)
  .requiredSignerHash(ownerPkh)
  .changeAddress(changeAddress)
  .selectUtxosFrom(utxos)
  .complete();
```

This same pattern applies to Phase 12d (Remove Bid) — just swap policy IDs and redeemer constructors.

---

## Phase 12c: Create Bid Transaction (COMPLETE)

**Status**: COMPLETE — tested on preprod, bid appears in marketplace and View Bids modal.

**Shell Script Reference:** `commands/05_createBidTx.sh`
**Validator:** `validators/bidding.ak`
**Key Types:** `types/bidding.ak`, `types/register.ak`, `types/schnorr.ak`

### What Was Built

Real `placeBid()` in `transactionBuilder.ts` using `MeshTxBuilder`. Generates bid crypto artifacts browser-side, mints bid token via reference script, locks ADA at bidding contract with inline datum, and uses read-only reference inputs for genesis token and encryption UTxO.

### Transaction Structure

```
Inputs:   Buyer's wallet UTxO (bid amount + fees)
Mints:    +1 bid token (bidding policy)
Outputs:  Bidding contract address with:
            - Bid token
            - Inline datum (BidDatum)
            - Bid amount in ADA (this IS the bid — lovelace locked at script)
Redeemer: EntryBidMint(SchnorrProof) [mint redeemer, constructor 0]
Refs:     Reference script UTxO (bidding policy at #1)
          Encryption UTxO (read-only reference — validates encryption exists)
          Genesis token UTxO (read-only reference — validates protocol)
```

### Datum Shape (Plutus JSON for inline datum)

**CRITICAL — field order must match Aiken `BidDatum { owner_vkh, owner_g1, pointer, token }`:**
```json
{
  "constructor": 0,
  "fields": [
    { "bytes": "<owner_vkh 28 bytes>" },
    { "constructor": 0, "fields": [
      { "bytes": "<g1_generator 48 bytes>" },
      { "bytes": "<public_value 48 bytes>" }
    ]},
    { "bytes": "<pointer — bid's own token name>" },
    { "bytes": "<token — encryption token name being bid on>" }
  ]
}
```

**WARNING:** `pointer` and `token` are easy to confuse. On-chain the validator checks `pointer == token_name` (i.e., the bid's own minted token name). The `token` field is the encryption token name the bid targets. This was a source of bugs in the backend `bids.ts` field mapping — see Lessons Learned.

### Implementation Notes

- **Read-only reference inputs**: `.readOnlyTxInReference(txHash, txIndex)` for both genesis token UTxO and encryption UTxO. These are NOT spent — just referenced so the validator can verify the encryption exists and the genesis token is at the reference address.
- **Genesis UTxO lookup**: Uses `BlockfrostProvider.fetchAddressUTxOs(referenceAddress)` to find the UTxO holding the genesis token at the reference contract address. Filter by `unit === policyId + tokenName`.
- **UTxO selection fix**: The explicit `.txIn(firstUtxo)` used for token name computation must be **excluded** from the `.selectUtxosFrom()` pool. Otherwise the coin selector double-counts it and produces "Insufficient input" errors on subsequent transactions.
- **PlaceBidModal**: `onSubmit` callback passes `encryptionUtxo` so the tx builder can add it as a read-only reference.
- **Bid secret storage**: After successful tx, buyer secret is stored in IndexedDB via `bidSecretStorage.store(bidTokenName, { sk, ... })` for later use in accept-bid flow.
- **Bid amount**: The ADA locked at the contract output IS the bid. Lovelace = `bidAmountAda * 1_000_000`. Output uses `[{ unit: 'lovelace', quantity: lovelace.toString() }, { unit: biddingPolicyId + bidTokenName, quantity: '1' }]`.

---

## Phase 12d: Remove Bid Transaction (COMPLETE)

**Status**: COMPLETE — tested on preprod, bid removed and ADA returned to buyer.

**Shell Script Reference:** `commands/06_removeBidTx.sh`
**Validator:** `validators/bidding.ak`
**Key Types:** `types/bidding.ak` (RemoveBid redeemer)

### What Was Built

Real `cancelBid()` in `transactionBuilder.ts`. Mirrors `removeListing()` — spends the bid UTxO, burns the bid token, returns locked ADA to buyer.

### Transaction Structure

```
Inputs:   Bid UTxO (from bidding contract)
          Buyer's wallet UTxO (for fees)
Mints:    -1 bid token (burn)
Outputs:  Locked ADA back to buyer
Redeemer: RemoveBid [spend redeemer, constructor 0]
          LeaveBidBurn(token_name) [mint redeemer, constructor 1]
Refs:     Reference script UTxO (bidding policy at #1)
Signer:   Buyer's payment key (must match datum owner_vkh)
```

### Implementation Notes

- **Exact mirror of Phase 12b** — same spend + burn MeshTxBuilder pattern, swapped policy IDs and contract address.
- **`cancelBid()` signature**: Accepts full bid object `{ tokenName, utxo, datum }` instead of just tokenName, since the UTxO reference is needed to spend it.
- **IndexedDB cleanup**: After successful burn, deletes the bid secret from `bidSecretStorage` since it's no longer needed.
- **Spend redeemer**: `RemoveBid` = `{ constructor: 0, fields: [] }`
- **Mint redeemer**: `LeaveBidBurn` = `{ constructor: 1, fields: [{ bytes: tokenName }] }`

---

## Phase 12e: SNARK Proof Transaction

**Status**: TODO — depends on 12a + 12c (need encryption + bid on-chain), Phase 11.5 (WASM loaded)

**Shell Script Reference:** `commands/07a_createSnarkTx.sh`
**Validator:** `validators/groth.ak` (withdraw), `validators/encryption.ak` (spend)
**Key Types:** `types/groth.ak`, `types/encryption.ak` (UseSnark redeemer)

### What It Does

Seller initiates the accept-bid flow: generates a Groth16 SNARK proof in the browser (~5 min), then submits a transaction that updates the encryption to `Pending` status. The groth validator runs as a **stake withdrawal handler** (not a spend) for on-chain Groth16 verification.

### Complete Flow

```
1. User clicks "Accept Bid"
2. Retrieve seller secrets (a, r) from IndexedDB
3. Get buyer's public key from bid datum
4. Compute SNARK public inputs (v, w0, w1)
5. Generate Groth16 proof in Web Worker (~5 minutes)
6. Build and submit SNARK transaction
7. Wait for on-chain confirmation
```

### Transaction Structure

```
Inputs:     Encryption UTxO (spent — updated with Pending status)
            Seller's wallet UTxO (for fees)
Withdrawal: Groth stake address (triggers on-chain Groth16 verification)
            Amount: reward balance (must match exactly)
            Redeemer: GrothWitnessRedeemer (proof + public inputs + TTL)
Outputs:    Encryption contract address with:
              - Same encryption token
              - Updated datum (status = Pending with groth_public + TTL)
              - Same ADA
Redeemer:   UseSnark [spend redeemer, constructor 2]
Refs:       Reference script UTxO (groth + encryption)
Validity:   invalidBefore = currentSlot, invalidAfter = currentSlot + 300 (~5 min)
Signer:     Seller's payment key
```

### SNARK Input Preparation

```typescript
const handleAcceptBid = async (encryption: EncryptionDisplay, bid: BidDisplay) => {
  // 1. Get seller secrets from IndexedDB
  const secrets = await secretStorage.get(encryption.tokenName)

  // 2. Get buyer's public key from bid datum
  const buyerG1 = bid.datum.owner_g1.public_value

  // 3. Prepare SNARK inputs
  const snarkInputs = {
    secretA: secrets.a,
    secretR: secrets.r,
    publicInputs: {
      v: buyerG1,                                           // buyer's public key
      w0: encryption.datum.half_level.r2_g1b,               // from existing datum
      w1: computeW1(secrets.a, secrets.r, buyerG1),         // [a]G + [r]V
    },
  }

  // 4. Generate proof via WASM worker (~5 minutes)
  const { proof, public: grothPublic } = await prover.generateProof(snarkInputs)
}
```

**Computing W1:**
```typescript
import { bls12_381 as bls } from '@noble/curves/bls12-381'

function computeW1(a: string, r: string, V: string): string {
  const aQ = bls.G1.ProjectivePoint.BASE.multiply(BigInt(a))
  const rV = bls.G1.ProjectivePoint.fromHex(V).multiply(BigInt(r))
  return aQ.add(rV).toHex(true) // Compressed
}
```

### GrothWitnessRedeemer Shape (for stake withdrawal)

```json
{
  "constructor": 0,
  "fields": [
    { "constructor": 0, "fields": [
      { "bytes": "<piA G1>" },
      { "bytes": "<piB G2>" },
      { "bytes": "<piC G1>" },
      { "list": [{ "bytes": "<commitment>" }] },
      { "bytes": "<commitmentPok>" }
    ]},
    { "bytes": "<commitment_wire>" },
    { "list": [{ "int": 0 }, { "int": 1 }, ...] },
    { "int": "<ttl_posix_ms>" }
  ]
}
```

### Important Notes

- **Stake withdrawal pattern** — unusual. The groth validator runs as a withdraw handler.
- MeshJS may require `MeshTxBuilder` (lower-level) instead of `Transaction` for this pattern.
- The TTL in the datum should use `pending_ttl` constant (6 hours per Aiken source).
- The `snark_validity_window` is 1 hour per Aiken source.

---

## Phase 12f: Re-encryption Transaction

**Status**: TODO — depends on Phase 12e (encryption must be in Pending status)

**Shell Script Reference:** `commands/07b_createReEncryptionTx.sh`
**Validator:** `validators/encryption.ak` (UseEncryption), `validators/bidding.ak` (UseBid)
**Key Types:** `types/encryption.ak`, `types/bidding.ak`, `types/level.ak`

### What It Does

Seller completes the sale: spends both the encryption and bid UTxOs, burns the bid token, updates the encryption datum with FullEncryptionLevel (enabling buyer decryption), and transfers the bid ADA to the seller.

### Transaction Structure

```
Inputs:     Encryption UTxO (in Pending status — updated with FullEncryptionLevel)
            Bid UTxO (spent — token burned, ADA to seller)
            Seller's wallet UTxO (for fees)
Mints:      -1 bid token (burn)
Outputs:    Encryption contract address with:
              - Same encryption token
              - Updated datum (full_level populated, status back to Open)
            Seller's address with:
              - Bid ADA amount
Redeemers:  UseEncryption(r5_witness, r5, bid_token, binding_proof) [encryption spend, constructor 1]
            UseBid [bid spend, constructor 1]
            LeaveBidBurn(bid_token_name) [bid mint, constructor 1]
Refs:       Reference script UTxOs (encryption + bidding policies)
Signer:     Seller's payment key
```

### Crypto Computation

**Computing FullEncryptionLevel:**
```typescript
async function computeFullLevel(
  halfLevel: HalfEncryptionLevel,
  buyerRegister: Register,
  sellerSecrets: { a: string, r: string }
): Promise<FullEncryptionLevel> {
  const prover = getSnarkProver()
  const shared = scale(buyerRegister.public_value, BigInt(sellerSecrets.a))
  const r2_g2b = await prover.decryptToHash(
    buyerRegister.public_value, halfLevel.r1b, shared, ''
  )
  return {
    r1b: halfLevel.r1b,
    r2_g1b: halfLevel.r2_g1b,
    r2_g2b,                        // New field computed via WASM
    r4b: halfLevel.r4b,
  }
}
```

**Computing r5 and witness** (for UseEncryption redeemer):
- r5 and r5_witness are BLS12-381 G2 elements
- Computed from seller secret, buyer public key, and hash-to-scalar
- Requires binding proof tying the re-encryption to the original encryption

### TTL Handling

After SNARK tx succeeds, seller must complete re-encryption before TTL expires:
```typescript
const ttl = encryptionDatum.status.ttl
const remaining = ttl - Date.now()
// Show: "Complete re-encryption within X minutes"
```

### Error Recovery

**If SNARK tx succeeds but re-encryption tx fails:**
- Encryption is in `Pending` status with TTL
- Show countdown and "Retry Re-encryption" button
- If TTL expires, use `CancelEncryption` redeemer (constructor 3) to reset to `Open`

**If user closes browser during accept bid flow:**
- On return, detect `Pending` status encryptions owned by user
- Show recovery options: "Complete Sale" or "Cancel"

---

## Lessons Learned (12a–12d)

These patterns and gotchas apply to all remaining phases.

### Koios API Gotcha: Metadata Format

Koios `/tx_metadata` returns metadata as an **object** (`{"674": {...}}`), NOT an array (`[{key: "674", json: ...}]`). The `getTxMetadata()` in `koios.ts` converts this to array format via `Object.entries()`. If adding new Koios endpoints, always check the actual response shape.

### PKH-Based Filtering (Critical)

All user-specific filtering must use payment key hash (PKH), not bech32 address:
- UTxOs sit at the **script contract address**, not the user's wallet address
- The user's identity is in the **datum** (`owner_vkh` field)
- Extract PKH: `deserializeAddress(address).pubKeyHash` from `@meshsdk/core`
- Filter: `e.sellerPkh === userPkh` (not `e.seller === address`)

### Transaction History Architecture

- `transactionHistory.ts`: localStorage-based, keyed by wallet PKH
- `reconcileWithOnChain()`: Merges on-chain UTxO records into localStorage, promotes pending→confirmed
- `resolvePendingTxs()`: For txs where UTxO is consumed (remove-listing, cancel-bid), checks Blockfrost `/txs/{hash}` directly since there's no on-chain UTxO to match
- `HistoryTab` notifies Dashboard via `onHistoryUpdated` callback so the pending badge updates
- All successful tx submissions redirect to History tab for immediate pending feedback

### MeshTxBuilder Patterns

- **Redeemer budget**: `{ mem: 14000000, steps: 10000000000 }` works for encryption spend. May need adjustment per validator.
- **Reference scripts at index 1**: The encryption policy reference script is at output index 1 of the reference tx, not index 0.
- **Collateral**: `const collateral = await wallet.getCollateral()` — use `collateral[0]`.
- **UTxO selection**: `mesh.selectUtxosFrom(utxos)` handles change automatically.
- **Inline datum**: `.txOutInlineDatumValue(datum, 'JSON')` for outputs, `.txInInlineDatumPresent()` for spending.
- **Read-only reference inputs**: `.readOnlyTxInReference(txHash, txIndex)` — used for genesis token UTxO and encryption UTxO in bid creation. These are NOT spent.

### UTxO Selection Pitfall (Critical — 12c bug fix)

When using an explicit `.txIn(firstUtxo)` (e.g., for token name computation), that UTxO **must be filtered out** of the `.selectUtxosFrom()` pool:
```typescript
.selectUtxosFrom(utxos.filter(u =>
  !(u.input.txHash === firstUtxo.input.txHash && u.input.outputIndex === firstUtxo.input.outputIndex)
))
```
Without this, the coin selector double-counts the explicit input's ADA. This causes "Insufficient input" errors on the second+ transaction when the wallet has multiple UTxOs — the selector picks the already-included UTxO and doesn't add enough additional inputs to cover the output. This fix was applied to both `createListing()` and `placeBid()`.

### BidDatum Field Mapping (Critical — backend bug fix)

The Aiken `BidDatum` has fields: `owner_vkh, owner_g1, pointer, token`. These names are confusing:
- `pointer` (fields[2]) = the **bid's own token name** (validated on-chain: `pointer == minted_token_name`)
- `token` (fields[3]) = the **encryption token name** being bid on

The backend `bids.ts` originally had these swapped (`encryptionToken: datum.pointer` instead of `datum.token`), causing the View Bids modal to show no results since `MySalesTab` filters by `b.encryptionToken === encryption.tokenName`.

### Post-Tx UX Pattern

After any successful tx submission:
1. Record tx in `transactionHistory` via `addTransaction()`
2. `setActiveTab('history')` — redirects to History tab
3. `setRefreshKey(prev => prev + 1)` — triggers immediate data refresh in other tabs
4. **Escalating auto-refresh** — schedule retries at 20s, 45s, 90s, 180s after submission:
```typescript
for (const delay of [20_000, 45_000, 90_000, 180_000]) {
  setTimeout(() => {
    setRefreshKey(prev => prev + 1)
    setHistoryKey(prev => prev + 1)
  }, delay)
}
```
This replaced a single 20s timeout that was insufficient for preprod mempool delays (txs can sit in mempool for >1 minute). The escalating retries ensure pending→confirmed status updates, badge counts, and tab data all refresh correctly even with slow block times.

---

## Testing Checklist

### After Each Phase

**Phase 12a — Create Encryption:**
- [x] Create encryption succeeds on preprod
- [x] Encryption appears in `/api/encryptions` response
- [x] Secrets stored in IndexedDB
- [x] Token name computed correctly
- [x] CIP-20 metadata (description, price, storage layer) displayed in marketplace cards

**Phase 12b — Remove Encryption:**
- [x] Remove own encryption succeeds
- [x] Encryption disappears from `/api/encryptions`
- [x] Transaction recorded in History tab, resolves to confirmed via Blockfrost

**Phase 12c — Create Bid:**
- [x] Create bid succeeds on preprod
- [x] Bid appears in `/api/bids` response
- [x] Bid amount matches locked lovelace
- [x] Bid points to correct encryption
- [x] Seller can see bid in View Bids modal (after backend field mapping fix)
- [x] Bid secret stored in IndexedDB

**Phase 12d — Remove Bid:**
- [x] Remove own bid succeeds
- [x] Bid disappears, ADA returned
- [x] Bid secret cleaned up from IndexedDB

**Phase 12e — SNARK Tx:**
- [ ] SNARK proof generates in browser (~5 min)
- [ ] SNARK tx submits and confirms
- [ ] Encryption status changes to Pending
- [ ] TTL set correctly

**Phase 12f — Re-encryption Tx:**
- [ ] Re-encryption tx submits and confirms
- [ ] Bid token burned
- [ ] Encryption has FullEncryptionLevel populated
- [ ] Seller receives bid ADA
- [ ] Buyer can decrypt (off-chain verification)

**Edge Cases:**
- [x] Insufficient funds handled (UTxO selection fix — explicit txIn excluded from selectUtxosFrom)
- [x] Transaction failure displays toast with error
- [x] Wallet rejection handled (catch block in all tx flows)
- [x] Auto-refresh works for slow mempool (escalating retries at 20s/45s/90s/180s)
- [ ] Network errors handled gracefully
- [ ] SNARK proving timeout handled
- [ ] Invalid bid (wrong encryption) prevented
- [ ] Pending encryption recovery works

---

## Key Data Structures

### TypeScript Interfaces

```typescript
// Encryption Datum (from contracts/lib/types/encryption.ak)
interface EncryptionDatum {
  owner_vkh: string;              // 28 bytes hex
  owner_g1: Register;             // BLS12-381 public key register
  token: string;                  // 32 bytes hex
  half_level: HalfEncryptionLevel;
  full_level: FullEncryptionLevel | null;
  capsule: Capsule;
  status: Status;
}

interface Register {
  generator: string;              // 96 hex chars (compressed G1)
  public_value: string;           // 96 hex chars (compressed G1)
}

interface HalfEncryptionLevel {
  r1b: string;                    // 96 hex chars (compressed G1)
  r2_g1b: string;                 // 96 hex chars (compressed G1)
  r4b: string;                    // 192 hex chars (compressed G2)
}

interface FullEncryptionLevel {
  r1b: string;                    // 96 hex chars (compressed G1)
  r2_g1b: string;                 // 96 hex chars (compressed G1)
  r2_g2b: string;                 // 192 hex chars (compressed G2) - NEW
  r4b: string;                    // 192 hex chars (compressed G2)
}

interface Capsule {
  nonce: string;                  // 24 hex chars (12 bytes, AES-GCM nonce)
  aad: string;                    // 64 hex chars (32 bytes, additional auth data)
  ct: string;                     // variable hex (ciphertext + 16-byte GCM tag)
}

type Status =
  | { type: 'Open' }
  | { type: 'Pending'; groth_public: number[]; ttl: number };

// Bid Datum (from contracts/lib/types/bidding.ak)
// IMPORTANT: pointer and token names are counterintuitive — see Lessons Learned
interface BidDatum {
  owner_vkh: string;
  owner_g1: Register;
  pointer: string;                // bid's own token name (validated on-chain: pointer == token_name)
  token: string;                  // encryption token name being bid on
}

// Redeemers (from contracts/lib/types/*.ak)
type EncryptionMintRedeemer =
  | { type: 'EntryEncryptionMint'; schnorr: SchnorrProof; binding: BindingProof }  // constructor 0
  | { type: 'LeaveEncryptionBurn'; token: string };                                 // constructor 1

type EncryptionSpendRedeemer =
  | { type: 'RemoveEncryption' }                                                    // constructor 0
  | { type: 'UseEncryption'; r5_witness: string; r5: string; bid_token: string; binding: BindingProof }  // constructor 1
  | { type: 'UseSnark' }                                                            // constructor 2
  | { type: 'CancelEncryption' };                                                   // constructor 3

type BidMintRedeemer =
  | { type: 'EntryBidMint'; schnorr: SchnorrProof }                                // constructor 0
  | { type: 'LeaveBidBurn'; token: string };                                        // constructor 1

type BidSpendRedeemer =
  | { type: 'RemoveBid' }                                                           // constructor 0
  | { type: 'UseBid' };                                                             // constructor 1

interface SchnorrProof {
  z_b: string;                    // scalar as bytes
  g_r_b: string;                  // 96 hex chars (compressed G1)
}

interface BindingProof {
  z_a_b: string;                  // scalar as hex
  z_r_b: string;                  // scalar as hex
  t_1_b: string;                  // 96 hex chars (compressed G1)
  t_2_b: string;                  // 96 hex chars (compressed G1)
}
```

### SNARK Interface

```typescript
// Input to WASM prover
interface SnarkProvingInput {
  secretA: string;                // Decimal string
  secretR: string;                // Decimal string
  publicInputs: {
    v: string;                    // 96 hex (buyer's public key)
    w0: string;                   // 96 hex
    w1: string;                   // 96 hex
  };
}

// Output from WASM prover
interface SnarkProvingOutput {
  proof: GrothProof;
  public: number[];               // 36 field elements
}

interface GrothProof {
  piA: string;                    // 96 hex (compressed G1)
  piB: string;                    // 192 hex (compressed G2)
  piC: string;                    // 96 hex (compressed G1)
}
```

### Test Values for SNARK Verification

When testing browser WASM proving:
```
a  = 44203
r  = 12345
v  = 821285b97f9c0420a2d37951edbda3d7c3ebac40c6f194faa0256f6e569eba49829cd69c27f1837368b207b6948a2aad
w0 = a1430f9e40e13f50164c1b0f6248289e09a281d2c80ce2ccea81800c62bc4afa4f9235c727f9837368b207b6948a2aad
w1 = 8ac69bdd182386def9f70b444794fa6d588182ddaccdffc26163fe415424ec374c672dfde52d875863118e6ef892bbac
```

---

## Environment Variables

### Frontend (`fe/.env`)
```bash
VITE_USE_STUBS=true              # Controls FE transaction building (stub vs real MeshJS txs)
VITE_API_URL=http://localhost:3001
VITE_SNARK_CDN_URL=/snark        # Or CDN URL in production
VITE_BLOCKFROST_PROJECT_ID_PREPROD=preprodXXXXX
```

**Stub toggle relationship:**
- `BE USE_STUBS` — controls **data queries** (stubs vs real Koios). Set to `false` (Phase 5 complete).
- `FE VITE_USE_STUBS` — controls **transaction building** (fake tx hashes vs real MeshJS txs). Flip to `false` when implementing real tx submission in `transactionBuilder.ts`.
- These are independent — you can query real data (BE stubs off) while still using stub transactions (FE stubs on) during development.

### Backend (`be/.env`)
```bash
USE_STUBS=false                  # Phase 5 complete — real Koios queries
PORT=3001
NETWORK=preprod

# Koios (free tier with token)
KOIOS_URL_PREPROD=https://preprod.koios.rest/api/v1
KOIOS_TOKEN_PREPROD=<jwt_token>

# Blockfrost
BLOCKFROST_PROJECT_ID_PREPROD=<project_id>

# Contract addresses (preprod) — POPULATED
ENCRYPTION_CONTRACT_ADDRESS_PREPROD=addr_test1zqfl3cd3trh0gahfugupjkll0ekzfxg09qnr50dqfqlehtuxca55rx42vu7fv0dqfe94htjy34ysut82eypvhqhymfmq4gcsaj
ENCRYPTION_POLICY_ID_PREPROD=13f8e1b158eef476e9e238195bff7e6c24990f28263a3da0483f9baf
BIDDING_CONTRACT_ADDRESS_PREPROD=addr_test1zrutpgd0ehk6u33kq53zj7t2fd0nctskn98d0hjwwd2je2vxca55rx42vu7fv0dqfe94htjy34ysut82eypvhqhymfmqg8f0nj
BIDDING_POLICY_ID_PREPROD=f8b0a1afcdedae4636052229796a4b5f3c2e16994ed7de4e73552ca9
REFERENCE_CONTRACT_ADDRESS_PREPROD=addr_test1wrh72ullu9qu064yvs5gtdhdkcdl9tkeekkmy227zgvw5pc99mgsw
GENESIS_POLICY_ID_PREPROD=cd4b05f60ca9c57d09db7d55c08d0a670f08fd939d3c1e1e261eb461
GENESIS_TOKEN_NAME_PREPROD=00071634a2901a48236e45a035ce6f679832bf0e664fdc3abfcd12581a96ec2d
```

---

## Running the Project

```bash
# From ui/ directory
npm run dev        # Runs both FE (port 5173) and BE (port 3001)
npm run dev:fe     # Runs frontend only
npm run dev:be     # Runs backend only
npm run test       # Run unit tests
```

**SNARK Files Setup (for development):**
```bash
cp app/circuit/pk.bin app/ui/fe/public/snark/
cp app/circuit/ccs.bin app/ui/fe/public/snark/
```

---

## Important Notes

### SNARK Performance
- Setup loading: ~99 minutes (one-time, cached in IndexedDB)
- Proof generation: ~5 minutes
- Total circuit files: ~497 MB

### Browser Support
- Chrome only (best Cardano wallet support)
- Desktop only (SNARK proving needs 2GB+ RAM)
- Eternl wallet recommended for testing

### Secret Storage Warning
User secrets (a, r) are stored in IndexedDB. If browser data is cleared, seller cannot complete sales. Consider implementing backup/export functionality.

### Testing Strategy for Phase 12
Testing transaction building (12a-12f) requires a connected wallet, preprod ADA, and browser interaction (signing popups, wallet approvals). **Do not attempt to automate or loop on testing from the CLI** — the user will test by running the UI (`npm run dev`), connecting Eternl, and clicking buttons. After implementing each sub-phase, hand off to the user for manual testing and report back errors/console output. This avoids circular debugging loops where the AI tries to start servers, curl endpoints, or simulate wallet interactions that require a real browser environment.

---

## Reference: Transaction Building

**Approach:** Each shell script in `commands/` is the source of truth for a transaction's structure (inputs, outputs, minting, redeemers, datums, validity). The corresponding validator in `contracts/validators/` defines what the on-chain script expects. The types in `contracts/lib/types/` define the exact datum and redeemer shapes. MeshJS AI skills (`mesh-transaction`, `mesh-wallet`, `mesh-core-cst`) are installed in `~/.claude/skills/` and provide `MeshTxBuilder` patterns for translating these CLI flows into TypeScript.

### Shell Scripts → MeshJS Mapping

| Script | Phase | Purpose | Validator | Key Types |
|--------|-------|---------|-----------|-----------|
| `commands/03_createEncryptionTx.sh` | 12a | Create listing | `validators/encryption.ak` | `types/encryption.ak`, `types/level.ak`, `types/register.ak` |
| `commands/04a_removeEncryptionTx.sh` | 12b | Remove listing | `validators/encryption.ak` | `types/encryption.ak` (RemoveEncryption redeemer) |
| `commands/04b_cancelEncryptionTx.sh` | 12f | Cancel pending | `validators/encryption.ak` | `types/encryption.ak` (CancelEncryption redeemer) |
| `commands/05_createBidTx.sh` | 12c | Place bid | `validators/bidding.ak` | `types/bidding.ak`, `types/register.ak`, `types/schnorr.ak` |
| `commands/06_removeBidTx.sh` | 12d | Cancel bid | `validators/bidding.ak` | `types/bidding.ak` (RemoveBid redeemer) |
| `commands/07a_createSnarkTx.sh` | 12e | SNARK proof tx | `validators/groth.ak`, `validators/encryption.ak` | `types/groth.ak`, `types/encryption.ak` (UseSnark redeemer) |
| `commands/07b_createReEncryptionTx.sh` | 12f | Complete sale | `validators/encryption.ak`, `validators/bidding.ak` | `types/encryption.ak` (UseEncryption), `types/bidding.ak` (UseBid), `types/level.ak` |

### Supporting Scripts

| Script | Purpose | Validator |
|--------|---------|-----------|
| `commands/00_createScriptReferences.sh` | Deploy reference scripts | - |
| `commands/01a_createGenesisTx.sh` | Mint genesis token | `validators/genesis.ak` |
| `commands/01b_registerGrothTx.sh` | Register groth stake | `validators/groth.ak` |
| `commands/02a_updateReferenceTx.sh` | Update reference datum | `validators/reference.ak` |
| `commands/08_decryptMessage.sh` | Decrypt (off-chain only) | - |

### On-Chain Type Definitions

| Type File | Defines | Used By |
|-----------|---------|---------|
| `contracts/lib/types/encryption.ak` | `EncryptionDatum`, `EncryptionSpendRedeemer`, `EncryptionMintRedeemer` | 12a, 12b, 12e, 12f |
| `contracts/lib/types/bidding.ak` | `BidDatum`, `BidSpendRedeemer`, `BidMintRedeemer` | 12c, 12d, 12f |
| `contracts/lib/types/groth.ak` | `GrothWitnessRedeemer`, `SnarkVerificationKey` | 12e |
| `contracts/lib/types/level.ak` | `HalfEncryptionLevel`, `FullEncryptionLevel` | 12a, 12f |
| `contracts/lib/types/register.ak` | `Register` | 12a, 12c |
| `contracts/lib/types/schnorr.ak` | `SchnorrProof`, `BindingProof` | 12a, 12c, 12f |
| `contracts/lib/types/reference.ak` | `ReferenceDatum` | 12c (read-only ref) |

**Note:** The SNARK tx (`07a`) uses a **stake withdrawal** for on-chain Groth16 verification — this is unusual. The groth validator runs as a withdraw handler, not a spend. Read the script + `validators/groth.ak` together to understand the pattern.
