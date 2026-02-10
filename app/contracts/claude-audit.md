# Peace Protocol Smart Contract Security Audit

**Date:** 2026-02-09
**Auditor:** Claude (Anthropic)
**Scope:** All validators and library code in `app/contracts/` except `validators/reference.ak` (excluded per client request — known test stub)
**Aiken Version:** v1.1.21 | Plutus V3 | stdlib v3.0.0

---

## Executive Summary

The Peace Protocol implements a proxy re-encryption system on Cardano using BLS12-381 cryptography, Groth16 SNARK verification, and a Wang-Cao unidirectional re-encryption scheme. The protocol manages encrypted data that can be transferred between owners via a bidding mechanism, with SNARK proofs ensuring correct state transitions.

The contracts demonstrate strong cryptographic design with bidirectional cross-validator authorization, domain-separated Fiat-Shamir heuristics, and strict NFT-based identity. However, several patterns allow unconditional spending of UTxOs under specific conditions, and value preservation is not enforced on continuing UTxOs. These are detailed below.

The cryptographic proof mechanism — composing Schnorr sigma protocols, binding proofs, Wang-Cao pairing checks, R5 pairing relations, Groth16 SNARK verification, and limb compression — is sound under standard assumptions (ECDLP, CDH, bilinear Diffie-Hellman, KEA). The proof chain correctly enforces that (1) Bob's public key is used in the new encryption level, (2) Alice's secret is used in the delegation, and (3) the SNARK witness is authentically derived from the pairing secret. See the "Cryptographic Proof Mechanism Security" section for the full analysis.

**Finding Summary:**

| Severity | Count | Resolution |
|----------|-------|------------|
| HIGH     | 3     | All acknowledged as intentional design (hyperstructure cleanup + penalty mechanism) |
| MEDIUM   | 2     | TTL intentional; public input length warrants a check |
| LOW      | 2     | Both intentional / accepted |
| CRYPTO   | 9     | CG-1 through CG-9: Protocol-level cryptographic proof analysis |
| INFO     | 9     | Positive security properties |

---

## Contracts Audited

| Contract | File | Purposes |
|----------|------|----------|
| Encryption | `validators/encryption.ak` | mint, spend |
| Bidding | `validators/bidding.ak` | mint, spend |
| Genesis | `validators/genesis.ak` | mint |
| Groth Witness | `validators/groth.ak` | withdraw, publish |
| Library | `lib/**/*.ak` | Types, search, crypto, utilities |

---

## Findings

### HIGH-1: Unconditional Spend for Missing or Non-Conforming Datums

**Location:** `validators/encryption.ak:361-367`, `validators/bidding.ak:183-188`

**Description:** Both the encryption and bidding spend validators return `True` unconditionally when the datum is `None` or fails to parse as the expected type (`EncryptionDatum` / `BidDatum`).

```aiken
// encryption.ak:361-367
} else {
  // bad datum
  True
}
// no datum
None -> True
```

```aiken
// bidding.ak:183-188
} else {
  // bad datum
  True
}
// no datum
None -> True
```

**Impact:** Any UTxO sitting at these script addresses with an incorrect, missing, or malformed datum can be spent by anyone without authorization. If a user or dApp accidentally sends ADA to the encryption or bidding script address without the correct inline datum, those funds are immediately claimable by any third party.

**Mitigating Factors:**
- The protocol's own mint handlers always produce UTxOs with correctly typed inline datums
- This pattern effectively provides "junk UTxO cleanup" — preventing permanent locking of accidentally-sent funds
- Protocol-created UTxOs with valid datums are NOT affected (they fall through to the guarded branches)

**Recommendation:** If this is intentional (cleanup mechanism), document it explicitly in code comments. If not, change the fallback to `False` or `fail` to prevent unauthorized spending of misaddressed funds.

**Developer Response:** Intentional. The contract is designed as a hyperstructure. The always-True fallback is the preferred approach over forcing failure or centralization. Losing ADA sent to a random script address is an acceptable punishment for misuse. No code change needed.

---

### HIGH-2: Unconditional Spend When NFT Token Is Absent

**Location:** `validators/encryption.ak:150-169`, `validators/bidding.ak:102-124`

**Description:** In the `RemoveEncryption` and `RemoveBid` redeemer branches, when the input UTxO does NOT hold the expected NFT token, the validator returns `True` without any further checks:

```aiken
// encryption.ak:150-169
RemoveEncryption -> {
  let is_holding_token: Bool =
    assets.has_nft(this_input.output.value, this_script, token)
  if is_holding_token {
    // ... actual validation with owner signature and burn check
  } else {
    // invalid start
    True
  }
}
```

```aiken
// bidding.ak:102-124 — identical pattern
```

**Impact:** Any UTxO at the encryption/bidding script address that has a valid datum type but does NOT hold the corresponding NFT can be spent by anyone using the `RemoveEncryption` / `RemoveBid` redeemer. Combined with HIGH-1, this means **every non-protocol UTxO** at these addresses (wrong datum OR right datum without NFT) is freely spendable.

**Mitigating Factors:**
- Protocol UTxOs are always created with the correct NFT via the mint handler
- An attacker cannot remove a legitimate protocol UTxO through this path (it holds the NFT, so the guarded branch executes)

**Recommendation:** Same as HIGH-1. If intentional, document the design choice. If not, return `False` or `fail` for the `else` branch.

**Developer Response:** Intentional. When the correct datum structure exists but there is no way to verify the owner is real, defaulting to True is preferred over guessing validity. Same hyperstructure philosophy as HIGH-1.

---

### HIGH-3: No Value Preservation on Continuing Encryption UTxOs

**Location:** `validators/encryption.ak` — all spend paths (`UseEncryption`, `UseSnark`, `CancelEncryption`)

**Description:** When an encryption UTxO transitions state (e.g., Open -> Pending, Pending -> Open with new owner), the validator verifies the output datum, script address, reference script absence, and NFT presence — but does **not** verify that the output ADA value equals the input ADA value.

**Impact by path:**

| Path | Who can trigger | Value extraction risk |
|------|----------------|---------------------|
| `UseEncryption` | Current owner (must sign) | Owner drains own ADA — **low concern** |
| `UseSnark` | Current owner (must sign) | Owner drains own ADA — **low concern** |
| `CancelEncryption` (owner) | Owner signs | Owner drains own ADA — **low concern** |
| `CancelEncryption` (expired TTL) | **Anyone** | **Anyone can drain ADA** beyond minUTxO |

The most concerning case is TTL-expired cancellation: after the Pending TTL expires, any third party can build a transaction that spends the encryption UTxO, produces a valid output with the correct datum and NFT, but sends the output with only the minimum ADA — pocketing the difference.

**Mitigating Factors:**
- The NFT (primary protocol asset) is always preserved in the output
- The ADA at risk is typically only the minUTxO deposit (a few ADA)
- The owner had the full TTL window to act on their UTxO

**Recommendation:** Add a value preservation check for the continuing output, at minimum for the `CancelEncryption` path:
```aiken
// ensure output value >= input value (minus fees handled by tx balancing)
assets.without_lovelace(this_input.output.value) == assets.without_lovelace(output.value),
```
Or verify the lovelace is preserved: `lovelace_of(output.value) >= lovelace_of(this_input.output.value)`.

**Developer Response:** Intentional as a penalty mechanism. If a seller never completes the re-encryption process, the extra lovelace should be extractable by whoever pays the cancellation transaction fee. The design creates a balance beam incentive: if a bid gets stuck in Pending, the canceller should have the opportunity to recoup some lovelace or have the transaction fee subsidized. No code change needed.

---

### MEDIUM-1: TTL Upper Bound Allows Extended Pending Lock

**Location:** `validators/encryption.ak:308-309`

**Description:**
```aiken
(expected_ttl <= ttl)?,
(ttl <= 2 * expected_ttl)?,
```
Where `expected_ttl = ub + pending_ttl` (upper validity bound + 6 hours).

With a maximum validity window of 1 hour (`snark_validity_window`), the effective TTL range is approximately:
- Minimum: ~`now + 6h`
- Maximum: ~`now + 14h`

**Impact:** An owner could set a near-maximum TTL, blocking third-party cancellation for up to ~14 hours. During this time, the encryption UTxO is in `Pending` state and cannot accept new bids or be re-encrypted.

**Mitigating Factors:**
- The owner can always cancel with their signature regardless of TTL
- The 2x multiplier may be intentional to accommodate clock drift and slot timing

**Recommendation:** Consider whether a tighter upper bound (e.g., `1.5 * expected_ttl`) would better serve the protocol's liveness requirements, or document the 2x design rationale.

**Developer Response:** Intentional. Exact time windows on Cardano are difficult to enforce. The 2x multiplier provides a large window by design. 14 hours worst case is acceptable for the protocol.

---

### MEDIUM-2: Groth16 Public Input Length Not Explicitly Validated

**Location:** `lib/types/groth.ak:78-116`

**Description:** The `derive_vk_x_combined` function uses `vk.nPublic - 1` to determine how many IC elements pair with public inputs. If the provided `public` list is shorter than expected, the function correctly fails with `"public shorter than vkIC"`. However, if extra public inputs are provided, they are **silently ignored**.

**Impact:** Not directly exploitable. Providing incorrect public inputs causes the Groth16 pairing check to fail regardless. The VK is immutable (stored in the reference datum). However, silently ignoring extra data is a code smell that could mask bugs in off-chain transaction construction.

**Recommendation:** Add an explicit length check or ensure `public` is fully consumed after `derive_vk_x_combined` returns.

**Developer Response:** Acknowledged. Developer would like to see what the solution looks like as a check. A simple list length comparison against `vk.nPublic - 1` before calling `derive_vk_x_combined` would suffice.

---

### LOW-1: No Value Constraints on Protocol UTxO Outputs

**Location:** All mint handlers (`encryption.ak`, `bidding.ak`, `genesis.ak`)

**Description:** Mint handlers verify datum, script address, NFT, and reference script — but do not enforce minimum ADA values on outputs. The Cardano ledger enforces minUTxO at the protocol level, so this is not exploitable, but the contracts cannot enforce protocol-specific deposit requirements.

**Recommendation:** Acceptable as-is. Only relevant if the protocol wants to enforce specific ADA deposits.

**Developer Response:** Intentional. Min ADA should scale naturally with the protocol parameters.

---

### LOW-2: `list` Stdlib Import in Bidding Validator

**Location:** `validators/bidding.ak:5`

**Description:** The bidding validator imports `aiken/collection/list`, while the encryption validator uses a custom inline `has()` function. Per project history, removing stdlib `list` imports yielded 20-32% size reductions in other validators.

**Impact:** Unnecessary compiled code size. No security impact.

**Recommendation:** Replace `list.has` and `list.filter` and `list.all` with inline equivalents as done in `encryption.ak`.

**Developer Response:** Skipped. The bidding redeemer was rewritten to be cheap enough to fit on-chain. Current size is acceptable.

---

## Positive Security Properties

### P1: Bidirectional Cross-Validator Authorization
The encryption and bidding validators cross-reference each other's redeemers:
- `UseEncryption` reads the bid's redeemer and verifies it is `UseBid`
- `UseBid` reads the encryption's redeemer and verifies it is `UseEncryption` with the matching `selected_bid_token`

This prevents either validator from being satisfied independently. An attacker cannot spend a bid without the encryption contract's approval, and vice versa.

### P2: Deterministic Unique Token Names
Token names are derived from the first transaction input (`util.generate_token_name`), which is deterministically sorted in Plutus V3. Combined with `assets.has_nft_strict` (exactly quantity 1), each protocol NFT is provably unique and non-fungible.

### P3: Strict NFT Quantity Checks
`search.for_output_by_token` and `search.for_input_by_token` both use `assets.has_nft_strict`, which verifies exactly 1 token of the specified policy and name exists. This prevents token quantity manipulation attacks.

### P4: Domain-Separated Fiat-Shamir Heuristics
Schnorr proofs use `SCHNORR|PROOF|v1|` and binding proofs use `BINDING|PROOF|v1|` as domain tags. This prevents cross-protocol proof reuse where a valid Schnorr proof could be repurposed as a binding proof or vice versa.

### P5: `else(_) { fail }` on All Validators
Every validator includes a catch-all handler that fails for unknown script purposes. This prevents exploitation of unexpected script execution contexts.

### P6: One-Shot Genesis Minting
The genesis validator consumes a specific UTxO (`tx_id#tx_idx`) during minting, ensuring the reference datum token can only be created once. The genesis contract has no spend endpoint, making the reference datum effectively immutable.

### P7: Register Validation Prevents Degenerate Keys
`register.is_register_valid` rejects:
- Non-standard generators (must be the canonical BLS12-381 G1 generator)
- Identity element as public value (prevents trivial key attacks)
- Generator == public value (prevents known-discrete-log attacks)

### P8: Reference Datum Immutability
The reference datum (containing all script hashes and the SNARK verification key) has no spend/update mechanism. Once created via genesis, it cannot be modified. This prevents admin key attacks on protocol configuration.

### P9: Encryption State Machine Integrity
State transitions are tightly controlled:
- `Open` -> `Pending`: Only via `UseSnark` (owner signs, groth proof provided)
- `Pending` -> `Open` (new owner): Only via `UseEncryption` (full cryptographic verification)
- `Pending` -> `Open` (same owner): Only via `CancelEncryption` (owner signs OR TTL expired)
- Capsule (ciphertext) is verified immutable across all transitions
- Token name is verified immutable across all transitions

---

## Test Coverage Assessment

**Total tests:** 86 (all passing per `aiken check`)

*30 tests added during this audit to improve coverage.*

| Module | Tests | Coverage |
|--------|-------|----------|
| `groth.ak` | 14 | Proof verification, roundtrips, commitments, invalid PoK |
| `search.ak` | 23 (+5) | Output/input search, reference datum, redeemer lookup, **withdraw redeemer**, quantity rejection, empty list edge cases |
| `level.ak` | 12 (+4) | Half/full levels, multi-party verification, forgery prevention, **wrong token name, cross-level verification, swapped args** |
| `schnorr.ak` | 9 (+3) | Schnorr + binding proofs, forgery attempts, **tampered commitment, wrong token, different secret** |
| `register.ak` | 9 (+4) | Valid/invalid registers, group element validation, **swapped fields, arbitrary bytes, both-generator, second valid** |
| `util.ak` | 10 (+4) | Token name construction, edge cases, **max index 255, uniqueness, single input, negative index** |
| `limb_compression.ak` | 6 (+4) | G1 point compression verification, **wrong x/y limbs, insufficient data, swapped points** |
| `digest.ak` | 3 | Hash function validation |

**Adversarial tests (explicit `fail` tests):** 25 (+14)
- Schnorr forgery, binding proof forgery, tampered commitment, wrong token binding
- R5 forgery, swapped R5 args, wrong token for levels, cross-level type mismatch
- Invalid register (4 original + 3 new: swapped, arbitrary bytes, both-generator)
- Wrong/insufficient limb data, swapped points
- Out-of-range index, negative index, empty inputs, empty reference datum list

**Remaining gaps:**
- No validator-level integration tests (all tests are library-level)
- No multi-step transaction flow tests
- No time/TTL boundary tests for `CancelEncryption`

---

## Recommendations Summary

| Priority | Action | Status |
|----------|--------|--------|
| **High** | Document the unconditional `True` returns as intentional hyperstructure design (HIGH-1, HIGH-2). | Acknowledged — intentional |
| **High** | Add value preservation check to `CancelEncryption` (HIGH-3). | Acknowledged — intentional penalty mechanism |
| **Medium** | Add explicit public input length check to `verify_groth16` (MEDIUM-2). | **Open — developer interested** |
| **Medium** | Document TTL 2x upper bound rationale (MEDIUM-1). | Acknowledged — intentional |
| **Low** | Add validator-level integration tests. | Open |
| **Low** | Replace `aiken/collection/list` in `bidding.ak` (LOW-2). | Skipped — fits on-chain |
| **Low** | Min-ADA constraints (LOW-1). | Skipped — scales naturally |

---

## Cryptographic Proof Mechanism Security

This section analyzes the protocol-level security of the cryptographic proof chain that underpins the PEACE protocol's re-encryption flow. The analysis covers the Schnorr sigma protocol, binding proof, Wang-Cao pairing checks, the R5 pairing relation, Groth16 SNARK verification, and limb compression — and evaluates whether their composition forms a secure re-encryption mechanism.

### Overview: The Proof Chain

The re-encryption from Alice to Bob spans two transactions, each enforcing distinct cryptographic invariants:

| Transaction | Proof | What It Enforces |
|-------------|-------|-----------------|
| Tx1: `UseSnark` | Groth16 SNARK | Witness W = q^{H(κ)} is correctly derived from κ = e(q^a, h0) |
| Tx2: `UseEncryption` | Limb compression | SNARK public inputs match on-chain G1 points (v, W, r2\_g1b) |
| Tx2: `UseEncryption` | Commitment PoK | gnark Pedersen commitment is valid |
| Tx2: `UseEncryption` | R5 pairing | R5 was created using Alice's secret δ\_a and the SNARK witness W |
| Tx2: `UseEncryption` | Binding proof | New half-level's r2\_g1b = q^a + v^r binds to Bob's public key |
| Tx2: `UseEncryption` | K-th level pairing | New (R1, R4) are internally consistent |

Additionally, at entry time:

| Transaction | Proof | What It Enforces |
|-------------|-------|-----------------|
| Mint: `EntryEncryptionMint` | Schnorr sigma | Alice knows her BLS12-381 secret δ |
| Mint: `EntryEncryptionMint` | Binding proof | First-level r2\_g1b binds to Alice's public key |
| Mint: `EntryEncryptionMint` | First-level pairing | (R1, R4) are consistent with h1, h2, h3 |
| Mint: `EntryBidMint` | Schnorr sigma | Bob knows his BLS12-381 secret δ |

### CG-1: Schnorr Sigma Protocol — Key Knowledge

**Implementation:** `lib/types/schnorr.ak:52-68`

**Equation:** g^z == g^r + u^c, where c = H("SCHNORR|PROOF|v1|" || g || g^r || u)

**Purpose:** Proves knowledge of the secret scalar δ such that u = g^δ, without revealing δ. Used at entry for both encryption (`EntryEncryptionMint`) and bidding (`EntryBidMint`).

**Analysis:**
- The protocol correctly implements a non-interactive Schnorr sigma protocol via the Fiat-Shamir heuristic.
- **Completeness:** An honest prover with secret δ can compute z = r + c·δ, and the verifier checks g^z == g^r + (g^δ)^c = g^(r+c·δ). This holds by construction.
- **Special soundness:** Given two accepting transcripts (a, c1, z1) and (a, c2, z2) with c1 ≠ c2, the extractor recovers δ = (z1 - z2)/(c1 - c2). This relies on the binding property of Blake2b-224.
- **Zero-knowledge:** A simulator can produce valid-looking transcripts without δ by choosing z first, computing g^r = g^z - u^c.
- **Domain separation:** The tag `SCHNORR|PROOF|v1|` prevents Schnorr transcripts from being reused as binding proof challenges or any other hash context.

**Finding:** Sound. The Schnorr proof ensures that anyone who creates an encryption entry or bid genuinely knows the BLS12-381 secret associated with their Register. This is the foundation of key ownership.

### CG-2: Binding Sigma Protocol — Recipient Key Binding

**Implementation:** `lib/types/schnorr.ak:111-145`

**Equations verified:**
1. q^{z\_a} + u^{z\_r} == t2 + r2^c — proves r2 = q^a + u^r (binds to user's key)
2. q^{z\_r} == t1 + r1^c — proves r1 = q^r

Where c = H("BINDING|PROOF|v1|" || g || u || t1 || t2 || r1 || r2 || token\_name)

**Purpose:** Proves that the encryption level's r2\_g1b was computed as q^a + u^r with respect to a specific user's public key u, and that r1 = q^r. Used both at entry (binding first level to Alice) and during re-encryption (binding new level to Bob).

**Analysis:**
- This is a conjunction of two Schnorr-type proofs sharing a single challenge c, proving joint knowledge of (a, r) satisfying both relations simultaneously.
- **Completeness:** With z\_a = α + c·a and z\_r = ρ + c·r, both equations reduce to identities (proven in the technical report's Appendix B, Lemma 2).
- **Soundness:** Extracting (a, r) from two transcripts is equivalent to solving two linear equations, which yields unique solutions. This is the standard special-soundness argument for conjunctive sigma protocols.
- **Token name binding:** The inclusion of `token_name` in the Fiat-Shamir transcript is critical — it prevents a binding proof created for one encrypted asset from being replayed on a different asset's UTxO.
- **Full transcript:** All public values (g, u, t1, t2, r1, r2, token\_name) are included in the hash, preventing any partial substitution.

**Finding:** Sound. This is the proof that ensures Bob's public value is used in the encryption level. Without it, an attacker could create an r2\_g1b that doesn't involve the recipient's public key, making decryption impossible for the intended recipient. The binding proof mathematically guarantees that r2\_g1b encodes Bob's key in the exponent structure.

### CG-3: Wang-Cao Level Pairing Verification — Level Consistency

**Implementation:** `lib/types/level.ak:74-92` (first level), `lib/types/level.ak:100-118` (k-th level)

**First-level equation:** e(g, R4) == e(R1, h1^{H(R1)} · h2^{H(R1||R2||token)} · h3)

**K-th level equation:** e(g, R4) == e(R1, h1^{H(R1)} · h2^{H(R1||R2||token)})

**Purpose:** Ensures the three-tuple (R1, R2, R4) in a half-level is internally consistent — that R4 was computed with the same random scalar r used to create R1.

**Analysis:**
- With R1 = q^r and R4 = r·(h1^{H(R1)} + h2^{H(R1||R2||token)} [+ h3]), the bilinearity of the pairing gives:
  - LHS: e(q, R4) = e(q, r·(h1^a · h2^b [· h3]))
  - RHS: e(q^r, h1^a · h2^b [· h3])
  - These are equal by bilinearity: e(q, [r]P) = e([r]q, P).
- **First vs. k-th level distinction:** The h3 term is present only in the first level. This prevents a k-th level (without h3) from being substituted as a first level, and vice versa. This is verified by the tests `is_alice_verified_incorrectly_as_kth` and `is_bob_verified_incorrectly`.
- **Token binding:** The hash input H(R1 || R2 || token) binds R2 and the token name into the R4 computation, preventing mix-and-match attacks where components from different levels or different tokens are combined.
- **Wang-Cao constants:** h0–h3 are derived via `g2.hash_to_group(base_seed, domain_tag)` where `base_seed` is the Cardano mainnet block 0 hash and each `domain_tag` is distinct ("WANG:h0" through "WANG:h3"). These are nothing-up-my-sleeve constants — they cannot be manipulated to have known discrete log relationships.

**Finding:** Sound. The level pairing checks ensure that each encryption level is self-consistent. An attacker cannot create a valid (R1, R4) pair without knowing the random scalar r, and cannot reuse components across different tokens or level types.

### CG-4: R5 Pairing Relation — Alice's Secret Binding

**Implementation:** `lib/types/level.ak:209-214`

**Equation:** e(q, R5) · e(u, h0) == e(W, p)

Where R5 = [H(κ)]p - [δ\_a]h0, u = q^{δ\_a} (Alice's public value), and W = q^{H(κ)} (the SNARK witness).

**Purpose:** Proves that R5 was correctly computed using Alice's secret key δ\_a and the hash of the pairing secret κ. This is the pairing check that ensures Alice's secret is used in the delegation.

**Analysis — correctness:**
- Expanding the LHS with R5 = [H(κ)]p - [δ\_a]h0:
  - e(q, [H(κ)]p - [δ\_a]h0) · e([δ\_a]q, h0)
  - = e(q, [H(κ)]p) · e(q, -[δ\_a]h0) · e(q, [δ\_a]h0) — by bilinearity
  - = e(q, [H(κ)]p) · 1
  - = e(q, p)^{H(κ)}
- The RHS: e([H(κ)]q, p) = e(q, p)^{H(κ)}
- LHS == RHS. ✓

**Analysis — security:**
- **Alice's secret is required:** To create R5 satisfying this equation, one needs both H(κ) and δ\_a. The SNARK proves H(κ) is correctly derived from the actual pairing secret κ = e(q^a, h0). Alice's secret δ\_a is needed directly in R5's construction.
- **Without Alice's secret:** An adversary who doesn't know δ\_a cannot compute [δ\_a]h0 and thus cannot construct a valid R5. They would need to solve the CDH problem in G2 to find [δ\_a]h0 from (h0, u=q^{δ\_a}).
- **Without the correct κ:** If a fake H(κ) is used, the SNARK proof fails (it proves the witness derivation from κ). If the SNARK somehow passes with a fake witness W', then e(W', p) ≠ e(q, R5) · e(u, h0) because R5 was computed with the real H(κ).
- **Binding to the SNARK:** The witness W appears in both the SNARK (as a public input, verified via limb compression) and this pairing check. This creates a two-way binding: the SNARK proves W is correctly derived, and the R5 pairing proves W is consistent with Alice's secret.

**Finding:** Sound. This is the critical proof that forces Alice to use her actual secret key in the re-encryption. Combined with the SNARK (which proves the witness is correctly derived), it ensures that the delegation chain is authentic. An adversary without Alice's secret cannot produce a valid (R5, W) pair.

### CG-5: Groth16 SNARK — Witness Correctness

**Implementation:** `lib/types/groth.ak:159-207` (main verifier), `lib/types/groth.ak:226-260` (commitment PoK)

**Circuit statement (from technical report Algorithm 5):**
- Secret inputs: (a, r)
- Public inputs: (v, w0, w1) — Bob's public value, witness q^{H(κ)}, and new r2\_g1b
- Proves: κ = e(q^a, h0), hk = MiMC(κ || DomainTag), w0 = q^{hk}, w1 = q^a + v^r

**Groth16 verification equation:** e(A, B) · e(vk\_x, -γ) · e(C, -δ) == e(α, β)

**Commitment PoK equation:** e(D\_sum, gSigmaNeg) · e(PoK, g) == 1

**Purpose:** The SNARK is the linchpin that bridges the off-chain pairing computation (κ = e(q^a, h0)) to the on-chain verification. Without it, the protocol would need to compute pairings on-chain to verify κ, which is impractical since GT elements cannot be stored or compared on Cardano.

**Analysis:**
- **Soundness:** Under the knowledge-of-exponent assumption (KEA), a valid Groth16 proof implies the prover knew a valid witness (a, r) satisfying the circuit constraints. No polynomial-time adversary can forge a proof for false statements.
- **What the SNARK binds together:**
  1. The witness w0 = q^{H(κ)} is derived from the actual κ, not an arbitrary value
  2. The new half-level's r2\_g1b (w1 = q^a + v^r) uses the same secret a that produced κ
  3. Bob's public key v is committed to in the proof
- **gnark commitment extension:** The Pedersen commitment PoK (`verify_commitments`) provides an additional binding on committed wire values, preventing manipulation of the commitment wire input. The implementation correctly follows gnark's verification equation.
- **Trusted setup:** Groth16 requires a trusted setup (SRS generation). If the toxic waste is not destroyed, the setup trapdoor holder can forge proofs. This is explicitly acknowledged in the technical report's assumptions (Section 5.1).

**Finding:** Sound under standard assumptions. The SNARK provides the critical link that makes the entire scheme work: it proves the witness W is honestly derived from the pairing secret κ, which cannot be verified directly on-chain. The gnark commitment extension is correctly implemented.

### CG-6: Limb Compression — SNARK-to-Chain Binding

**Implementation:** `lib/limb_compression.ak:75-92`

**Purpose:** Converts the SNARK public inputs (36 u64 little-endian integers representing 3 G1 points' affine coordinates) into compressed BLS12-381 G1 points, and verifies they match the on-chain values.

**Verified bindings** (in `UseEncryption`, `validators/encryption.ak:228-233`):
- v ↔ `bid_owner_g1.public_value` (Bob's public key from bid datum)
- w0 ↔ `witness` (the W = q^{H(κ)} provided in the redeemer)
- w1 ↔ `next_half_level.r2_g1b` (the new encryption level's r2)

**Analysis:**
- The compression correctly reconstructs the x-coordinate from 6 u64 limbs (little-endian base-2^64), computes the BLS12-381 sign bit from the y-coordinate, and produces a standard 48-byte compressed G1 point.
- **Without limb compression:** An attacker could submit a valid SNARK proof for arbitrary points (v', w0', w1') and then provide different on-chain values. Limb compression closes this gap by proving the SNARK's public inputs ARE the on-chain points.
- **Three-point binding:** All three critical values are bound simultaneously:
  - v = Bob's key ensures the SNARK was computed for this specific buyer
  - w0 = witness ensures the witness in the R5 pairing matches the SNARK's witness
  - w1 = r2\_g1b ensures the new encryption level matches the SNARK's computation

**Finding:** Sound. Limb compression is essential glue — without it, the SNARK proof and on-chain data would be unlinked, allowing proof substitution attacks.

### CG-7: Domain Separation

The protocol uses distinct domain tags across all hash contexts:

| Context | Domain Tag | Hex |
|---------|-----------|-----|
| Schnorr Fiat-Shamir | `SCHNORR\|PROOF\|v1\|` | `5343484e4f52527c50524f4f467c76317c` |
| Binding Fiat-Shamir | `BINDING\|PROOF\|v1\|` | `42494e44494e477c50524f4f467c76317c` |
| Hash-to-scalar | `HASH\|To\|Int\|v1\|` | `484153487c546f7c496e747c76317c` |
| Wang h0 | `WANG:h0` | `57414e473a6830` |
| Wang h1 | `WANG:h1` | `57414e473a6831` |
| Wang h2 | `WANG:h2` | `57414e473a6832` |
| Wang h3 | `WANG:h3` | `57414e473a6833` |
| SNARK circuit (MiMC) | Internal domain tag | (defined in circuit) |

**Finding:** All domain tags are distinct prefix-free strings. No two hash contexts share a tag. This prevents cross-domain attacks where a valid hash output in one context could be reused in another.

### CG-8: Composition Security — Does the Full Chain Hold?

The central question: **do these proofs compose into a secure re-encryption mechanism?**

**The proof chain in the re-encryption flow:**

```
Entry (Mint):
  Schnorr(Alice) ──→ Alice knows δ_a
  Binding(Alice) ──→ First-level r2 = q^a₀ + u_a^r₀ (binds to Alice)
  Level-1 pairing ──→ (R1₀, R4₀) are consistent

Re-encryption Tx1 (UseSnark):
  Groth16 ──→ W = q^{H(κ)} where κ = e(q^a, h0)
              AND w1 = q^a + v^r (new r2 uses Bob's key)

Re-encryption Tx2 (UseEncryption):
  Limb compression ──→ SNARK public inputs ARE (Bob's key, W, new r2_g1b)
  R5 pairing ──→ R5 uses Alice's secret δ_a AND the witness W
  Binding(Bob) ──→ New half-level r2 = q^a' + v^r' (binds to Bob's key)
  Level-k pairing ──→ New (R1, R4) are consistent
  Commitment PoK ──→ gnark Pedersen commitment is valid
```

**Threat analysis against the composed system:**

| Attack | Blocked By | Analysis |
|--------|-----------|----------|
| Create entry without knowing BLS secret | Schnorr proof | Cannot produce z = r + c·δ without δ |
| Create level not bound to recipient | Binding proof | Cannot satisfy both equations without (a, r) for the specific u |
| Forge R5 without Alice's secret | R5 pairing | Requires δ\_a to compute [δ\_a]h0; CDH-hard in G2 |
| Fabricate witness without real κ | Groth16 SNARK | Soundness: cannot prove false statement |
| Use SNARK proof for wrong on-chain points | Limb compression | Points must match exactly |
| Replay SNARK for different buyer | Limb compression (v binding) | v = bid\_owner\_g1.public\_value is checked |
| Substitute witness between Tx1 and Tx2 | Pending datum + limb compression | groth\_public stored in datum, re-verified via limb compression |
| Replay level from different token | Token name in binding + level hash | Token name is in Fiat-Shamir transcript and level hash |
| Cross-domain proof reuse | Domain separation (CG-7) | All tags are distinct |
| Use k-th level as first level (or vice versa) | h3 term presence/absence | Level-1 includes h3; level-k does not |

**Two-transaction atomicity:**
The protocol's split into UseSnark → UseEncryption creates a temporal gap where the status is Pending. However, the SNARK commits to a specific buyer (v = Bob's public key is a public input). Between Tx1 and Tx2:
- Alice cannot switch buyers: limb compression enforces v == bid\_owner\_g1.public\_value
- A third party cannot complete: owner\_vkh must sign UseEncryption
- The SNARK cannot be swapped: groth\_proof and groth\_public are stored in the Pending datum

**Decryption chain integrity:**
Each re-encryption hop produces a full-level containing R5. The recursive decryption (technical report Appendix B, Lemma 3) requires each R5 to be authentic:
- κ\_i = e(r2\_{g1,i}, h0) · e(r1\_i, R5\_i) / e(r1\_i, p^{H(κ\_{i+1})})
- Each R5 is verified on-chain at the time of re-encryption
- Historical levels are immutable (stored in blockchain history)
- Only the holder of the latest half-level's secret can begin the decryption chain

### CG-9: Assessment and Residual Risks

**Overall assessment:** The cryptographic proof mechanism is well-designed and the composition is sound under standard cryptographic assumptions (ECDLP, CDH, bilinear Diffie-Hellman, knowledge-of-exponent, collision resistance of Blake2b-224, and security of MiMC in the SNARK circuit).

The proof chain achieves its three primary goals:
1. **Bob's public value is enforced** via the binding proof (CG-2) + SNARK public input binding (CG-5) + limb compression (CG-6)
2. **Alice's secret is enforced** via the R5 pairing relation (CG-4), which requires δ\_a
3. **The witness is authentic** via the SNARK (CG-5), which proves W = q^{H(κ)} from the real κ

**Residual risks (all acknowledged in the technical report):**
- **Trusted setup:** Groth16 requires a trusted setup. If the SRS trapdoor is compromised, proofs can be forged, breaking the witness correctness guarantee.
- **MiMC security margin:** MiMC is efficient in arithmetic circuits but has a smaller security margin than traditional hash functions. If MiMC collisions are found, an attacker could produce a valid SNARK for a different κ that hashes to the same hk.
- **No formal CCA proof:** The technical report acknowledges that a formal CCA security proof is future work. The protocol aims for CCA security through the combination of binding proofs and pairing checks, but this has not been formally proven.
- **Blake2b-224 truncation for Fiat-Shamir:** The challenge scalar is derived from a 224-bit hash. For BLS12-381 scalars (~255 bits), this means the challenge space is 2^224, which is still astronomically large but technically not the full scalar field. This does not constitute a practical attack.
- **Key compromise:** If Alice's or Bob's BLS12-381 secret is compromised, all security guarantees for that identity are void. The protocol does not include key rotation or revocation mechanisms.

---

## Checklist Cross-Reference

| # | Checklist Item | Status |
|---|---------------|--------|
| 1 | Threat model and invariants | Assets: encrypted capsules (NFT-bound), ADA deposits. Authority: owner VKH + BLS12-381 key. Invariants: NFT uniqueness, capsule immutability, state machine correctness. |
| 2 | Script purpose and boundaries | Correct separation: encryption (mint+spend), bidding (mint+spend), genesis (mint), groth (withdraw+publish). No gaps in purpose coverage. `else(_) { fail }` on all. |
| 3 | Authorization checks | Owner VKH signature required for all state changes. Schnorr proof binds BLS key to owner. Binding proof ties encryption levels to specific users. Cross-validator redeemer checks prevent unilateral action. |
| 4 | UTxO selection and state machine | NFT-based thread tokens ensure unique state UTxOs. State continuity enforced via datum equality checks. No index-based selection (searches by token). |
| 5 | Datum / redeemer parsing | Datum parsing uses `expect` (fails on mismatch for protocol UTxOs). **HIGH-1/HIGH-2:** non-conforming datums return True instead of failing. |
| 6 | Value accounting | **HIGH-3:** No value preservation on continuing UTxOs. NFT conservation enforced via `has_nft_strict`. `without_lovelace` not used. |
| 7 | Minting policies | Strict: one-shot genesis, NFT-strict on mint, schnorr+binding on entry, exact `-1` on burn. `LeaveEncryptionBurn` / `LeaveBidBurn` enforce exact single-token burn via flatten equality. |
| 8 | Time / validity range | `UseSnark` enforces finite bounds, max 1h validity window, TTL range. `CancelEncryption` checks lower bound > TTL for expiry. **MEDIUM-1:** 2x TTL multiplier. |
| 9 | Stake credential / withdrawals | Groth witness withdraw handler correctly used as proof verification oracle. Encryption validator reads groth redeemer cross-validator. Publish handler correctly gates credential registration. |
| 10 | Reference inputs | Genesis token looked up via `search.for_reference_datum` with strict NFT check. Bidding entry verifies encryption token exists in reference inputs. |
| 11 | Replay / double-spend | Token names derived from consumed UTxOs ensure uniqueness. Groth proofs are tied to specific public inputs (G1 point limbs) preventing meaningful replay. |
| 12 | Integer math | TTL arithmetic uses standard integer ops. Limb compression uses 2^64 base with proper modular arithmetic. BLS scalar operations delegated to builtins. No user-controlled division. |
| 13 | DoS and cost bombs | BLS pairings are expensive but bounded (fixed number per transaction). List scans over inputs/outputs are linear. No nested loops over assets/maps. `has_nft_strict` in search functions is O(n) in outputs/inputs. |
| 14 | Branch coverage | **HIGH-1/HIGH-2:** `else -> True` branches exist and are reachable. All redeemer cases are covered. `fail` used for catch-all in all validators. |
| 15 | Off-chain assumptions | Token ordering is deterministic (Plutus V3 sorted inputs). Reference inputs must be provided by tx builder. No "only our UI" assumptions — all invariants enforced on-chain. |
| 16 | Tests and adversarial scenarios | 86 tests (30 added during audit) with 25 adversarial. Strong crypto-level testing. Remaining gap: no validator integration tests. |
| 17 | Upgrade / migration | No upgrade mechanism. Reference datum is immutable. No admin keys. No kill switch. Protocol state can only evolve through the defined state machine. Migration requires new genesis. |
