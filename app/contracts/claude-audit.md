# Peace Protocol Smart Contract Security Audit

**Date:** 2026-02-09
**Auditor:** Claude (Anthropic)
**Scope:** All validators and library code in `app/contracts/` except `validators/reference.ak` (excluded per client request — known test stub)
**Aiken Version:** v1.1.21 | Plutus V3 | stdlib v3.0.0

---

## Executive Summary

The Peace Protocol implements a proxy re-encryption system on Cardano using BLS12-381 cryptography, Groth16 SNARK verification, and a Wang-Cao unidirectional re-encryption scheme. The protocol manages encrypted data that can be transferred between owners via a bidding mechanism, with SNARK proofs ensuring correct state transitions.

The contracts demonstrate strong cryptographic design with bidirectional cross-validator authorization, domain-separated Fiat-Shamir heuristics, and strict NFT-based identity. However, several patterns allow unconditional spending of UTxOs under specific conditions, and value preservation is not enforced on continuing UTxOs. These are detailed below.

**Finding Summary:**

| Severity | Count | Description |
|----------|-------|-------------|
| HIGH     | 3     | Unconditional spend paths, value extraction |
| MEDIUM   | 2     | TTL bounds, public input length |
| LOW      | 2     | No value constraints, stdlib import bloat |
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

---

### MEDIUM-2: Groth16 Public Input Length Not Explicitly Validated

**Location:** `lib/types/groth.ak:78-116`

**Description:** The `derive_vk_x_combined` function uses `vk.nPublic - 1` to determine how many IC elements pair with public inputs. If the provided `public` list is shorter than expected, the function correctly fails with `"public shorter than vkIC"`. However, if extra public inputs are provided, they are **silently ignored**.

**Impact:** Not directly exploitable. Providing incorrect public inputs causes the Groth16 pairing check to fail regardless. The VK is immutable (stored in the reference datum). However, silently ignoring extra data is a code smell that could mask bugs in off-chain transaction construction.

**Recommendation:** Add an explicit length check or ensure `public` is fully consumed after `derive_vk_x_combined` returns.

---

### LOW-1: No Value Constraints on Protocol UTxO Outputs

**Location:** All mint handlers (`encryption.ak`, `bidding.ak`, `genesis.ak`)

**Description:** Mint handlers verify datum, script address, NFT, and reference script — but do not enforce minimum ADA values on outputs. The Cardano ledger enforces minUTxO at the protocol level, so this is not exploitable, but the contracts cannot enforce protocol-specific deposit requirements.

**Recommendation:** Acceptable as-is. Only relevant if the protocol wants to enforce specific ADA deposits.

---

### LOW-2: `list` Stdlib Import in Bidding Validator

**Location:** `validators/bidding.ak:5`

**Description:** The bidding validator imports `aiken/collection/list`, while the encryption validator uses a custom inline `has()` function. Per project history, removing stdlib `list` imports yielded 20-32% size reductions in other validators.

**Impact:** Unnecessary compiled code size. No security impact.

**Recommendation:** Replace `list.has` and `list.filter` and `list.all` with inline equivalents as done in `encryption.ak`.

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

**Total tests:** 56 (all passing per `aiken check`)

| Module | Tests | Coverage |
|--------|-------|----------|
| `groth.ak` | 14 | Proof verification, roundtrips, commitments, invalid PoK |
| `search.ak` | 18 | Output/input search, reference datum, redeemer lookup, edge cases |
| `level.ak` | 8 | Half/full levels, multi-party verification, forgery prevention |
| `schnorr.ak` | 6 | Schnorr + binding proofs, forgery attempts |
| `register.ak` | 5 | Valid/invalid registers, group element validation |
| `util.ak` | 6 | Token name construction, edge cases |
| `limb_compression.ak` | 2 | G1 point compression verification |
| `digest.ak` | 3 | Hash function validation |

**Adversarial tests (explicit `fail` tests):** 11
- Schnorr forgery, binding proof forgery, R5 forgery, invalid register (4 variants), wrong verification path, invalid PoK, out-of-range index, empty inputs

**Gaps:**
- No validator-level integration tests (all tests are library-level)
- No multi-step transaction flow tests
- No tests for the datum bypass / "invalid start" patterns (HIGH-1, HIGH-2)
- No time/TTL boundary tests for `CancelEncryption`
- No value preservation tests (since the contracts don't enforce it)
- No negative token quantity tests

---

## Recommendations Summary

| Priority | Action |
|----------|--------|
| **High** | Document or fix the unconditional `True` returns for invalid datums and missing NFTs (HIGH-1, HIGH-2). If intentional cleanup mechanism, add explicit code comments. |
| **High** | Add value preservation check to `CancelEncryption` (at minimum for the TTL-expired path) to prevent ADA extraction by third parties (HIGH-3). |
| **Medium** | Consider adding value preservation to `UseEncryption` and `UseSnark` even though owner-signed, to prevent accidental value loss during re-encryption. |
| **Medium** | Review TTL 2x upper bound and document design rationale (MEDIUM-1). |
| **Low** | Add validator-level integration tests covering adversarial transaction construction. |
| **Low** | Replace `aiken/collection/list` import in `bidding.ak` with inline functions (LOW-2). |

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
| 16 | Tests and adversarial scenarios | 56 tests with 11 adversarial. Strong crypto-level testing. **Gap:** no validator integration tests, no TTL/time boundary tests, no value preservation tests. |
| 17 | Upgrade / migration | No upgrade mechanism. Reference datum is immutable. No admin keys. No kill switch. Protocol state can only evolve through the defined state machine. Migration requires new genesis. |
