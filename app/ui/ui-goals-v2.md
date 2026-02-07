# Peace Protocol UI - Remaining Implementation Guide (v2)

This document focuses on the remaining work for the Peace Protocol UI. For completed phase details and implementation notes, reference `ui-goals.md`.

---

## Quick Reference

| Phase | Status | Dependency |
|-------|--------|------------|
| Phase 5: Blockchain Data Layer | **COMPLETE** | Contracts deployed (preprod) |
| Phase 11.5: WASM Loading Screen | **COMPLETE** | - |
| Phase 12a: Create Encryption Tx | **TODO** | Phase 5 |
| Phase 12b: Remove Encryption Tx | **TODO** | Phase 12a |
| Phase 12c: Create Bid Tx | **TODO** | Phase 12a |
| Phase 12d: Remove Bid Tx | **TODO** | Phase 12c |
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
| `transactionBuilder` | `fe/src/services/transactionBuilder.ts` | Stub tx patterns (extend for real txs) |
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
- `GET /api/protocol/config` — Returns real contract addresses, genesis token
- `GET /api/protocol/params` — Returns live protocol parameters from Koios
- `GET /api/encryptions` — Queries encryption contract, parses inline datums
- `GET /api/bids` — Queries bidding contract, parses inline datums

**Note:** CIP-20 metadata (description, suggestedPrice, storageLayer) requires querying the minting tx for each token — left as `undefined` for now. The UI handles missing metadata gracefully.

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

## Phase 12a: Create Encryption Transaction

**Status**: TODO

**Shell Script Reference:** `commands/03_createEncryptionTx.sh`
**Validator:** `validators/encryption.ak`
**Key Types:** `types/encryption.ak`, `types/level.ak`, `types/register.ak`, `types/schnorr.ak`

### What It Does

Seller creates an encrypted listing: mints an encryption token, builds an inline datum with BLS12-381 crypto artifacts, and sends it to the encryption contract address.

### Transaction Structure

```
Inputs:   Seller's wallet UTxO (for fees + min ADA)
Mints:    +1 encryption token (encryption policy)
Outputs:  Encryption contract address with:
            - Encryption token
            - Inline datum (EncryptionDatum)
            - Min ADA
Redeemer: EntryEncryptionMint(SchnorrProof, BindingProof)  [mint redeemer, constructor 0]
Refs:     Reference script UTxO (encryption policy at #1)
Metadata: CIP-20 key 674 with [description, suggestedPrice, storageLayer]
```

### Crypto Artifacts to Generate (browser-side)

1. **Derive seller secret** `sk` from wallet signature (`deriveSecretFromWallet`)
2. **Generate random secrets** `a`, `r` (store in IndexedDB via `secretStorage`)
3. **Compute `gtToHash(a)`** via WASM worker — this is the KEM step
4. **Build Register**: `{ generator: G1_GENERATOR, public_value: [sk]G1 }`
5. **Build SchnorrProof**: proves knowledge of `sk`
6. **Build HalfEncryptionLevel**: `{ r1b, r2_g1b, r4b }` from `a`, `r`
7. **Build BindingProof**: ties register to level entries
8. **Build Capsule**: AES-GCM encrypt the secret message using derived key
9. **Compute token name**: `CBOR(outputIndex) + txHash` truncated to 32 bytes

### Datum Shape (Plutus JSON for inline datum)

```json
{
  "constructor": 0,
  "fields": [
    { "bytes": "<owner_vkh 28 bytes>" },
    { "constructor": 0, "fields": [
      { "bytes": "<g1_generator 48 bytes>" },
      { "bytes": "<public_value 48 bytes>" }
    ]},
    { "bytes": "<token_name 32 bytes>" },
    { "constructor": 0, "fields": [
      { "bytes": "<r1b 48 bytes>" },
      { "bytes": "<r2_g1b 48 bytes>" },
      { "bytes": "<r4b 96 bytes>" }
    ]},
    { "constructor": 1, "fields": [] },
    { "constructor": 0, "fields": [
      { "bytes": "<nonce>" },
      { "bytes": "<aad>" },
      { "bytes": "<ct>" }
    ]},
    { "constructor": 0, "fields": [] }
  ]
}
```

Note: field 4 is `full_level = None` (constructor 1, empty fields). Field 6 is `status = Open` (constructor 0, empty fields).

### Key Challenge

The token name depends on the tx hash, which isn't known until the tx is built. The shell script computes it from the first input UTxO: `CBOR(tx_index) + tx_hash`, truncated to 32 bytes. The existing `computeTokenName()` helper in `transactionBuilder.ts` already implements this.

### Existing Code to Extend

- `transactionBuilder.ts` → `createListing()` — currently stub, has TODO for real MeshJS flow
- `fe/src/services/createEncryption.ts` — generates crypto artifacts (register, schnorr, half-level, capsule)
- `fe/src/services/secretStorage.ts` — stores `a`, `r` in IndexedDB

---

## Phase 12b: Remove Encryption Transaction

**Status**: TODO — depends on Phase 12a (need an encryption UTxO to remove)

**Shell Script Reference:** `commands/04a_removeEncryptionTx.sh`
**Validator:** `validators/encryption.ak`
**Key Types:** `types/encryption.ak` (RemoveEncryption redeemer)

### What It Does

Seller removes their own listing: spends the encryption UTxO and burns the encryption token. Only the owner (matching `owner_vkh` in datum) can do this.

### Transaction Structure

```
Inputs:   Encryption UTxO (from encryption contract)
          Seller's wallet UTxO (for fees)
Mints:    -1 encryption token (burn)
Outputs:  Remaining ADA back to seller
Redeemer: RemoveEncryption [spend redeemer, constructor 0]
          LeaveEncryptionBurn(token_name) [mint redeemer, constructor 1]
Refs:     Reference script UTxO (encryption policy at #1)
Signer:   Seller's payment key (must match datum owner_vkh)
```

### Notes

- Simple transaction — no crypto generation needed
- Must provide the existing inline datum as witness when spending from script
- The burn mint redeemer wraps the token name: `{ constructor: 1, fields: [{ bytes: "<token_name>" }] }`
- Seller must sign (validator checks `owner_vkh` is a signer)

---

## Phase 12c: Create Bid Transaction

**Status**: TODO — depends on Phase 12a (need an encryption to bid on)

**Shell Script Reference:** `commands/05_createBidTx.sh`
**Validator:** `validators/bidding.ak`
**Key Types:** `types/bidding.ak`, `types/register.ak`, `types/schnorr.ak`

### What It Does

Buyer places a bid on an encryption listing: mints a bid token, locks ADA as the bid amount, and creates a bid datum pointing to the target encryption.

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

### Crypto Artifacts to Generate (browser-side)

1. **Derive buyer secret** `sk` from wallet signature (`deriveSecretFromWallet`)
2. **Build Register**: `{ generator: G1_GENERATOR, public_value: [sk]G1 }`
3. **Build SchnorrProof**: proves knowledge of `sk`
4. **Compute bid token name**: `CBOR(outputIndex) + txHash` truncated to 32 bytes
5. **Store buyer secret** in IndexedDB via `bidSecretStorage`

### Datum Shape (Plutus JSON for inline datum)

```json
{
  "constructor": 0,
  "fields": [
    { "bytes": "<owner_vkh 28 bytes>" },
    { "constructor": 0, "fields": [
      { "bytes": "<g1_generator 48 bytes>" },
      { "bytes": "<public_value 48 bytes>" }
    ]},
    { "bytes": "<pointer (encryption token name)>" },
    { "bytes": "<bid token name>" }
  ]
}
```

### Key Differences from Encryption

- Uses **read-only reference inputs** for the encryption UTxO and genesis token (not spent)
- The bid amount is the lovelace value locked in the output (not in the datum)
- Simpler crypto: only Schnorr proof needed (no binding proof, no half-level)

### Existing Code to Extend

- `transactionBuilder.ts` → `placeBid()` — currently stub
- `fe/src/services/createBid.ts` — generates bid crypto artifacts (register, schnorr)
- `fe/src/services/bidSecretStorage.ts` — stores buyer secret

---

## Phase 12d: Remove Bid Transaction

**Status**: TODO — depends on Phase 12c (need a bid UTxO to remove)

**Shell Script Reference:** `commands/06_removeBidTx.sh`
**Validator:** `validators/bidding.ak`
**Key Types:** `types/bidding.ak` (RemoveBid redeemer)

### What It Does

Buyer cancels their bid: spends the bid UTxO, burns the bid token, and gets their locked ADA back.

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

### Notes

- Mirror of Phase 12b — simple spend + burn, no crypto generation
- Buyer must sign (validator checks `owner_vkh` is a signer)
- Returns the full bid amount (locked lovelace) to the buyer

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

## Testing Checklist

### After Each Phase

**Phase 12a — Create Encryption:**
- [ ] Create encryption succeeds on preprod
- [ ] Encryption appears in `/api/encryptions` response
- [ ] Secrets stored in IndexedDB
- [ ] Token name computed correctly

**Phase 12b — Remove Encryption:**
- [ ] Remove own encryption succeeds
- [ ] Encryption disappears from `/api/encryptions`
- [ ] Cannot remove someone else's encryption

**Phase 12c — Create Bid:**
- [ ] Create bid succeeds on preprod
- [ ] Bid appears in `/api/bids` response
- [ ] Bid amount matches locked lovelace
- [ ] Bid points to correct encryption

**Phase 12d — Remove Bid:**
- [ ] Remove own bid succeeds
- [ ] Bid disappears, ADA returned
- [ ] Cannot remove someone else's bid

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
- [ ] Insufficient funds error displays toast
- [ ] Transaction failure displays toast with error
- [ ] Network errors handled gracefully
- [ ] Wallet rejection handled
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
interface BidDatum {
  owner_vkh: string;
  owner_g1: Register;
  pointer: string;                // encryption token name
  token: string;                  // bid token name
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
