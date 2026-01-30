# Peace Protocol UI Development Guide

## Overview

A React + Tailwind web application for the Peace Protocol encrypted data marketplace. Users can sell encrypted data and bid on encrypted data using Cardano smart contracts.

**Stack:**
- **Frontend**: React + Tailwind CSS
- **Wallet**: MeshJS v1.8.14 (stable, non-beta)
- **Blockchain Data**: Koios (queries) + Blockfrost (tx building)
- **SNARK Proving**: Go WASM (see `snark/browser-support.md`)
- **Local Dev**: Vite + Node.js backend
- **Target Browser**: Chrome only (best Cardano wallet support)
- **Test Wallet**: Eternl

**Network Strategy:**
- `preprod.website.com` → Preprod network
- `www.website.com` → Mainnet (future)
- Single codebase, network determined by subdomain

---

## Architecture

```
ui/
├── fe/                          # Frontend (React)
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Page components
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # API calls, blockchain interactions
│   │   ├── wasm/                # SNARK WASM integration
│   │   └── utils/               # Helpers
│   ├── public/
│   │   ├── pk.bin               # Proving key (~613 MB)
│   │   ├── ccs.bin              # Constraint system (~85 MB)
│   │   ├── prover.wasm          # SNARK prover (~20 MB)
│   │   └── wasm_exec.js         # Go WASM runtime
│   └── package.json
│
├── be/                          # Backend (Node.js)
│   ├── src/
│   │   ├── routes/              # API routes
│   │   ├── services/            # Business logic
│   │   ├── cardano/             # Koios/Blockfrost clients
│   │   └── crypto/              # Encryption helpers
│   └── package.json
│
└── ui-goals.md                  # This file
```

---

## User Flows

### Seller (Alice) Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Connect    │────▶│  Create     │────▶│  View Bids  │────▶│  Accept Bid │
│  Wallet     │     │  Encryption │     │  on Listing │     │  (SNARK+Re) │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

1. **Create Encryption** (`03_createEncryptionTx.sh`)
   - Enter secret message
   - Set price/terms (stored off-chain or in datum)
   - Sign transaction
   - Mint encryption token → contract

2. **View Bids**
   - Query bidding contract for bids referencing their encryption token
   - Display bidder info, amounts

3. **Accept Bid** (Two-step process)
   - **Step 1: SNARK Tx** (`07a_createSnarkTx.sh`)
     - Generate Groth16 proof in browser (10-30s)
     - Submit proof to put encryption in "pending" state
   - **Step 2: Re-encryption Tx** (`07b_createReEncryptionTx.sh`)
     - Complete ownership transfer
     - Burn bid token
     - Update encryption datum

### Buyer (Bob) Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Connect    │────▶│  Browse     │────▶│  Place Bid  │────▶│  Decrypt    │
│  Wallet     │     │  Listings   │     │             │     │  (if won)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

1. **Browse Listings**
   - Query encryption contract for available encryptions
   - Display metadata, prices, seller info

2. **Place Bid** (`05_createBidTx.sh`)
   - Select encryption to bid on
   - Enter bid amount
   - Sign transaction
   - Mint bid token → bidding contract

3. **Decrypt** (`08_decryptMessage.sh`)
   - After winning bid, query encryption history from Koios
   - Decrypt message locally using private key

### Management Actions

- **Remove Encryption** (`04a_removeEncryptionTx.sh`) - Seller cancels listing
- **Cancel Encryption** (`04b_cancelEncryptionTx.sh`) - Cancel pending
- **Remove Bid** (`06_removeBidTx.sh`) - Buyer cancels bid

---

## Pages

### 1. Landing Page (`/`)

```
┌────────────────────────────────────────────────────────┐
│                    Peace Protocol                       │
│           Encrypted Data Marketplace                    │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │           [Connect Wallet Button]                 │ │
│  │                                                   │ │
│  │   Recommended: Eternl on Chrome                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  Brief explanation of what the protocol does           │
└────────────────────────────────────────────────────────┘
```

**Components:**
- Hero section with protocol name/description
- MeshJS `<CardanoWallet />` component (handles wallet selection)
- Redirect to dashboard on successful connection
- Note: MeshJS will show available wallets; tested with Eternl

### 2. Dashboard (`/dashboard`)

```
┌────────────────────────────────────────────────────────┐
│  [Wallet: addr1...xyz]                    [Disconnect] │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌─────────────────┐  ┌─────────────────┐             │
│  │  My Listings    │  │  My Bids        │             │
│  │  (3 active)     │  │  (2 pending)    │             │
│  └─────────────────┘  └─────────────────┘             │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Tabs: [Marketplace] [My Sales] [My Purchases] │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │  Content based on selected tab                 │   │
│  │                                                 │   │
│  └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

**Tabs:**

#### Marketplace Tab
- Grid/list of available encryptions
- Filter by price, date, seller
- "Place Bid" button on each card

#### My Sales Tab
- List of user's encryptions
- Status: Active, Pending, Completed
- View bids on each listing
- Accept bid button (triggers SNARK flow)
- Remove listing button

#### My Purchases Tab
- List of user's bids
- Status: Pending, Accepted, Rejected
- Decrypt button (for won bids)
- Cancel bid button

### 3. Create Listing Modal/Page

```
┌────────────────────────────────────────────────────────┐
│                   Create New Listing                    │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Secret Message:                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │                                                   │ │
│  │  [Textarea for secret data]                       │ │
│  │                                                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  Price (ADA):  [___________]                          │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  [Cancel]                    [Create Listing]    │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 4. SNARK Proving Modal

```
┌────────────────────────────────────────────────────────┐
│                  Generating Proof                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │                                                   │ │
│  │              [Animated Spinner]                   │ │
│  │                                                   │ │
│  │         Generating zero-knowledge proof...        │ │
│  │              This may take 10-30 seconds          │ │
│  │                                                   │ │
│  │  ████████████████████░░░░░░░░░░  65%             │ │
│  │                                                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  [Optional: Simple mini-game or educational content]   │
│                                                        │
│  ⚠️ Do not close this tab                             │
└────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Project Setup

- [ ] Initialize React project with Vite
- [ ] Configure Tailwind CSS
- [ ] Set up folder structure
- [ ] Install MeshJS (`@meshsdk/core`, `@meshsdk/react`)
- [ ] Create basic routing (react-router-dom)
- [ ] Set up environment variables

```bash
# fe/
npm create vite@latest . -- --template react-ts
npm install tailwindcss postcss autoprefixer
npm install @meshsdk/core@1.8.14 @meshsdk/react@1.8.14
npm install react-router-dom
npx tailwindcss init -p
```

**Important**: Use MeshJS v1.8.14 (stable). Avoid beta versions.

### Phase 2: Wallet Integration

- [ ] Use MeshJS `<CardanoWallet />` component (don't build custom)
- [ ] Handle wallet state (connected/disconnected)
- [ ] Display connected address
- [ ] Store wallet context via MeshJS provider
- [ ] Implement disconnect functionality
- [ ] Test with Eternl wallet

```typescript
// Use MeshJS built-in wallet component
import { MeshProvider } from '@meshsdk/react';
import { CardanoWallet, useWallet } from '@meshsdk/react';

// Wrap app in provider
function App() {
  return (
    <MeshProvider>
      <YourApp />
    </MeshProvider>
  );
}

// Use the built-in wallet component
function WalletSection() {
  const { connected, wallet, disconnect } = useWallet();

  return (
    <div>
      <CardanoWallet />
      {connected && (
        <button onClick={disconnect}>Disconnect</button>
      )}
    </div>
  );
}
```

**Note**: MeshJS wallet component handles wallet selection UI. No need to build custom wallet picker.

### Phase 3: Landing Page

- [ ] Design hero section
- [ ] Add wallet connect component
- [ ] Add protocol description
- [ ] Implement redirect to dashboard on connect
- [ ] Mobile responsive layout

### Phase 4: Backend Setup

- [ ] Initialize Node.js/Express project
- [ ] Configure Koios client
- [ ] Configure Blockfrost client
- [ ] Create API routes structure
- [ ] Add CORS configuration

```bash
# be/
npm init -y
npm install express cors dotenv
npm install @koios-apis/koios-rest
npm install @blockfrost/blockfrost-js
```

### Phase 5: Blockchain Data Layer

- [ ] Query encryptions from encryption contract
- [ ] Query bids from bidding contract
- [ ] Query reference UTxO data
- [ ] Parse inline datums
- [ ] Implement caching (optional)

```typescript
// Example Koios query
async function getEncryptions() {
  const response = await koios.addressAssets(encryptionContractAddress);
  // Parse and return encryptions
}
```

### Phase 6: Dashboard - Marketplace Tab

- [ ] Create encryption card component
- [ ] Implement grid/list view
- [ ] Add filtering/sorting
- [ ] Connect to backend API
- [ ] Add loading states
- [ ] Add empty states

### Phase 7: Dashboard - My Sales Tab

- [ ] List user's encryptions
- [ ] Show bids on each encryption
- [ ] Add remove listing functionality
- [ ] Add "View Bids" expand/modal
- [ ] Implement status indicators

### Phase 8: Dashboard - My Purchases Tab

- [ ] List user's bids
- [ ] Show bid status
- [ ] Add cancel bid functionality
- [ ] Add decrypt button (for won bids)

### Phase 9: Create Listing Flow

- [ ] Create listing form component
- [ ] Port Python crypto logic to JS (encryption, schnorr proofs, etc.)
- [ ] Build transaction with MeshJS
- [ ] Sign and submit transaction
- [ ] Show success/error feedback
- [ ] Refresh listings

**Porting Notes:**

This phase involves porting two things:

1. **Python crypto code** (`src/commands/`) → JS
   - Encryption logic, schnorr proofs, key derivation
   - Use `@noble/curves` for BLS12-381 and secp256k1
   - Port or rewrite the capsule/register generation

2. **cardano-cli tx building** → MeshJS
   - Shell scripts in `commands/` show exact tx structure
   - MeshJS and cardano-cli share similar concepts but APIs differ
   - Expect manual intervention for: inline datums, redeemers, reference scripts
   - Test incrementally: build tx → inspect CBOR → compare to working cli tx

```typescript
// Example MeshJS transaction building
import { Transaction } from '@meshsdk/core';

const tx = new Transaction({ initiator: wallet });
tx.mintAsset(encryptionScript, asset, redeemer);
tx.sendAssets(encryptionContractAddress, assets, { datum });
const unsignedTx = await tx.build();
const signedTx = await wallet.signTx(unsignedTx);
const txHash = await wallet.submitTx(signedTx);
```

**Debugging tip:** If MeshJS tx fails but cli works, serialize both to CBOR and diff them.

### Phase 10: Place Bid Flow

- [ ] Create bid form/modal
- [ ] Build bid transaction
- [ ] Sign and submit
- [ ] Show success/error feedback
- [ ] Refresh bids

### Phase 11: SNARK Integration

**This is the most complex phase. See `snark/browser-support.md` for details.**

- [ ] Set up WASM loading infrastructure
- [ ] Implement IndexedDB caching for pk.bin/ccs.bin
- [ ] Create download progress UI
- [ ] Create Web Worker for SNARK proving
- [ ] Implement proving interface
- [ ] Build SNARK transaction
- [ ] Handle proving errors gracefully

```typescript
// Web Worker setup
const worker = new Worker(new URL('./snarkWorker.ts', import.meta.url));

worker.postMessage({
  type: 'prove',
  secretA: '...',
  secretR: '...',
  publicInputs: { v: '...', w0: '...', w1: '...' }
});

worker.onmessage = (e) => {
  if (e.data.type === 'proof') {
    // Continue with transaction
  }
};
```

### Phase 12: Accept Bid Flow (SNARK + Re-encryption)

- [ ] Trigger SNARK proving modal
- [ ] Generate proof in Web Worker
- [ ] Build and submit SNARK tx
- [ ] Wait for confirmation
- [ ] Build and submit re-encryption tx
- [ ] Update UI state

### Phase 13: Decrypt Flow

- [ ] Query encryption history from Koios
- [ ] Implement recursive decryption (port from Python)
- [ ] Display decrypted message
- [ ] Handle decryption errors

### Phase 14: Polish & Testing

- [ ] Error handling throughout (toast notifications)
- [ ] Loading states throughout
- [ ] Success modals with CardanoScan links
- [ ] Unit tests for utils/services
- [ ] Manual E2E testing on Chrome with Eternl
- [ ] Mobile not required (desktop-focused for SNARK proving)

### Phase 15: Local Development Setup

- [ ] Create docker-compose for local testing
- [ ] Document environment setup
- [ ] Add seed scripts for test data
- [ ] Create README with setup instructions

---

## MeshJS Transaction Patterns

**Important Notes:**
- Always reference MeshJS documentation: https://meshjs.dev/apis/transaction
- Transaction building for Plutus V3 contracts can be complex
- The examples below are starting points; manual adjustments will likely be needed
- Test transaction building manually before integrating into UI
- MeshJS handles simulation automatically - `tx.build()` returns ready-to-sign CBOR

### Mint Token to Contract

```typescript
import { Transaction, resolveScriptHash } from '@meshsdk/core';

const policyId = resolveScriptHash(encryptionScript);
const tokenName = computeTokenName(utxo);

const tx = new Transaction({ initiator: wallet })
  .mintAsset(encryptionScript, {
    assetName: tokenName,
    assetQuantity: '1',
    recipient: encryptionContractAddress,
    metadata: {},
  })
  .setTxInputs([...userUtxos])
  .setCollateral([collateralUtxo])
  .setRequiredSigners([userPkh, collateralPkh]);

// Add inline datum
tx.txBuilder.tx_builder.add_output(
  createOutputWithDatum(encryptionContractAddress, lovelace, datum)
);
```

### Spend from Contract + Mint

```typescript
const tx = new Transaction({ initiator: wallet })
  .redeemValue({
    value: encryptionUtxo,
    script: encryptionScript,
    redeemer: { data: spendRedeemer },
  })
  .mintAsset(biddingScript, { /* burn asset */ }, burnRedeemer)
  .sendAssets(encryptionContractAddress, assets, { inline: true, datum });
```

### Read-Only Reference

```typescript
const tx = new Transaction({ initiator: wallet });
tx.txBuilder.tx_builder.add_reference_input(referenceUtxo);
```

---

## API Endpoints (Backend)

### Encryptions

```
GET  /api/encryptions              # List all encryptions
GET  /api/encryptions/:tokenName   # Get specific encryption
GET  /api/encryptions/user/:pkh    # Get user's encryptions
```

### Bids

```
GET  /api/bids                     # List all bids
GET  /api/bids/:tokenName          # Get specific bid
GET  /api/bids/user/:pkh           # Get user's bids
GET  /api/bids/encryption/:tokenName  # Get bids for encryption
```

### Protocol Data

```
GET  /api/protocol/reference       # Get reference UTxO data
GET  /api/protocol/scripts         # Get script hashes/addresses
GET  /api/protocol/params          # Get protocol parameters
```

### Transactions (optional helpers)

```
POST /api/tx/submit                # Submit signed transaction (if not using wallet.submitTx)
```

**Note**: Transaction simulation is handled automatically by MeshJS during `tx.build()`. No separate simulation endpoint needed.

---

## Environment Variables

### Network Detection (Subdomain-based)

```typescript
// Detect network from subdomain
function getNetwork(): 'preprod' | 'mainnet' {
  const hostname = window.location.hostname;
  if (hostname.startsWith('preprod.')) return 'preprod';
  return 'mainnet';
}

// Get correct explorer URL
function getCardanoScanUrl(txHash: string): string {
  const network = getNetwork();
  const base = network === 'preprod'
    ? 'https://preprod.cardanoscan.io'
    : 'https://cardanoscan.io';
  return `${base}/transaction/${txHash}`;
}
```

### Frontend (.env)

```bash
# Local dev defaults to preprod
VITE_API_URL=http://localhost:3001
VITE_BLOCKFROST_PROJECT_ID_PREPROD=preprodXXXXX
VITE_BLOCKFROST_PROJECT_ID_MAINNET=mainnetXXXXX
```

### Backend (.env)

```bash
PORT=3001

# Preprod config
KOIOS_URL_PREPROD=https://preprod.koios.rest/api/v1
BLOCKFROST_PROJECT_ID_PREPROD=preprodXXXXX

# Mainnet config (future)
KOIOS_URL_MAINNET=https://api.koios.rest/api/v1
BLOCKFROST_PROJECT_ID_MAINNET=mainnetXXXXX

# Contract addresses/hashes (preprod)
ENCRYPTION_CONTRACT_ADDRESS_PREPROD=addr_test1...
BIDDING_CONTRACT_ADDRESS_PREPROD=addr_test1...
REFERENCE_CONTRACT_ADDRESS_PREPROD=addr_test1...
ENCRYPTION_POLICY_ID_PREPROD=...
BIDDING_POLICY_ID_PREPROD=...
GENESIS_POLICY_ID_PREPROD=...

# Contract addresses/hashes (mainnet - future)
# ENCRYPTION_CONTRACT_ADDRESS_MAINNET=addr1...
# etc.
```

---

## Database Considerations

**Option A: No Database (Pure Blockchain)**

Pros:
- Simpler architecture
- No sync issues
- True decentralization

Cons:
- Slower queries (must hit Koios each time)
- No off-chain metadata storage
- Rate limits on Koios

**Option B: Lightweight Cache (Redis/SQLite)**

Pros:
- Faster queries
- Can store additional metadata (descriptions, images)
- Better UX

Cons:
- Need to keep in sync with chain
- Additional infrastructure

**Recommendation**: Start with Option A (no database). Add caching later if performance becomes an issue. Koios is quite fast for preprod/mainnet queries.

---

## SNARK Asset Delivery

The SNARK proving files are large (~720 MB total). Strategy:

1. **First Visit**
   - Detect if files are cached in IndexedDB
   - If not, show download prompt with size warning
   - Download with progress indicator
   - Store in IndexedDB

2. **Return Visit**
   - Load from IndexedDB (fast)
   - Verify integrity (hash check)

3. **Proving**
   - Run in Web Worker (non-blocking)
   - Show progress/animation
   - Return proof to main thread

See `snark/browser-support.md` for full technical details.

---

## Testing Strategy

### Philosophy

- **Utils/Services**: Must have unit tests (Jest/Vitest)
- **FE Components**: Manual testing preferred over headless testing
- **Transaction Building**: Manual testing required (complex Plutus interactions)
- **E2E**: Manual testing with Eternl wallet on Chrome

Headless FE testing is time-consuming for diminishing returns. Focus on shipping working code and testing manually.

### Automated Tests (Required)

- [ ] Utility functions (parsing, formatting, conversions)
- [ ] Service functions (API clients, data transformations)
- [ ] Crypto helpers (encryption/decryption logic)
- [ ] WASM integration helpers

### Manual Testing - Wallet (Chrome + Eternl)

- [ ] Connect with Eternl
- [ ] Disconnect works
- [ ] Reconnect on page refresh
- [ ] Address displays correctly

### Manual Testing - Transactions

- [ ] Create encryption succeeds
- [ ] Remove encryption succeeds
- [ ] Create bid succeeds
- [ ] Remove bid succeeds
- [ ] SNARK tx succeeds
- [ ] Re-encryption tx succeeds
- [ ] Decrypt works

### Manual Testing - Edge Cases

- [ ] Insufficient funds error displays toast
- [ ] Transaction failure displays toast with error
- [ ] Network errors handled gracefully
- [ ] Wallet rejection handled
- [ ] SNARK proving timeout handled
- [ ] Invalid bid (wrong encryption) prevented

### Browser

- [ ] Chrome (primary and only target)

**Note**: Chrome is the only browser with reliable Cardano wallet extensions. Other browsers are not supported.

---

## Design Notes

### Color Palette (Suggestion)

```css
/* Dark theme - modern, clean */
--bg-primary: #0f0f0f;
--bg-secondary: #1a1a1a;
--bg-card: #242424;
--text-primary: #ffffff;
--text-secondary: #a0a0a0;
--accent: #6366f1;        /* Indigo */
--accent-hover: #818cf8;
--success: #22c55e;
--warning: #f59e0b;
--error: #ef4444;
```

### Typography

- Headers: Inter or similar sans-serif
- Body: System font stack for performance
- Monospace: For addresses, hashes

### Components to Build

- Button (primary, secondary, danger)
- Card
- Modal
- Input/Textarea
- Select
- Table
- Badge/Status indicator
- Loading spinner
- Progress bar
- Tabs
- Wallet address display (truncated)

### Key UI Patterns

#### Error Toast (Bottom of Screen)

```
┌─────────────────────────────────────────────────────┐
│  ❌ Transaction failed: Insufficient funds          │
│                                          [Dismiss]  │
└─────────────────────────────────────────────────────┘
```

- Position: Fixed bottom center
- Auto-dismiss after 5-10 seconds
- Manual dismiss button
- Red/error styling for errors
- Stack multiple toasts if needed

#### Success Modal (with CardanoScan Link)

```
┌────────────────────────────────────────────────────────┐
│                    ✓ Success!                          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Your transaction has been submitted.                  │
│                                                        │
│  Transaction ID:                                       │
│  abc123...def456                                       │
│                                                        │
│  [View on CardanoScan ↗]                              │
│                                                        │
│                      [Close]                           │
└────────────────────────────────────────────────────────┘
```

- Link format: `https://preprod.cardanoscan.io/transaction/{txHash}`
- Use `https://cardanoscan.io/transaction/{txHash}` for mainnet
- Opens in new tab

#### Wallet Component

Use MeshJS's built-in `<CardanoWallet />` component. Don't build custom wallet UI.

---

## Next Steps

1. **Phase 1-3**: Get landing page with wallet connect working
2. **Phase 4-6**: Backend + basic marketplace display
3. **Phase 9-10**: Create listing and place bid flows
4. **Phase 11-12**: SNARK integration (the big one)
5. **Phase 13-15**: Decrypt, polish, testing

Start with Phase 1. Each phase builds on the previous.

---

## Important Notes

### Transaction Building

Transaction building with MeshJS for Plutus V3 contracts requires careful attention:

1. **Reference MeshJS docs**: https://meshjs.dev/apis/transaction
2. **Manual testing required**: Build txs incrementally, test each step
3. **Expect iteration**: First attempts rarely work; debugging is normal
4. **Use Blockfrost simulation**: MeshJS uses this automatically
5. **Check redeemer/datum formats**: Must match on-chain expectations exactly

The shell scripts in `commands/` show the exact tx structure needed. Port these patterns to MeshJS, but expect to adjust for API differences.

### Why Chrome Only

- Eternl, Nami, Lace work best on Chrome
- WASM + 2GB memory works reliably on Chrome
- Other browsers have wallet compatibility issues
- Simplifies testing and support

---

## Critical Implementation Details

### Seller Secret Storage

When a seller creates an encryption, secrets `a` and `r` are generated. These MUST be stored locally until the seller accepts a bid (could be days/weeks later).

**Strategy:**
- Store encrypted in IndexedDB, keyed by encryption token name
- Encrypt with a key derived from wallet signature (user must sign to access)
- If secrets are lost, the seller cannot complete any sales for that listing
- Consider backup/export functionality

**Warning to users:** "Your encryption secrets are stored in this browser. If you clear browser data or use a different device, you will not be able to complete sales."

### Groth Withdrawal (SNARK Tx)

The SNARK transaction uses a **stake withdrawal** for on-chain Groth16 verification. This is an unusual pattern:

```
--withdrawal ${groth_address}+${rewardBalance}
--withdrawal-tx-in-reference="${groth_ref_utxo}#1"
--withdrawal-plutus-script-v3
--withdrawal-reference-tx-in-redeemer-file ../data/groth/witness-redeemer.json
```

MeshJS may require manual tx building for this. Verify support or use lower-level APIs.

### Token Name Computation

Token names are derived from the first UTxO used in the transaction:

```typescript
// Port from shell script logic
function computeTokenName(utxo: { txHash: string; outputIndex: number }): string {
  // CBOR encode the output index
  const txIdxCbor = cborEncode(utxo.outputIndex);
  // Concatenate and take first 64 hex chars
  const fullName = txIdxCbor + utxo.txHash;
  return fullName.slice(0, 64);
}
```

Need a CBOR library (e.g., `cbor-x` or `@meshsdk/core` utilities).

### Validity Intervals (SNARK Tx)

The SNARK transaction requires time bounds:

```typescript
// Calculate slot numbers from timestamps
const lowerBound = await getSlotFromTimestamp(Date.now());
const upperBound = await getSlotFromTimestamp(Date.now() + 5 * 60 * 1000); // +5 minutes

// TTL for pending state (stored in datum)
const pendingTtl = Date.now() + 20 * 60 * 1000; // +20 minutes
```

Use Koios or Blockfrost to convert timestamps to slots.

### Pending State TTL

When a seller submits the SNARK tx, the encryption enters "pending" state with a TTL.

- Show countdown timer in UI: "Complete sale within X minutes"
- If TTL expires, seller must use cancel endpoint to reset
- Buyer should see "Sale pending" status

### SNARK Download Timing

**Recommendation:** Download SNARK files just-in-time (when seller first tries to accept a bid).

Flow:
1. Seller clicks "Accept Bid"
2. Check IndexedDB for cached files
3. If not cached: show download modal with progress (~480 MB)
4. Once downloaded, proceed to proving
5. Cache for future use

Don't download on first visit - most users are buyers who don't need SNARK files.

### Data Refresh Strategy

- **Marketplace listings**: Fetch on page load, manual refresh button
- **My Sales/Purchases**: Fetch on tab switch, manual refresh button
- **After transaction**: Auto-refresh relevant data after tx confirmation
- **No WebSockets**: Keep it simple with manual/on-demand refresh
- Consider 30-60 second polling on active tabs (optional)

### Reference Script UTxOs

Transactions use reference scripts stored on-chain. These should be in backend config:

```typescript
// Protocol config endpoint should return:
{
  referenceScripts: {
    encryption: { txHash: "...", outputIndex: 1 },
    bidding: { txHash: "...", outputIndex: 1 },
    groth: { txHash: "...", outputIndex: 1 }
  },
  genesisToken: {
    policyId: "...",
    tokenName: "..."
  }
}
```

### Mobile Detection

Detect mobile devices and show warning:

```typescript
function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// On dashboard load
if (isMobile()) {
  showWarning("This app requires a desktop browser for full functionality. SNARK proving needs 2GB+ RAM.");
}
```

### Bid Amount and Suggested Price

**On-chain:** Bid amount is simply the lovelace attached to the bid UTxO.

**Off-chain (UI only):**
- Seller can set a "suggested price" when creating listing
- Stored in backend/displayed in UI, NOT on-chain
- Buyers see suggested price but can bid any amount
- Seller decides which bid to accept

```typescript
// Create listing form
interface ListingForm {
  secretMessage: string;
  suggestedPrice?: number;  // ADA, optional, UI-only
}

// Display in marketplace
interface ListingDisplay {
  tokenName: string;
  seller: string;
  suggestedPrice?: number;  // From backend, not chain
  // ... other fields from datum
}
```
