# PEACE Protocol Architecture

## Validator Interaction Map

```
                         ┌──────────────────┐
                         │     genesis       │
                         │   (mint only)     │
                         └────────┬─────────┘
                                  │ mints reference token
                                  v
                         ┌──────────────────┐
                         │    reference      │
                         │  (holds VK +      │
                         │   script hashes)  │
                         └────────┬─────────┘
                                  │ reference input
                    ┌─────────────┼─────────────┐
                    v             v              v
           ┌──────────────┐ ┌──────────┐ ┌──────────────┐
           │  encryption   │ │  groth   │ │   bidding    │
           │  (mint/spend) │ │(withdraw)│ │ (mint/spend) │
           └──────────────┘ └──────────┘ └──────────────┘
                    │              │              │
                    └──────────────┴──────────────┘
                         re-encryption tx
                      consumes all three
```

All validators except genesis are parameterized with `genesis_pid` and `genesis_tkn`, which identify the reference token. The reference UTxO is consumed as a **reference input** (read-only) by encryption, bidding, and groth validators to discover each other's script hashes and the SNARK verification key.

## On-Chain Data Model

### ReferenceDatum

Stored at the reference contract address. Bundles all script hashes and the Groth16 verification key.

```
ReferenceDatum {
  reference  : ScriptHash,           -- reference contract's own hash
  encryption : ScriptHash,           -- encryption contract hash
  bid        : ScriptHash,           -- bidding contract hash
  groth      : ScriptHash,           -- groth witness contract hash
  snark_vk   : SnarkVerificationKey  -- Groth16 VK (see below)
}
```

**SnarkVerificationKey:**

```
SnarkVerificationKey {
  nPublic        : Int,               -- number of public inputs
  vkAlpha        : ByteArray,         -- G1 compressed
  vkBeta         : ByteArray,         -- G2 compressed
  vkGamma        : ByteArray,         -- G2 compressed
  vkDelta        : ByteArray,         -- G2 compressed
  vkIC           : List<ByteArray>,   -- G1 compressed (len = nPublic + nCommitments)
  commitmentKeys : List<CommitmentKey>
}
```

### EncryptionDatum

Attached to each encryption UTxO. Represents an encrypted asset with its re-encryption state.

```
EncryptionDatum {
  owner_vkh  : VerificationKeyHash,           -- current owner's payment VKH
  owner_g1   : Register,                      -- BLS12-381 key pair (generator, public_value)
  token      : AssetName,                     -- unique NFT identifier (derived from first input)
  half_level : HalfEncryptionLevel,           -- current re-encryption level
  full_level : Option<FullEncryptionLevel>,   -- previous level (populated after re-encrypt)
  capsule    : Capsule { nonce, aad, ct },    -- AES-256-GCM ciphertext
  status     : Open | Pending(proof, public, ttl)
}
```

**Register** — a BLS12-381 G1 key pair:

```
Register {
  generator    : ByteArray,  -- must be the BLS12-381 G1 generator
  public_value : ByteArray,  -- G1 compressed, must not be identity or generator
}
```

**HalfEncryptionLevel** — minimal data for on-chain level verification:

```
HalfEncryptionLevel {
  r1b    : ByteArray,  -- G1 compressed (R1)
  r2_g1b : ByteArray,  -- G1 compressed (R2 on G1)
  r4b    : ByteArray,  -- G2 compressed (R4: level proof)
}
```

**FullEncryptionLevel** — stored after re-encryption (previous level data):

```
FullEncryptionLevel {
  r1b    : ByteArray,  -- G1 compressed
  r2_g1b : ByteArray,  -- G1 compressed
  r2_g2b : ByteArray,  -- G2 compressed (R5 witness)
  r4b    : ByteArray,  -- G2 compressed
}
```

### BidDatum

Attached to each bid UTxO. Represents a buyer's offer to acquire decryption rights.

```
BidDatum {
  owner_vkh : VerificationKeyHash,  -- bidder's payment VKH
  owner_g1  : Register,             -- bidder's BLS12-381 key pair
  pointer   : AssetName,            -- bid NFT identifier
  token     : AssetName,            -- encryption token being bid on
}
```

## Encryption UTxO State Machine

```
                   ┌───────────────────────┐
                   │                       │
                   v                       │
  [EntryEncryptionMint]                    │
         │                                 │
         v                                 │
   ┌───────────┐    UseSnark    ┌────────────────┐
   │           │ ─────────────> │                │
   │   Open    │                │    Pending     │
   │           │ <───────────── │  (proof, pub,  │
   └───────────┘ CancelEncrypt  │    ttl)        │
         │                      └───────┬────────┘
         │                              │
         │                              │ UseEncryption
         │                              │ (consumes bid)
         │                              │
         │                              v
         │                    ┌───────────────┐
         │                    │     Open      │
         │                    │  (new owner)  │
         │                    └───────────────┘
         │
         │ RemoveEncryption
         v
  [LeaveEncryptionBurn]
```

**State transitions:**

| Action | From | To | Who | What happens |
|--------|------|----|-----|-------------|
| EntryEncryptionMint | (none) | Open | Alice | Mints NFT, creates UTxO with encrypted capsule, proves key ownership |
| UseSnark | Open | Pending | Owner | Submits Groth16 proof via groth witness, sets TTL |
| UseEncryption | Pending | Open (new owner) | Owner | Consumes bid, re-encrypts level to buyer, verifies SNARK commitments |
| CancelEncryption | Pending | Open | Owner or anyone (after TTL) | Reverts to Open if owner signs or TTL has expired |
| RemoveEncryption | Open | (burned) | Owner | Burns NFT, removes UTxO |

## Happy Path Transaction Sequence

### 1. Bootstrap (one-time setup)

**Step 00 — Create Script References:**
Holder wallet stores all compiled validators on-chain as reference scripts.

**Step 01a — Mint Genesis Token:**
Mints a single genesis NFT and sends it to the reference contract with a `ReferenceDatum` containing all script hashes and the SNARK verification key.

**Step 01b — Register Groth Witness:**
Registers the groth validator's stake credential on-chain (required for the withdraw handler).

### 2. Entry Encryption

**Step 03 — Alice Creates Encryption UTxO:**

Validators involved: `encryption.mint` (EntryEncryptionMint)

1. Alice encrypts her data with AES-256-GCM, producing a `Capsule`
2. Transaction mints a unique encryption NFT (name derived from first input)
3. Validator checks:
   - Schnorr proof of BLS12-381 key ownership
   - Binding proof linking key to encryption level
   - First half-level pairing verification
   - Owner VKH must sign
   - Output must be at encryption contract with inline datum

### 3. Bid Placement

**Step 05 — Bob Places a Bid:**

Validators involved: `bidding.mint` (EntryBidMint)

1. Bob creates a bid UTxO targeting Alice's encryption token
2. Transaction mints a unique bid NFT
3. Validator checks:
   - Schnorr proof of Bob's BLS12-381 key ownership
   - Bob's register is valid (generator check, non-identity)
   - Bob's VKH must sign

### 4. Re-encryption (two transactions)

**Step 07a — Alice Submits SNARK Proof (UseSnark):**

Validators involved: `encryption.spend` (UseSnark), `groth.withdraw` (GrothWitnessRedeemer)

1. Alice generates a Groth16 proof off-chain (via gnark)
2. Proof + public inputs are placed in the groth withdraw redeemer
3. Groth validator verifies: `e(A,B) * e(vk_x, -gamma) * e(C, -delta) == e(alpha, beta)`
4. Encryption UTxO transitions from Open to Pending with the proof, public inputs, and a TTL
5. Validity range must be within 1-hour window; TTL = upper_bound + 6 hours

**Step 07b — Alice Re-encrypts to Bob (UseEncryption):**

Validators involved: `encryption.spend` (UseEncryption), `bidding.spend` (UseBid)

1. Alice provides R5 witness, new half-level, and binding proof
2. Encryption validator checks:
   - Limb compression (public inputs match the key transfer)
   - Commitment proof of knowledge (gnark commitment extension)
   - R5 pairing verification (re-encryption key authenticity)
   - New kth half-level pairing verification
   - Correct level addition (old half → full, new half created)
   - Bid owner becomes new encryption owner
   - Capsule unchanged, token unchanged
3. Bob's bid UTxO is consumed (UseBid redeemer)
4. Encryption UTxO returns to Open with Bob as owner

### 5. Decryption

**Step 08 — Bob Decrypts (off-chain only):**

1. Bob fetches the encryption UTxO from the chain
2. Reconstructs the decryption key from the level data using his private key
3. Decrypts the AES-256-GCM capsule to recover the payload
4. Payload format follows `peace-payload.cddl` (locator, optional secret, optional digest)

## Encrypted Payload Format

The AES-256-GCM capsule contains a CBOR-encoded payload defined by `peace-payload.cddl`:

```
peace-payload = {
  0   => bstr,      ; locator  - content address (IPFS CID, Arweave TX ID, URL, or inline)
  ? 1 => bstr,      ; secret   - access/decryption key for off-chain content
  ? 2 => bstr,      ; digest   - integrity hash of the underlying content
  * int => bstr     ; extension fields (3+) for application-specific data
}
```

Integer keys are used for on-chain compactness. Canonical CBOR encoding (RFC 8949) is required for cross-platform consistency.

## Cryptographic Primitives

| Primitive | Curve/Algorithm | Purpose |
|-----------|----------------|---------|
| Proxy Re-encryption | BLS12-381 (Wang-Cao scheme) | Unidirectional, multi-hop transfer of decryption rights |
| Key Ownership | Schnorr sigma protocol (Fiat-Shamir) | Proof of knowledge of BLS12-381 private key |
| Level Binding | Binding proof (Fiat-Shamir) | Links encryption level to owner's key |
| SNARK Verification | Groth16 (gnark with Pedersen commitment) | Proves re-encryption key correctness |
| Symmetric Encryption | AES-256-GCM | Encrypts the actual data payload |
| Hashing | Blake2b-224 | On-chain hashing with domain-separated tags |

### Domain Separation Tags

All Fiat-Shamir heuristics and hash-to-scalar operations use domain tags to prevent cross-protocol attacks:

- Schnorr proofs: `SCHNORR|PROOF|v1|` (`5343484e4f52527c50524f4f467c76317c`)
- Binding proofs: `BINDING|PROOF|v1|` (`42494e44494e477c50524f4f467c76317c`)
- Hash-to-scalar: `HASH|To|Int|v1|` (`484153487c546f7c496e747c76317c`)

### Wang-Cao Constants

The protocol uses four G2 points derived from the Cardano mainnet block 0 hash via hash-to-group:

- `wang_h0` = `hash_to_group(block0_hash, "WANG:h0")`
- `wang_h1` = `hash_to_group(block0_hash, "WANG:h1")`
- `wang_h2` = `hash_to_group(block0_hash, "WANG:h2")`
- `wang_h3` = `hash_to_group(block0_hash, "WANG:h3")`

These are protocol-wide constants. Level-1 verification uses h1, h2, and h3. Level-k verification uses only h1 and h2.
