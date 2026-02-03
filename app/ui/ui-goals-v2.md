# Peace Protocol UI - Remaining Implementation Guide (v2)

This document focuses on the remaining work for the Peace Protocol UI. For completed phase details and implementation notes, reference `ui-goals.md`.

---

## Quick Reference

| Phase | Status | Dependency |
|-------|--------|------------|
| Phase 5: Blockchain Data Layer | **TODO** | Contract deployment |
| Phase 11.5: WASM Loading Screen | **COMPLETE** | - |
| Phase 12: Accept Bid Flow | **TODO** | Contract deployment |
| E2E Testing | **TODO** | Contract deployment |

**All remaining work is blocked until contracts are deployed to preprod.**

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

**Status**: BLOCKED until contracts are deployed to preprod.

### What to Build

Replace stub data with real blockchain queries.

**Tasks:**
- [ ] Query encryptions from encryption contract
- [ ] Query bids from bidding contract
- [ ] Query reference UTxO data
- [ ] Parse inline datums (CBOR → TypeScript types)
- [ ] Implement caching (optional, recommended)

### When Contracts Deploy

1. **Update Backend Environment:**
   ```bash
   # be/.env
   USE_STUBS=false
   ENCRYPTION_CONTRACT_ADDRESS_PREPROD=addr_test1...
   BIDDING_CONTRACT_ADDRESS_PREPROD=addr_test1...
   ENCRYPTION_POLICY_ID_PREPROD=...
   BIDDING_POLICY_ID_PREPROD=...
   ```

2. **Koios Query Pattern** (in `be/src/services/koios.ts`):
   ```typescript
   // Existing client methods:
   // - getAddressUtxos(address) - Get UTxOs at contract address
   // - getAssetUtxos(policyId, assetName?) - Get UTxOs by asset
   // - getTxInfo(txHash) - Get transaction details
   // - getTip() - Get current tip
   // - getProtocolParams() - Get protocol parameters
   ```

3. **Parse Inline Datums:**
   ```typescript
   // Koios returns inline_datum field with CBOR bytes
   function parseEncryptionDatum(inlineDatum: { bytes: string }): EncryptionDatum {
     // Decode CBOR bytes to Plutus data structure
     // Map constructor indices to TS types
     // See contracts/lib/types/*.ak for constructor ordering
   }
   ```

4. **Constructor Index Mapping** (from Aiken types):
   - `Status::Open` = constructor 0
   - `Status::Pending` = constructor 1
   - Field order matches `contracts/lib/types/encryption.ak`

5. **Files to Create/Modify:**
   - `be/src/services/parsers.ts` - Datum parsing functions
   - `be/src/services/encryptions.ts` - Encryption business logic
   - `be/src/services/bids.ts` - Bid business logic
   - Update routes to call service functions when `USE_STUBS=false`

6. **CBOR Parsing Library:**
   Use `cbor-x` (already a dependency) for decoding Plutus datums:
   ```typescript
   import { decode } from 'cbor-x'

   // Koios returns inline_datum as hex string
   function parseDatum(hexBytes: string): PlutusData {
     const buffer = Buffer.from(hexBytes, 'hex')
     return decode(buffer)
   }
   ```

7. **Example Koios UTxO Response:**
   ```json
   {
     "tx_hash": "abc123...",
     "tx_index": 0,
     "value": "5000000",
     "inline_datum": {
       "bytes": "d8799f...cbor_hex..."
     },
     "asset_list": [
       { "policy_id": "abc...", "asset_name": "00token..." }
     ]
   }
   ```

8. **Plutus Data Constructor Format:**
   After CBOR decode, Plutus constructors appear as:
   ```typescript
   // Constructor 0 with fields
   { tag: 121, value: [field1, field2, ...] }

   // Constructor 1 with fields
   { tag: 122, value: [field1, field2, ...] }

   // Bytes
   Buffer.from(...)

   // Integer
   BigInt or number
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

**Status**: BLOCKED until contracts are deployed. UI can be built with stub transactions.

**Prerequisites**: Phase 11.5 WASM Loading Screen must be complete (WASM pre-loaded).

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
- [ ] Build and submit SNARK tx (07a_createSnarkTx.sh pattern)
- [ ] Wait for confirmation
- [ ] Build and submit re-encryption tx (07b_createReEncryptionTx.sh pattern)
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
VITE_USE_STUBS=true              # Set false when contracts deploy
VITE_API_URL=http://localhost:3001
VITE_SNARK_CDN_URL=/snark        # Or CDN URL in production
VITE_BLOCKFROST_PROJECT_ID_PREPROD=preprodXXXXX
```

### Backend (`be/.env`)
```bash
USE_STUBS=true                   # Set false when contracts deploy
PORT=3001

# Contract addresses (fill after deployment)
ENCRYPTION_CONTRACT_ADDRESS_PREPROD=
BIDDING_CONTRACT_ADDRESS_PREPROD=
ENCRYPTION_POLICY_ID_PREPROD=
BIDDING_POLICY_ID_PREPROD=
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

## Reference: Shell Script Transaction Patterns

For detailed transaction structure, reference these shell scripts:

| Script | Purpose | Key Pattern |
|--------|---------|-------------|
| `commands/03_createEncryptionTx.sh` | Create listing | Mint + send to contract with datum |
| `commands/04a_removeEncryptionTx.sh` | Remove listing | Burn token, return ADA |
| `commands/04b_cancelEncryptionTx.sh` | Cancel pending | Reset status to Open |
| `commands/05_createBidTx.sh` | Place bid | Mint bid token + send to contract |
| `commands/06_removeBidTx.sh` | Cancel bid | Burn bid token, return ADA |
| `commands/07a_createSnarkTx.sh` | SNARK proof tx | **Stake withdrawal pattern** for Groth16 verification |
| `commands/07b_createReEncryptionTx.sh` | Complete sale | Burn bid, update datum, pay seller |

**Important:** The SNARK tx uses a stake withdrawal for on-chain Groth16 verification. This is an unusual pattern - see `07a_createSnarkTx.sh` for exact structure. MeshJS may require low-level APIs.
