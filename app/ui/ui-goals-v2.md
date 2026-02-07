# Peace Protocol UI - Remaining Implementation Guide (v2)

This document focuses on the remaining work for the Peace Protocol UI. For completed phase details and implementation notes, reference `ui-goals.md`.

---

## Quick Reference

| Phase | Status | Dependency |
|-------|--------|------------|
| Phase 5: Blockchain Data Layer | **TODO** | Contracts deployed (preprod) |
| Phase 11.5: WASM Loading Screen | **COMPLETE** | - |
| Phase 12: Accept Bid Flow | **TODO** | Phase 5 |
| E2E Testing | **TODO** | Phase 12 |

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
│       ├── services/            # Koios/Blockfrost clients
│       └── stubs/               # Development stub data
│
└── ui-goals.md                  # Complete implementation history
```

**Key External Files:**
- `contracts/lib/types/*.ak` - On-chain type definitions
- `contracts/plutus.json` - Compiled contract data
- `commands/*.sh` - Transaction building patterns
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

## Phase 5: Blockchain Data Layer

**Status**: READY — contracts deployed to preprod, `USE_STUBS=false` in BE `.env`.

### What to Build

Replace stub data with real blockchain queries.

**Tasks:**
- [ ] Query encryptions from encryption contract (`ENCRYPTION_CONTRACT_ADDRESS_PREPROD`)
- [ ] Query bids from bidding contract (`BIDDING_CONTRACT_ADDRESS_PREPROD`)
- [ ] Query reference UTxO data (`REFERENCE_CONTRACT_ADDRESS_PREPROD`)
- [ ] Parse inline datums (Koios Plutus JSON → TypeScript types matching `contracts/lib/types/*.ak`)
- [ ] Implement caching (optional, recommended)

### Implementation Details

1. **Backend Environment:** DONE — `be/.env` populated with preprod addresses, `USE_STUBS=false`.

2. **Koios API Reference:** https://preprod.koios.rest/#overview

   Existing client methods in `be/src/services/koios.ts`:
   ```typescript
   // - getAddressUtxos(address) - Get UTxOs at contract address
   // - getAssetUtxos(policyId, assetName?) - Get UTxOs by asset
   // - getTxInfo(txHash) - Get transaction details
   // - getTip() - Get current tip
   // - getProtocolParams() - Get protocol parameters
   ```

   **IMPORTANT:** Many Koios endpoints have additional options that change the response shape.
   For example, `_extended: true` must be passed in the request body to get `inline_datum`
   populated — without it, `inline_datum` will be `null` even if the UTxO has one. Other
   endpoints may have similar options for metadata, script info, etc. Always check the Koios
   docs for the specific endpoint before implementing — there may be a better endpoint or
   option than the obvious one. Additional endpoints beyond those listed above may be needed.

3. **Datum Parsing — NO CBOR library needed:**
   Koios returns `inline_datum` with two fields:
   - `bytes` — raw CBOR hex (for tx building / datum hash verification)
   - `value` — **pre-parsed Plutus JSON** using `{ constructor: N, fields: [...] }` format

   Parse the `value` field directly — no `cbor-x` or CBOR decoding required:
   ```typescript
   // Koios inline_datum.value is already structured JSON
   function parseEncryptionDatum(datumValue: PlutusJSON): EncryptionDatum {
     // datumValue is { constructor: 0, fields: [...] }
     // Map fields by index to TS types
     // See contracts/lib/types/encryption.ak for field ordering
   }
   ```

4. **Constructor Index Mapping** (from Aiken types):
   - `Status::Open` = constructor 0
   - `Status::Pending` = constructor 1
   - Field order matches `contracts/lib/types/encryption.ak`

5. **Files to Create/Modify:**
   - `be/src/services/parsers.ts` - Datum parsing functions (Plutus JSON → TS types)
   - `be/src/services/encryptions.ts` - Encryption business logic
   - `be/src/services/bids.ts` - Bid business logic
   - Update routes to call service functions when `USE_STUBS=false`

6. **Real Koios UTxO Response** (from preprod reference contract):
   ```json
   {
     "tx_hash": "a7760f8a6e45fd8e380e47a26d2acd2378521c3d81b10b4118d882312cafa225",
     "tx_index": 0,
     "address": "addr_test1wrh72ullu9qu064yvs5gtdhdkcdl9tkeekkmy227zgvw5pc99mgsw",
     "value": "12382630",
     "stake_address": null,
     "payment_cred": "efe573ffe141c7eaa4642885b6edb61bf2aed9cdadb2295e1218ea07",
     "epoch_no": 269,
     "block_height": 4397328,
     "block_time": 1770409768,
     "datum_hash": "24a785e7553202728051c666dd1c28f11711c04a8cae41b23a1374c19f039301",
     "inline_datum": {
       "bytes": "d8799f581c...cbor_hex...",
       "value": {
         "constructor": 0,
         "fields": [
           { "bytes": "efe573ff..." },
           { "bytes": "13f8e1b1..." },
           ...
         ]
       }
     },
     "reference_script": null,
     "asset_list": [
       {
         "policy_id": "cd4b05f60ca9c57d09db7d55c08d0a670f08fd939d3c1e1e261eb461",
         "asset_name": "00071634a2901a48236e45a035ce6f679832bf0e664fdc3abfcd12581a96ec2d",
         "quantity": "1",
         "decimals": 0,
         "fingerprint": "asset1u6t5qr72uh92plhwhme0mqflw9u0shd93yl0g0"
       }
     ],
     "is_spent": false
   }
   ```

7. **Plutus JSON Format** (as returned by Koios `inline_datum.value`):
   ```typescript
   // Constructor with fields
   { constructor: 0, fields: [field1, field2, ...] }
   { constructor: 1, fields: [field1, field2, ...] }

   // Bytes (hex string)
   { bytes: "abcdef0123..." }

   // Integer
   { int: 42 }

   // List
   { list: [item1, item2, ...] }

   // Nested constructor
   { constructor: 0, fields: [{ bytes: "..." }, { int: 37 }] }
   ```

---

## Phase 11.5: WASM Loading Screen (COMPLETE)

**Status**: Implemented

**Key Files:**
- `fe/src/pages/WasmLoadingScreen.tsx` - Loading screen component
- `fe/src/contexts/WasmContext.tsx` - WASM state management
- `fe/src/App.tsx` - Route guard integration

**Flow:** Wallet Connect → WASM Loading Screen → Dashboard (skips if already loaded)

---

## Phase 12: Accept Bid Flow (SNARK + Re-encryption)

**Status**: READY — contracts deployed. Requires Phase 5 (real data) first.

**Prerequisites**: Phase 11.5 WASM Loading Screen (COMPLETE), Phase 5 Blockchain Data Layer.

### Complete Flow

```
User clicks "Accept Bid"
→ Retrieve seller secrets (a, r) from IndexedDB
→ Get bid details (buyer's public key, amount)
→ Generate proof in Web Worker (~5 minutes)
→ Build SNARK transaction
→ Submit SNARK tx and wait for confirmation
→ Build re-encryption transaction
→ Submit re-encryption tx
→ Show success modal with tx hashes
```

### Tasks Checklist

- [ ] Trigger SNARK proving modal from BidsModal "Accept Bid" button
- [ ] Generate proof in Web Worker
- [ ] Build and submit SNARK tx — follow `commands/07a_createSnarkTx.sh` + `validators/groth.ak` + `types/groth.ak`
- [ ] Wait for confirmation
- [ ] Build and submit re-encryption tx — follow `commands/07b_createReEncryptionTx.sh` + `validators/encryption.ak` + `validators/bidding.ak`
- [ ] Update UI state
- [ ] Handle errors at each step

### Integration Points

**Dashboard.tsx updates:**
```typescript
import SnarkProvingModal from '../components/SnarkProvingModal'
import type { SnarkProofInputs, SnarkProof } from '../services/snark'

const [showSnarkModal, setShowSnarkModal] = useState(false)
const [snarkInputs, setSnarkInputs] = useState<SnarkProofInputs | null>(null)

const handleAcceptBid = useCallback(async (encryption: EncryptionDisplay, bid: BidDisplay) => {
  // 1. Get seller secrets from IndexedDB
  const secrets = await secretStorage.get(encryption.tokenName)
  if (!secrets) {
    showError('Seller secrets not found. Cannot complete sale.')
    return
  }

  // 2. Get buyer's public key from bid datum
  const buyerG1 = bid.ownerG1.public_value // Compressed G1 hex

  // 3. Prepare SNARK inputs
  setSnarkInputs({
    secretA: secrets.a,  // Decimal string
    secretR: secrets.r,  // Decimal string
    publicV: buyerG1,    // 96 hex chars
    publicW0: encryption.halfLevel.r2_g1b,
    publicW1: computeW1(secrets.a, secrets.r, buyerG1), // [a]q + [r]v
  })

  setShowSnarkModal(true)
}, [])
```

**Computing W1:**
```typescript
import { bls12_381 as bls } from '@noble/curves/bls12-381'

function computeW1(a: string, r: string, V: string): string {
  const aBigInt = BigInt(a)
  const rBigInt = BigInt(r)
  const vPoint = bls.G1.Point.fromHex(V)

  const aQ = bls.G1.Point.BASE.multiply(aBigInt)
  const rV = vPoint.multiply(rBigInt)
  const w1 = aQ.add(rV)

  return w1.toHex(true) // Compressed
}
```

### SNARK Transaction Structure

Reference: `commands/07a_createSnarkTx.sh`

```typescript
const snarkTx = {
  // Spend the encryption UTxO
  inputs: [encryptionUtxo],

  // Reference the groth script
  referenceInputs: [grothScriptRef],

  // Stake withdrawal for on-chain verification
  withdrawal: {
    address: grothStakeAddress,
    amount: rewardBalance, // Must match exactly
    redeemer: proof, // The generated SNARK proof
  },

  // Output back to encryption contract with Pending status
  outputs: [{
    address: encryptionContractAddress,
    assets: [{ policyId, tokenName }],
    datum: {
      ...existingDatum,
      status: {
        type: 'Pending',
        groth_public: proof.publicInputs, // 36 field elements
        ttl: Date.now() + 20 * 60 * 1000, // 20 minute TTL
      },
    },
  }],

  // Validity interval
  validityInterval: {
    invalidBefore: currentSlot,
    invalidAfter: currentSlot + 300, // ~5 minutes
  },
}
```

**Note**: MeshJS may require manual tx building for stake withdrawal pattern.

### Re-encryption Transaction

Reference: `commands/07b_createReEncryptionTx.sh`

**What it does:**
- Burns the bid token
- Updates encryption datum with FullEncryptionLevel
- Transfers locked ADA to seller

**Computing FullEncryptionLevel:**
The re-encryption requires computing the `FullEncryptionLevel` which includes `r2_g2b`. This uses the WASM `decryptToHash` function:

```typescript
import { getSnarkProver } from '@/services/snark'
import { scale } from '@/services/crypto'

async function computeFullLevel(
  halfLevel: HalfEncryptionLevel,
  buyerRegister: Register,
  sellerSecrets: { a: string, r: string }
): Promise<FullEncryptionLevel> {
  const prover = getSnarkProver()

  // Compute shared = [a]V where V is buyer's public key
  const shared = scale(buyerRegister.public_value, BigInt(sellerSecrets.a))

  // Compute r2_g2b using WASM (BLS12-381 pairing operation)
  // This is needed for the buyer to decrypt later
  const r2_g2b = await prover.decryptToHash(
    buyerRegister.public_value,  // g1b - buyer's G1 public key
    halfLevel.r1b,                // r1 from half level
    shared,                       // [a]V
    ''                            // g2b - empty for seller computation
  )

  return {
    r1b: halfLevel.r1b,
    r2_g1b: halfLevel.r2_g1b,
    r2_g2b: r2_g2b,               // New field computed via WASM
    r4b: halfLevel.r4b,
  }
}
```

**Re-encryption Transaction Structure:**
```typescript
const reEncryptionTx = {
  // Spend encryption UTxO (now in Pending status)
  inputs: [encryptionUtxo],

  // Spend bid UTxO
  inputs: [bidUtxo],

  // Burn bid token
  mint: [{ policyId: bidPolicyId, tokenName: bidTokenName, quantity: -1 }],

  // Output encryption with FullEncryptionLevel
  outputs: [{
    address: encryptionContractAddress,
    assets: [{ policyId: encPolicyId, tokenName: encTokenName }],
    datum: {
      ...existingDatum,
      full_level: fullEncryptionLevel,  // Now populated
      status: { type: 'Open' },         // Back to Open (or could be Completed)
    },
  }],

  // Pay seller
  outputs: [{
    address: sellerAddress,
    value: bidAmount,
  }],
}
```

### TTL Handling

After SNARK tx succeeds, show countdown timer:
```typescript
const ttl = encryptionDatum.status.ttl
const remaining = ttl - Date.now()
const minutes = Math.floor(remaining / 60000)
// Show: "Complete re-encryption within X minutes"
```

---

## Testing Checklist

### After Contracts Deploy

**Wallet Testing:**
- [ ] Connect with Eternl
- [ ] Disconnect works
- [ ] Reconnect on page refresh
- [ ] Address displays correctly

**Transaction Testing:**
- [ ] Create encryption succeeds
- [ ] Remove encryption succeeds
- [ ] Create bid succeeds
- [ ] Remove bid succeeds
- [ ] SNARK tx succeeds
- [ ] Re-encryption tx succeeds
- [ ] Decrypt works

**Edge Cases:**
- [ ] Insufficient funds error displays toast
- [ ] Transaction failure displays toast with error
- [ ] Network errors handled gracefully
- [ ] Wallet rejection handled
- [ ] SNARK proving timeout handled
- [ ] Invalid bid (wrong encryption) prevented

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
type EncryptionSpendRedeemer =
  | { type: 'RemoveEncryption' }
  | { type: 'UseEncryption'; r5_witness: string; r5: string; bid_token: string; binding: BindingProof }
  | { type: 'UseSnark' }
  | { type: 'CancelEncryption' };

type BidSpendRedeemer =
  | { type: 'RemoveBid' }
  | { type: 'UseBid' };

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
- `BE USE_STUBS` — controls **data queries** (stubs vs real Koios). Flip to `false` for Phase 5.
- `FE VITE_USE_STUBS` — controls **transaction building** (fake tx hashes vs real MeshJS txs). Flip to `false` when implementing real tx submission in `transactionBuilder.ts`.
- These are independent — you can query real data (BE stubs off) while still using stub transactions (FE stubs on) during development.

### Backend (`be/.env`)
```bash
USE_STUBS=false                  # Contracts deployed to preprod
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

### Error Recovery - Phase 12

**If SNARK tx succeeds but re-encryption tx fails:**
- Encryption is now in `Pending` status with TTL
- User has ~20 minutes to retry re-encryption tx
- Show clear countdown and "Retry Re-encryption" button
- If TTL expires, use `CancelEncryption` redeemer to reset to `Open` status

**If user closes browser during accept bid flow:**
- SNARK proof is lost (not stored)
- Encryption may be in `Pending` status on-chain
- On return, detect `Pending` status and show options:
  - "Complete Sale" (re-generate proof if TTL not expired - requires ~5 min)
  - "Cancel" (if TTL expired or user wants to abort)

**Recovery Detection:**
```typescript
// On dashboard load, check for pending encryptions owned by user
const userEncryptions = await encryptionsApi.getByUser(userPkh)
const pendingEncryptions = userEncryptions.filter(e => e.status.type === 'Pending')

if (pendingEncryptions.length > 0) {
  // Show recovery modal
  for (const enc of pendingEncryptions) {
    const ttlRemaining = enc.status.ttl - Date.now()
    if (ttlRemaining > 0) {
      showRecoveryModal(enc, 'complete')  // Can still complete
    } else {
      showRecoveryModal(enc, 'cancel')    // Must cancel
    }
  }
}
```

---

## Reference: Transaction Building

**Approach:** Each shell script in `commands/` is the source of truth for a transaction's structure (inputs, outputs, minting, redeemers, datums, validity). The corresponding validator in `contracts/validators/` defines what the on-chain script expects. The types in `contracts/lib/types/` define the exact datum and redeemer shapes. MeshJS AI skills (`mesh-transaction`, `mesh-wallet`, `mesh-core-cst`) are installed in `~/.claude/skills/` and provide `MeshTxBuilder` patterns for translating these CLI flows into TypeScript.

### Shell Scripts → MeshJS Mapping

| Script | Purpose | Validator | Key Types |
|--------|---------|-----------|-----------|
| `commands/03_createEncryptionTx.sh` | Create listing | `validators/encryption.ak` | `types/encryption.ak`, `types/level.ak`, `types/register.ak` |
| `commands/04a_removeEncryptionTx.sh` | Remove listing | `validators/encryption.ak` | `types/encryption.ak` (RemoveEncryption redeemer) |
| `commands/04b_cancelEncryptionTx.sh` | Cancel pending | `validators/encryption.ak` | `types/encryption.ak` (CancelEncryption redeemer) |
| `commands/05_createBidTx.sh` | Place bid | `validators/bidding.ak` | `types/bidding.ak`, `types/register.ak`, `types/schnorr.ak` |
| `commands/06_removeBidTx.sh` | Cancel bid | `validators/bidding.ak` | `types/bidding.ak` (RemoveBid redeemer) |
| `commands/07a_createSnarkTx.sh` | SNARK proof tx | `validators/groth.ak`, `validators/encryption.ak` | `types/groth.ak`, `types/encryption.ak` (UseSnark redeemer) |
| `commands/07b_createReEncryptionTx.sh` | Complete sale | `validators/encryption.ak`, `validators/bidding.ak` | `types/encryption.ak` (UseEncryption), `types/bidding.ak` (UseBid), `types/level.ak` |

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
| `contracts/lib/types/encryption.ak` | `EncryptionDatum`, `EncryptionSpendRedeemer` | Create/remove/cancel encryption, SNARK, re-encryption |
| `contracts/lib/types/bidding.ak` | `BidDatum`, `BidSpendRedeemer` | Create/remove bid, re-encryption |
| `contracts/lib/types/groth.ak` | `GrothRedeemer`, `VerificationKey` | SNARK tx (stake withdrawal redeemer) |
| `contracts/lib/types/level.ak` | `HalfEncryptionLevel`, `FullEncryptionLevel` | Encryption datum fields |
| `contracts/lib/types/register.ak` | `Register` | Owner public keys in encryption + bid datums |
| `contracts/lib/types/schnorr.ak` | `SchnorrProof` | Bid creation proof |
| `contracts/lib/types/reference.ak` | `ReferenceDatum` | Genesis reference UTxO |

**Note:** The SNARK tx (`07a`) uses a **stake withdrawal** for on-chain Groth16 verification — this is unusual. The groth validator runs as a withdraw handler, not a spend. Read the script + `validators/groth.ak` together to understand the pattern.
