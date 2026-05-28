# Cardano Smart Contract Audit Report

**Target:** `logical-mechanism/peace-protocol`

**Target folder:** `contracts/peace-protocol/`

**Auditor:** audit-machine (Claude Opus 4.7 [1m])

**Audit date:** 2026-05-07

**Knowledge base revision:** local working tree of `/home/logic/Documents/LogicalMechanism/audit_machine`

**Source revision:** vendored clone, audited at parent-repo HEAD `ea23e1434e15c741d1a772191d7b5cb50e592d04`. Local working tree clean.

---

## 1. Executive Summary

- **Target folder audited:** [`contracts/peace-protocol/`](../../contracts/peace-protocol/) — 5 Aiken validators, 7 type modules, 4 helper libraries, 8 test files (~3,700 LoC; ~1,667 of those are tests).
- **Contracts present:** five Aiken validators ([`genesis.ak`](../../contracts/peace-protocol/validators/genesis.ak), [`reference.ak`](../../contracts/peace-protocol/validators/reference.ak), [`encryption.ak`](../../contracts/peace-protocol/validators/encryption.ak), [`bidding.ak`](../../contracts/peace-protocol/validators/bidding.ak), [`groth.ak`](../../contracts/peace-protocol/validators/groth.ak)).
- **Primary language / framework:** Aiken `v1.1.21+42babe5`, stdlib `aiken-lang/stdlib v3.0.0` (modern `cardano/transaction`, `cardano/assets`, `aiken/crypto/bls12_381/...` only).
- **Plutus version:** V3 (`Option<Datum>` spend handlers).
- **aiken-design-patterns library imports:** none (the protocol uses bespoke equivalents — see §3).
- **Overall risk posture:** the cryptographic core is mature (two prior independent audits in [`audits/`](../../contracts/peace-protocol/audits/)); the on-chain logic carries one previously-unflagged high-severity weakness (continuing-output **stake-credential** is never pinned, §5f), one medium-severity bootstrap concern that depends on operator discipline, and a defense-in-depth gap on the Groth16 public-input length carried from the prior audit.

### Findings By Tier

| Tier | New | Carried | Total |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 1 | 3 | 4 |
| Medium | 1 | 2 | 3 |
| Low | 0 | 3 | 3 |
| Informational | 4 | 4 | 8 |
| Optimization | 1 | 0 | 1 |

(See §7 for the index.)

### Top Three Concerns

1. **H-01 — Continuing-output stake-credential is never pinned (CWC-018).** Every protocol output check uses `Script(this_script) == payment_credential` only; on the permissionless TTL-expired `CancelEncryption` branch, an unrelated party can move the encryption UTxO to `(Script(encryption), AttackerStakeCred)` and divert all future staking rewards on the pooled lovelace.
2. **M-01 — Off-chain-only enforcement of the reference-validator trust anchor (CWC-005).** The genesis policy enforces that the bootstrap output is sent to `address.from_script(reference)` where `reference` is a script hash chosen by the operator at deploy time. There is no on-chain check that this hash is the actual `validators/reference.ak` script. Mis-set, every "immutable reference datum" guarantee collapses.
3. **M-03 — Groth16 public-input length silently truncates (CWC-009 / cryptographic-context).** Carried from prior audits. `derive_vk_x_combined` does not require `len(public) == vk.nPublic - 1`; extras are ignored. Not exploitable today (limb compression independently anchors the 36-element shape), but defense-in-depth.

### Production / Experimental / Research Assessment

**Experimental.** The cryptographic design is well-considered and the core flows pass two prior independent audits. However: (a) **no validator-level integration tests** exist (all 86 tests are library-level); (b) **no benchmarks** are committed; (c) the §5f stake-credential perimeter is unaddressed; (d) the M-01 bootstrap trust anchor is operator-managed. The protocol is not yet in a state where mainnet hyperstructure semantics ("immutable, no admin, no kill switch") can be relied on without operator review.

---

## 2. Versions & Build Metadata

- **`aiken.toml`:** `name = "logical-mechanism/peace-protocol"`, `version = "0.5.3"`, `compiler = "v1.1.21"`, `plutus = "v3"`, `license = "GPL-3.0-only"`. Single dependency: `aiken-lang/stdlib v3.0.0`.
- **`aiken.lock` summary:** locks `aiken-lang/stdlib` to commit `4f1d7e96fe33a317a83fb5b89e35a01dd16a4b96`. No transitive dependencies.
- **`plutus.json` preamble:** `version = "0.4.3"`, `plutusVersion = "v3"`, `compiler.version = "v1.1.21+42babe5"`. Validator hashes available in [`hashes/`](../../contracts/peace-protocol/hashes/).
- **aiken-design-patterns library imports detected:** none.
- **Stdlib version mismatch (legacy vs modern):** none — modern `cardano/transaction` only (verified via grep, 21 import lines, all modern).
- **Build-artifact freshness:** `aiken.toml.version = 0.5.3` vs `plutus.json.preamble.version = 0.4.3` — **mismatch (Informational I-01).** Compiler hash matches (`v1.1.21+42babe5`).
- **Git state at audit time:** containing repo HEAD `ea23e1434e15c741d1a772191d7b5cb50e592d04`. Local working tree clean. The `contracts/peace-protocol/` subtree is a vendored clone of the upstream repo (per the audit-machine README).

---

## 3. Contract Overview

The PEACE protocol implements an on-chain proxy re-encryption scheme: an encryption UTxO holds a Capsule (ciphertext) along with the recipient's BLS12-381 public values; ownership of the Capsule transfers via a paired-bid mechanism, and the new owner's encryption level is added on-chain through a Groth16 SNARK proof verified at a stake-script withdraw. The cryptographic mechanism — Wang–Cao re-encryption levels, Schnorr sigma proofs, gnark-flavoured Groth16, BLS pairings — is documented in detail in the prior baseline audit ([`audits/2026-02-09-claude.md` § Cryptographic Proof Mechanism Security](../../contracts/peace-protocol/audits/2026-02-09-claude.md)).

### Validator Inventory

| # | Component | Type | Purpose | Key Files | Plutus Ver | Auth Anchor | Hyperstructure? |
|---|---|---|---|---|---|---|---|
| 1 | Genesis | mint | One-shot bootstrap mint that produces the Reference UTxO (asset-name = `util.construct_token_name(tx_id, tx_idx)`) | [`genesis.ak`](../../contracts/peace-protocol/validators/genesis.ak) | V3 | one-shot `OutputReference` (tx_id+tx_idx) | No |
| 2 | Reference | always-fail | Immutable storage for `ReferenceDatum` (snark_vk, script hashes) | [`reference.ak`](../../contracts/peace-protocol/validators/reference.ak) | V3 | one-shot genesis NFT (off-chain trust anchor — see M-01) | Yes (storage) |
| 3 | Encryption | mint + spend | NFT minting + state-machine for encryption UTxOs | [`encryption.ak`](../../contracts/peace-protocol/validators/encryption.ak) | V3 | encryption-policy NFT + owner_vkh | Yes (bad-datum / no-NFT escape) |
| 4 | Bidding | mint + spend | NFT minting + lifecycle for bid UTxOs | [`bidding.ak`](../../contracts/peace-protocol/validators/bidding.ak) | V3 | bidding-policy NFT + owner_vkh | Yes (bad-datum / no-NFT escape) |
| 5 | Groth (Witness) | withdraw + publish | Stake-script proof oracle: withdraw verifies Groth16; publish gates RegisterCredential to own script_hash | [`groth.ak`](../../contracts/peace-protocol/validators/groth.ak) | V3 | parameter (genesis_pid + genesis_tkn) | No |

### Protocol Flow

1. **Bootstrap (one-shot).** Operator picks `(tx_id, tx_idx)`, computes the genesis policy hash, the reference contract hash, and the on-chain `ReferenceDatum`. The genesis mint consumes the chosen `OutputReference` and emits a single NFT `(genesis_pid, genesis_tkn)` to `address.from_script(reference)` carrying the `ReferenceDatum`. After this, the genesis policy is exhausted.
2. **Listing.** A seller `Alice` submits `EntryEncryptionMint`: a fresh encryption-policy NFT is minted, the continuing UTxO at the encryption script holds `EncryptionDatum { owner_vkh, owner_g1, token, half_level, capsule, status: Open, ... }`. Schnorr-verifies Alice owns the BLS secret behind `owner_g1`; binding-verifies `r2_g1b` ties to Alice; level-1 pairing verifies the half-level is internally consistent.
3. **Bidding.** A buyer `Bob` submits `EntryBidMint`: a bid-policy NFT is minted with `BidDatum { owner_vkh, owner_g1, pointer, token, locked_until, new_price }`. Bob must Schnorr-prove his BLS secret. The encryption UTxO with this `token` must be in `reference_inputs` (existence proof). Bob's lock must satisfy `locked_until ≥ ub + 6h`.
4. **Snark snapshot.** Alice constructs a Groth16 proof off-chain that her secret `δ_a` correctly produced the witness `W = q^{H(κ)}` and that the new `r2_g1b = q^a + v^r` binds to Bob's public key `v`. She submits `UseSnark` while a withdraw against the Groth script with redeemer `GrothWitnessRedeemer{proof, commitment_wire, public, ttl}` runs in the same tx and verifies the SNARK. The encryption transitions `Open → Pending(proof, public, ttl)` with `expected_ttl = ub + 6h`, `ttl ∈ [expected_ttl, 2·expected_ttl]`, validity-window ≤ 1h.
5. **Re-encryption.** Within ttl, Alice submits `UseEncryption` paired with `UseBid` (each side reads the other's spend redeemer). Limb compression binds the SNARK public inputs to `(bid_owner_g1, witness, next_half_level.r2_g1b)`. R5 pairing binds Alice's secret to the new witness. `add_new_half_level` re-verifies the binding proof and level-k pairing for the new owner. The encryption datum's owner becomes Bob; the bid NFT is burned.
6. **Cancellation.** If `UseEncryption` doesn't land within ttl, anyone may submit `CancelEncryption` after `lb > ttl` (or Alice may cancel earlier with her signature) returning the encryption to `Open`.
7. **Termination.** The owner may `RemoveEncryption` (burn the NFT) at any time when status is `Open`. Bid owners may `RemoveBid` once `lb > locked_until`. Both also have `Update*Price` paths to mutate `new_price`.

### Major Assets / Tokens

- **Genesis NFT** `(genesis_pid, genesis_tkn)` — one-shot, parameterized by chosen `OutputReference`. Authenticates the `ReferenceDatum`.
- **Encryption NFT** — per-Capsule, asset-name from the first input's `OutputReference`. Anchors the encryption thread token.
- **Bid NFT** — per-bid, asset-name from the first input's `OutputReference`. Anchors the bid thread token.

### Expected Transaction Shapes

- All state-changing transactions carry the genesis NFT as a reference input.
- `UseSnark` carries an extra withdraw at the `groth` stake-script credential (with the proof in the redeemer).
- `UseEncryption` ↔ `UseBid` is a single transaction that consumes exactly one encryption UTxO and exactly one bid UTxO (the bidding side enforces both by `expect [_]` filters).
- All continuing protocol outputs must carry the same NFT, the expected `EncryptionDatum`/`BidDatum` shape, and `reference_script == None`.

### Off-Chain Assumptions

- The operator deploys the genesis policy, picks the `reference` script hash in the bootstrap `ReferenceDatum`, and ensures it equals the actual `reference.ak` script hash. **(M-01 — see §8.)**
- Wallets / builders construct outputs with stake_credential intentionally chosen (None or owner-controlled). **(H-01 — see §8.)**
- Off-chain user interfaces present `new_price` to humans as a *declared* future-resale price, not the bid amount, since `new_price` is not enforced against bid UTxO lovelace (carried Informational I-05).

### User Roles

- **Encryption Owner (`owner_vkh`)** — the seller / current holder of an encryption UTxO. Required to sign every state-change.
- **Bid Owner (`owner_vkh`)** — the buyer who placed a bid. Required to sign `RemoveBid` / `UpdateBidPrice`.
- **Anyone** — may submit `CancelEncryption` after `lb > ttl` (the carried HIGH-3 / penalty-mechanism path).

### Admin Roles

**None.** The protocol has no admin keys, no upgrade mechanism, no kill switch. The design is hyperstructure-style (`hyperstructure.md` criteria 1, 2, 4 met; criterion 3 partially via the open egress on bad/missing-datum branches).

### Hyperstructure Assumptions

The carried HIGH-1 / HIGH-2 hyperstructure escapes (`bad-datum -> True`, `no-NFT -> True`) are intentional. They turn accidental UTxO mis-deposits into lossy-but-unstuck "junk-cleanup" surface area. Protocol-created UTxOs (correct datum + NFT) always fall through to the guarded branches.

### 3.7 Out of Scope

| Boundary | Why Out of Scope | Where It Surfaced | Risk If Wrong |
|---|---|---|---|
| Off-chain transaction builder (TS / JS / Lucid / Mesh / Blaze) | None present in target. | §8, §18 | A malicious builder can hijack stake_credential (H-01) without the validator catching it. |
| Bootstrap / deployment pipeline (`compile.sh`, the operator's `${CONFIG_JSON}`) | The shell script lives in the target but the trust anchor it sets (`reference` script hash inside `ReferenceDatum`) is operator-supplied. | §5d, M-01 | Mis-set trust anchor → reference UTxO becomes mutable (Critical impact on the protocol). |
| Cryptographic primitive correctness (BLS12-381, Groth16 trusted setup, Schnorr, MiMC, sigma protocols, bilinear-DH assumptions) | The 2026-02-09 audit performed the primitive-correctness review (CG-1 … CG-9). This audit covers Fiat-Shamir / context construction only. | §5g | Primitive break → all crypto-bound auth fails. |
| External oracles / data feeds | None — the only on-chain "oracle" is the `ReferenceDatum`, which is config not data. | §15 | n/a |
| Wallet / signer key management | Operator responsibility. | n/a | Compromised owner_vkh trivially exfiltrates the owner's UTxOs. |
| Governance / DAO procedures | None — the protocol explicitly has no admin / no upgrade. | n/a | n/a |
| Mainnet-vs-test environment matching | The `compile.sh` `${NETWORK}` switch toggles trace levels but the auditor cannot verify which network the operator builds for. | §8 | Trace artifacts on mainnet (gas inflation). |

### 3.8 Builder-Bypass Question

**Partially.** Every state-changing path requires either (a) `extra_signatories has owner_vkh` or (b) the permissionless TTL-expired `CancelEncryption` branch. Hand-crafted (no-builder) transactions cannot forge the owner's Ed25519 signature. They also cannot forge the genesis NFT (one-shot). They CAN, however, hijack the `stake_credential` of the continuing protocol UTxO on every state-change path because the validator only asserts `payment_credential` — see H-01 below. They can also exploit the carried HIGH-1 / HIGH-2 hyperstructure escapes on UTxOs that are mis-deposited at the script address (intentional). They cannot bypass the cryptographic-proof chain; the limb compression / R5 pairing / binding proofs are tightly bound to the redeemer and reference data.

---

## 4. Trust Model & Privileged Keys

| Role | Held By | Authority Scope | On-Chain Enforcement | Off-Chain Enforcement | Notes |
|---|---|---|---|---|---|
| Encryption owner | per-UTxO `owner_vkh` (Ed25519 vkh in `EncryptionDatum`) | Sign every spend except permissionless `CancelEncryption` after ttl | `has(extra_signatories, owner_vkh)` on Remove/UseEncryption/UseSnark/CancelEncryption(early)/UpdateEncryptionPrice | n/a | Owner is also the BLS secret-holder via Schnorr binding. |
| Bid owner | per-UTxO `owner_vkh` (Ed25519 vkh in `BidDatum`) | Sign RemoveBid (after lock), UpdateBidPrice | `has(extra_signatories, owner_vkh)` on those paths | n/a | UseBid does not require bid-owner sig — it requires the cross-validator UseEncryption flow. |
| Genesis seed UTxO | The single `OutputReference{tx_id, tx_idx}` chosen at bootstrap | Mints the genesis NFT exactly once | Hardcoded validator parameter; the validator requires that exact `OutputReference` is consumed | Operator must consume that UTxO atomically with the mint at bootstrap | No backup recovery — if the seed UTxO is spent without the mint, the protocol is unbootstrappable. |
| Reference UTxO trust anchor | `ReferenceDatum.reference: ScriptHash` chosen at bootstrap | Determines whether the reference UTxO is on-chain-immutable | None — see M-01 | **Operator must set `reference` to `hash(reference.ak)`** | Phase 5d off-chain-only enforcement. |
| SNARK trusted setup | gnark SRS used to generate `snark_vk` | Soundness of `verify_groth16` | `snark_vk` is immutable in `ReferenceDatum`; on-chain-fixed once bootstrapped | Operator must run an honest setup ceremony and destroy toxic waste | Out of scope for this audit; covered as residual risk in CG-9 of the prior baseline. |

The protocol has no admin / no governance / no upgrade key. Once correctly bootstrapped, the on-chain footprint is invariant.

---

## 5. Tx-Shape Map

Per validator, per redeemer constructor.

### 5.1 Genesis (mint only)

| Allowed input set | Allowed output set | Required signers | Required mint / burn | Required validity-range bound | Cross-validator dependencies | Test coverage |
|---|---|---|---|---|---|---|
| The exact `OutputReference{tx_id, tx_idx}` UTxO must be consumed | One output to `address.from_script(reference)` carrying the genesis NFT, an `InlineDatum` decoding to `ReferenceDatum`, and `reference_script == None` | none | mint NFT `(genesis_pid, genesis_tkn)` (qty 1) — `assets.has_nft_strict` | none | `reference` field of the produced datum determines the address — see M-01 | None (no genesis tests) |

### 5.2 Reference (always-fail)

n/a — every script purpose hits `else(_) { fail }`.

### 5.3 Encryption Mint

| Constructor | Allowed inputs | Allowed outputs | Signers | Mint / burn | Validity range | Cross-validator |
|---|---|---|---|---|---|---|
| `EntryEncryptionMint(SchnorrProof, BindingProof)` | any (the first input is used as the token-name seed) | one continuing output at the encryption script with the new NFT, valid `EncryptionDatum { status: Open, full_level: None, ... }`, `reference_script == None` | `owner_vkh` | mint encryption NFT (qty 1) | not asserted | none |
| `LeaveEncryptionBurn(tkn)` | any | any (subject to the `assets.flatten(mint) == [(p,t,-1)]` strict-shape check) | none directly | burn (qty -1) of `(policy_id, tkn)` | not asserted | spend-side `RemoveEncryption` enforces the no-output-holds-token check (and owner sig) |

### 5.4 Encryption Spend

| Constructor | Allowed inputs | Allowed outputs | Signers | Mint / burn | Validity range | Cross-validator |
|---|---|---|---|---|---|---|
| `RemoveEncryption` | the spent encryption UTxO (must hold the NFT) | no output may hold the NFT | `owner_vkh` | burn the NFT via `LeaveEncryptionBurn` | not asserted | none |
| `UseEncryption(witness, r5, selected_bid_token, binding_proof)` | the spent encryption UTxO (in Pending) + a bid UTxO with `selected_bid_token` (resolved via `for_input_by_token(inputs, bid, selected_bid_token)`); reference inputs must include the genesis NFT | one continuing output at the encryption script with `status: Open`, `next_owner_*` from bid, `bid_new_price → next_new_price`, NFT preserved, `reference_script == None` | `owner_vkh` (current encryption owner) | none directly | not asserted directly (the prior `UseSnark` constrained the validity window) | UseBid spend redeemer must be `UseBid`; bid `payment_credential == Script(bid_from_reference_datum)` |
| `UseSnark` | the spent encryption UTxO (in Open) | one continuing output at the encryption script with `status: Pending(proof, public, ttl)`, all other fields preserved via `..this_datum` spread, NFT preserved, `reference_script == None` | `owner_vkh` | none | both bounds Finite; `ub - lb ≤ snark_validity_window (1h)`; `expected_ttl ≤ ttl ≤ 2·expected_ttl` where `expected_ttl = ub + pending_ttl (6h)` | a withdraw redeemer at `groth_script` (looked up from `ReferenceDatum`) must exist; its proof is committed into the Pending datum |
| `CancelEncryption` | the spent encryption UTxO (in Pending) | one continuing output at the encryption script with `status: Open`, all other fields preserved via `..this_datum`, NFT preserved, `reference_script == None` | `owner_vkh` OR `lb > ttl` (permissionless after ttl) | none | for the permissionless branch only: `lower_bound = Finite(lb)` with `lb > ttl` | none |
| `UpdateEncryptionPrice(price)` | the spent encryption UTxO (in Open) | one continuing output with `new_price = price`, all other fields preserved via `..this_datum`, NFT preserved, non-ADA tokens preserved (`without_lovelace` equality), `reference_script == None` | `owner_vkh` | none | not asserted | none |

### 5.5 Bidding Mint

| Constructor | Allowed inputs | Allowed outputs | Signers | Mint / burn | Validity range | Cross-validator |
|---|---|---|---|---|---|---|
| `EntryBidMint(SchnorrProof)` | any (first input seeds token name); reference inputs must include the genesis NFT and an encryption UTxO holding `(encryption, token)` | one continuing output at the bidding script with valid `BidDatum`, `pointer == token_name`, NFT, `reference_script == None` | `owner_vkh` | mint bid NFT (qty 1) | `upper_bound = Finite(ub)` with `locked_until ≥ ub + minimum_bid_lock (6h)` | reference-input encryption UTxO existence |
| `LeaveBidBurn(tkn)` | any | any (subject to flatten shape) | none directly | burn (qty -1) | not asserted | spend-side `RemoveBid` / `UseBid` |

### 5.6 Bidding Spend

| Constructor | Allowed inputs | Allowed outputs | Signers | Mint / burn | Validity range | Cross-validator |
|---|---|---|---|---|---|---|
| `RemoveBid` | the spent bid UTxO (must hold the NFT) | no output may hold the bid NFT | `owner_vkh` | burn via `LeaveBidBurn` | `lower_bound = Finite(lb)` with `lb > locked_until` | none |
| `UseBid` | exactly one input at the encryption script (filtered by payment_credential) and exactly one bid input (filtered by payment_credential) — both anchored by NFT presence; reference inputs include genesis NFT | bid NFT must NOT appear on any output (burned) | none directly (the encryption side requires owner_vkh) | bid burn (via `LeaveBidBurn`) | not asserted | encryption spend redeemer must be `UseEncryption(_,_,this_pointer,_)`; the encryption input must hold `(encryption, this_token)` |
| `UpdateBidPrice(price)` | the spent bid UTxO | one continuing output with `new_price = price`, NFT preserved, non-ADA tokens preserved, `reference_script == None` | `owner_vkh` | none | not asserted | none |

### 5.7 Groth Withdraw + Publish

| Constructor | Allowed inputs | Allowed outputs | Signers | Mint / burn | Validity range | Cross-validator |
|---|---|---|---|---|---|---|
| `GrothWitnessRedeemer{proof, commitment_wire, public, ttl}` (withdraw) | reference inputs must include the genesis NFT (for `snark_vk` lookup) | none directly | none | none | not asserted at the withdraw layer; `ttl` from this redeemer is later constrained by `UseSnark` | the proof's binding to a specific encryption is established later by `UseSnark` storing it in the Pending datum |
| `Register(script_hash)` (publish) | n/a | n/a | n/a | n/a | n/a | the `RegisterCredential` certificate must register `Script(script_hash)`; only allowed for the validator's own credential |

---

## 6. Ranking System

**Severity (six tiers).** Critical / High / Medium / Low / Informational / Optimization — per `audit.prompt.improved` §4. Severities here are derived from exploitability, fund impact, likelihood, on-chain enforceability, off-chain dependence, and intentional-hyperstructure status.

**Confidence (four labels).** Confirmed / Likely / Suspected / Unverified — per §5. Confirmed = exploit path proven by quoted code + concrete tx shape; Likely = matches a known attack but no PoC built; Suspected = heuristic flag; Unverified = pattern observed, impact unknown.

**Status (six values).** Open / Needs Verification / Not Exploitable As Written / Design Tradeoff / Intentional Hyperstructure Behavior / Optimization Opportunity — per §5.

**Production / experimental / research rubric (audit-prompt §16):**

- **Production-ready** = no Critical/High open, validator-level integration tests + benchmarks committed, every off-chain-only enforcement either eliminated or paired with operator runbook, address perimeter pinned end-to-end, prior-audit footprint resolved.
- **Experimental** = above conditions partially met; protocol works under cooperative use but adversarial exposure is real.
- **Research-stage** = key cryptographic-context decisions still being iterated; tests are PoC-only.

This protocol's posture is **Experimental** — the cryptography is mature but the on-chain perimeter (H-01) and operator-discipline (M-01) gaps prevent the hyperstructure claim from being unconditionally true.

---

## 7. Summary of Findings

Sorted: Critical → High → Medium → Low → Informational → Optimization. Within tier: Confidence → Component.

| ID | Severity | Confidence | Status | CWC | Title | Component | File:Line |
|---|---|---|---|---|---|---|---|
| H-01 | High | Likely | Open | CWC-018 | Continuing-output stake-credential not pinned (stake-credential hijack) | encryption.spend / encryption.mint / bidding.spend / bidding.mint | [`encryption.ak:62`](../../contracts/peace-protocol/validators/encryption.ak#L62), [`encryption.ak:221`](../../contracts/peace-protocol/validators/encryption.ak#L221), [`encryption.ak:293`](../../contracts/peace-protocol/validators/encryption.ak#L293), [`encryption.ak:330`](../../contracts/peace-protocol/validators/encryption.ak#L330), [`encryption.ak:367`](../../contracts/peace-protocol/validators/encryption.ak#L367), [`bidding.ak:72`](../../contracts/peace-protocol/validators/bidding.ak#L72), [`bidding.ak:223`](../../contracts/peace-protocol/validators/bidding.ak#L223) |
| H-02 | High | Confirmed | Intentional Hyperstructure Behavior | CWC-019 | Bad-datum / missing-datum unconditional True (carried HIGH-1) | encryption.spend / bidding.spend | [`encryption.ak:375-381`](../../contracts/peace-protocol/validators/encryption.ak#L375-L381), [`bidding.ak:231-237`](../../contracts/peace-protocol/validators/bidding.ak#L231-L237) |
| H-03 | High | Confirmed | Intentional Hyperstructure Behavior | CWC-019 | Missing-NFT unconditional True on `Remove*` (carried HIGH-2) | encryption.spend / bidding.spend | [`encryption.ak:139-142`](../../contracts/peace-protocol/validators/encryption.ak#L139-L142), [`bidding.ak:140-143`](../../contracts/peace-protocol/validators/bidding.ak#L140-L143) |
| H-04 | High | Confirmed | Design Tradeoff | CWC-004 | No lovelace preservation on continuing encryption UTxOs (carried HIGH-3) | encryption.spend | [`encryption.ak:201-241`](../../contracts/peace-protocol/validators/encryption.ak#L201-L241), [`encryption.ak:283-298`](../../contracts/peace-protocol/validators/encryption.ak#L283-L298), [`encryption.ak:323-335`](../../contracts/peace-protocol/validators/encryption.ak#L323-L335) |
| M-01 | Medium | Suspected | Needs Verification | CWC-005 | Off-chain-only enforcement of reference-validator trust anchor | genesis.mint / lifecycle | [`genesis.ak:34-43`](../../contracts/peace-protocol/validators/genesis.ak#L34-L43) |
| M-02 | Medium | Confirmed | Design Tradeoff | CWC-006 | Pending TTL upper bound is `2 × expected_ttl` (carried MED-1) | encryption.spend | [`encryption.ak:285-286`](../../contracts/peace-protocol/validators/encryption.ak#L285-L286) |
| M-03 | Medium | Likely | Open | CWC-009 | Groth16 public-input length silently truncates (carried MED-2) | lib/types/groth.ak | [`lib/types/groth.ak:78-116`](../../contracts/peace-protocol/lib/types/groth.ak#L78-L116) |
| L-01 | Low | Confirmed | Design Tradeoff | CWC-028 | No protocol-specific min-ADA constraints (carried LOW-1) | encryption.mint / bidding.mint / genesis.mint | (multiple) |
| L-02 | Low | Confirmed | Design Tradeoff | CWC-030 | `aiken/collection/list.{has, filter}` import in bidding (carried LOW-2) | bidding.spend / bidding.mint | [`bidding.ak:5`](../../contracts/peace-protocol/validators/bidding.ak#L5) |
| L-03 | Low | Confirmed | Design Tradeoff | CWC-004 | Owner self-drain of lovelace on `Update*Price` (carried LOW-3) | encryption.spend / bidding.spend | [`encryption.ak:338-373`](../../contracts/peace-protocol/validators/encryption.ak#L338-L373), [`bidding.ak:196-228`](../../contracts/peace-protocol/validators/bidding.ak#L196-L228) |
| I-01 | Informational | Confirmed | Open | CWC-030 | Build artifact stale: `aiken.toml` v0.5.3 vs `plutus.json` preamble v0.4.3 | repo metadata | [`aiken.toml:2`](../../contracts/peace-protocol/aiken.toml#L2), [`plutus.json:5`](../../contracts/peace-protocol/plutus.json#L5) |
| I-02 | Informational | Confirmed | Open | CWC-030 | Test fixtures cannot construct adversarial Address / Output variants | lib/tests | [`lib/tests/util.ak:17-28`](../../contracts/peace-protocol/lib/tests/util.ak#L17-L28), [`lib/tests/search.ak:29-40`](../../contracts/peace-protocol/lib/tests/search.ak#L29-L40) |
| I-03 | Informational | Confirmed | Open | CWC-030 | Insufficient `bench` coverage for hot-path redeemers | all validators | (no bench blocks anywhere in target) |
| I-04 | Informational | Suspected | Design Tradeoff | CWC-009 | Groth withdraw redeemer has no per-tx domain binding (binding deferred to `UseSnark` + `UseEncryption`) | groth.withdraw / encryption.UseSnark | [`groth.ak:15-34`](../../contracts/peace-protocol/validators/groth.ak#L15-L34), [`encryption.ak:244-299`](../../contracts/peace-protocol/validators/encryption.ak#L244-L299) |
| I-05 | Informational | Confirmed | Design Tradeoff | CWC-028 | `new_price` is advisory, not payment-enforcing (carried INFO-1) | encryption.spend / bidding.spend | (multiple) |
| I-06 | Informational | Confirmed | Open | CWC-028 | Bidder may self-lock for arbitrary duration (carried INFO-2) | bidding.mint | [`bidding.ak:62-66`](../../contracts/peace-protocol/validators/bidding.ak#L62-L66) |
| I-07 | Informational | Confirmed | Design Tradeoff | CWC-006 | Bid time-lock partially mitigates the OBS-1 griefing window (carried INFO-3) | encryption ↔ bidding | (multiple) |
| I-08 | Informational | Suspected | Open | CWC-030 | `compile.sh` token-name builder may diverge from `util.construct_token_name` for `tx_idx ≥ 24` | compile.sh | [`compile.sh:36-41`](../../contracts/peace-protocol/compile.sh#L36-L41) |
| O-01 | Optimization | Confirmed | Optimization Opportunity | CWC-030 | No baseline benchmarks for any redeemer | all validators | (no bench blocks) |

---

## 8. Detailed Findings

### H-01 Continuing-output stake-credential not pinned (stake-credential hijack)

**Severity:** High

**Confidence:** Likely

**Status:** Open

**CWC ID:** CWC-018 (Insufficient Access Control / Stake-Credential Control)

**Root Cause:** `address-perimeter-incomplete`

**Component:** encryption.spend, encryption.mint, bidding.spend, bidding.mint

**Location:**

- [`validators/encryption.ak:62`](../../contracts/peace-protocol/validators/encryption.ak#L62) (`EntryEncryptionMint` continuing output)
- [`validators/encryption.ak:221`](../../contracts/peace-protocol/validators/encryption.ak#L221) (`UseEncryption` continuing output)
- [`validators/encryption.ak:222`](../../contracts/peace-protocol/validators/encryption.ak#L222) (`UseEncryption` bid input filter)
- [`validators/encryption.ak:293`](../../contracts/peace-protocol/validators/encryption.ak#L293) (`UseSnark` continuing output)
- [`validators/encryption.ak:330`](../../contracts/peace-protocol/validators/encryption.ak#L330) (`CancelEncryption` continuing output — **highest impact: permissionless TTL branch**)
- [`validators/encryption.ak:367`](../../contracts/peace-protocol/validators/encryption.ak#L367) (`UpdateEncryptionPrice` continuing output)
- [`validators/bidding.ak:72`](../../contracts/peace-protocol/validators/bidding.ak#L72) (`EntryBidMint` continuing output)
- [`validators/bidding.ak:164`](../../contracts/peace-protocol/validators/bidding.ak#L164), [`validators/bidding.ak:177`](../../contracts/peace-protocol/validators/bidding.ak#L177) (`UseBid` input filters)
- [`validators/bidding.ak:223`](../../contracts/peace-protocol/validators/bidding.ak#L223) (`UpdateBidPrice` continuing output)

**Quoted Code ([`encryption.ak:323-335`](../../contracts/peace-protocol/validators/encryption.ak#L323-L335)):**

```aiken
            CancelEncryption -> {
              // this token going back
              expect Some(Output {
                address: Address { payment_credential, .. },
                datum: InlineDatum(output_datum_data),
                reference_script,
                ..
              }): Option<Output> =
                search.for_output_by_token(outputs, this_script, token)
              ...
              and {
                ...
                Script(this_script) == payment_credential,   // payment_credential only — stake_credential unconstrained
                reference_script == None,
                assets.has_nft(this_input.output.value, this_script, token),
              }
            }
```

The pattern repeats verbatim on every continuing-output check across encryption.ak and bidding.ak: the `Address { payment_credential, .. }` destructure ignores `stake_credential`, the conjunction asserts only `Script(this_script) == payment_credential`, and the `reference_script` slot is correctly pinned to `None`. The comparable `genesis.ak:41` line uses full-Address equality (`output_address == reference_datum_address`) and is therefore safe — it is the lone exception.

**What It Is:**

A Cardano Address is a 2-tuple `(payment_credential, stake_credential)`. Every continuing protocol UTxO in this codebase asserts `Script(this_script) == payment_credential` but never constrains the `stake_credential`. An adversarial transaction constructor — or a hostile builder, or any third party on the permissionless TTL-expired `CancelEncryption` branch — may write the continuing UTxO to `(Script(encryption), AttackerStakeCred)` instead of `(Script(encryption), None)` (the canonical form). All future staking rewards on the lovelace held in that UTxO accrue to the attacker's stake address until the next state transition, and the hijacked stake_credential persists forward unless any subsequent path explicitly resets it (which none does).

**Why It Is Bad — Cardano Semantic Cited:**

On Cardano, every output Address pins both spend authority (via `payment_credential`) AND stake-rewards-recipient (via `stake_credential`). The ledger does not require these to match; an output `(Script(s), VerificationKey(attacker))` is structurally valid and the script `s` controls how it can be spent, while the rewards earned by its lovelace flow to `attacker`'s stake address. Validators that match a continuing UTxO by `payment_credential` only therefore accept any `stake_credential` the constructor chooses. The ledger pools all UTxO lovelace by stake address for reward accounting (see Cardano's reward stake distribution on each epoch boundary), so a single hijacked UTxO continuously diverts yield until it is spent. Because protocol UTxOs in PEACE are designed to persist (encryption UTxOs hold a Capsule for the lifetime of the encrypted asset), the diverted yield is unbounded relative to the principal.

**Attack Scenario:**

1. Alice owns an encryption UTxO at `(Script(encryption), None)` carrying NFT + (e.g.) 50 ADA in min-UTxO + extra lovelace deposited at entry. Alice submits `UseSnark`; the UTxO transitions to `Pending` with `ttl = ub + 6h`.
2. Six hours pass without `UseEncryption` landing.
3. Mallory submits `CancelEncryption` with `validity_range.lower_bound = Finite(ub + 6h + 1)`, satisfying `lb > ttl`. Mallory does NOT need Alice's signature.
4. Mallory's continuing output is at `(Script(encryption), Some(Inline(VerificationKey(MalloryStakeKey))))` — the validator accepts (only `payment_credential` is checked).
5. From this point onward, Alice can still `RemoveEncryption` (burn the NFT and recover the lovelace), or transition further, but until she does, every epoch the staking rewards on the UTxO's lovelace go to Mallory's stake key.
6. If Alice is unaware, the leak is permanent.

The same hijack works on every signed path (`UseEncryption`, `UseSnark`, `UpdateEncryptionPrice`, `UpdateBidPrice`, `EntryEncryptionMint`, `EntryBidMint`) when the owner's tx-construction tooling (wallet, CIP-30 dApp connector, custodian, batcher) is compromised or simply lazy — the owner signs whatever the builder presented, and the builder substitutes the stake credential.

**Severity Discipline:**

This is a value leak (per the prompt's §4 discipline): principal (the lovelace) remains spendable by the legitimate owner under `RemoveEncryption`, but yield (staking rewards) is siphoned indefinitely from a pool that grows over time as more encryption UTxOs are minted. The TTL-expired `CancelEncryption` branch is permissionless, removing even the "owner-must-sign-a-malicious-tx" mitigation. Default High under the prompt's rubric ("permanent and unbounded relative to principal at risk"). Borderline H/M because principal preservation is genuine and a single-UTxO yield in absolute terms is small; the High tier reflects the protocol-wide aggregation across all encryption UTxOs and the permissionless TTL path.

**Mitigating Factors:**

- The owner can always recover principal via `RemoveEncryption`.
- Cardano staking rewards are typically ~3–5 % APY, so the absolute leak per UTxO is bounded by the lovelace-times-uptime-times-rate.
- The protocol is hyperstructure-style; there is no centralized way for an attacker to scale this beyond one TTL-expired UTxO at a time per Mallory tx.

**How To Fix:**

Replace every `Script(this_script) == payment_credential` (and the bidding counterparts) with a helper that pins the entire address shape. The cleanest fix is one new helper:

```aiken
fn is_protocol_output(o: Output, h: ScriptHash) -> Bool {
  let Address { payment_credential, stake_credential } = o.address
  and {
    payment_credential == Script(h),
    stake_credential == None,
    o.reference_script == None,
  }
}
```

…and replace every `Script(this_script) == payment_credential, reference_script == None` pair (six call sites in encryption.ak, two in bidding.ak) with `is_protocol_output(o, this_script)`. The input-side filters in `UseBid` (lines 162-168 and 175-181) should similarly require the encryption / own input addresses to have `stake_credential == None`.

Alternative: pin the full address against the input's address (`o.address == this_input.output.address`), which mirrors the deny-by-default pattern used in `genesis.ak:41`. This automatically inherits whatever `stake_credential` the originating UTxO had — but on `EntryEncryptionMint` / `EntryBidMint` (no spent protocol input) the policy must still pin to `None` explicitly.

**Tests-To-Add:**

- Negative test: build a tx with `CancelEncryption` after ttl, output stake_credential = `Some(Inline(VerificationKey(adversary)))`. Expected: validator fails after the fix; passes today.
- Negative test: same for every signed path (`UseEncryption`, `UseSnark`, `UpdateEncryptionPrice`, `UpdateBidPrice`, `EntryEncryptionMint`, `EntryBidMint`).
- Positive test: same paths with `stake_credential = None`. Expected: pass.

**Knowledge References:**

- `attacks/authentication.md` — Insufficient Staking-Credential Control
- `taxonomy.md` CWC-018
- §5f (this report)
- Phase 7c variance row "Address.stake_credential" — the current test suite cannot construct any negative variant.

**Additional Notes:**

(borderline H / M because the principal is preserved; chosen H because of the permissionless TTL branch and the per-protocol aggregation.)

---

### H-02 Bad-datum / missing-datum unconditional True (carried HIGH-1)

**Severity:** High

**Confidence:** Confirmed

**Status:** Intentional Hyperstructure Behavior

**CWC ID:** CWC-019 (Unsafe Pattern Matching) / CWC-009 (Redeemer Validation Failure)

**Root Cause:** `hyperstructure-junk-cleanup`

**Component:** encryption.spend, bidding.spend

**Location:**

- [`validators/encryption.ak:375-381`](../../contracts/peace-protocol/validators/encryption.ak#L375-L381)
- [`validators/bidding.ak:231-237`](../../contracts/peace-protocol/validators/bidding.ak#L231-L237)

**Quoted Code ([`encryption.ak:375-381`](../../contracts/peace-protocol/validators/encryption.ak#L375-L381)):**

```aiken
        } else {
          // bad datum
          True
        }
      // no datum
      None -> True
    }
  }
```

**What It Is:**

When a UTxO at the encryption (or bidding) script address either carries no inline datum (`None` in V3's `Option<Datum>`) or carries one that does not decode to `EncryptionDatum`/`BidDatum`, the spend validator returns `True` unconditionally — anyone may spend it without any further check.

**Why It Is Bad — Cardano Semantic Cited:**

In Plutus V3, the spend handler receives `maybe_datum: Option<Data>`. On a UTxO with an inline datum, `maybe_datum` is `Some(d)`; on a UTxO without one (or with a hash-only datum where the preimage was not supplied), it is `None`. The intended pattern is `expect Some(d) = maybe_datum; expect Foo { ... } = d` — anything that fails this `expect` halts the validator with `False`. Returning `True` instead means any UTxO accidentally sent to the script address with the "wrong" shape can be drained by the first observer.

**Mitigating Factors:**

- All protocol-created UTxOs (entry mints, continuing outputs) carry a correctly-shaped inline `EncryptionDatum`/`BidDatum`. Those fall through to the guarded branches.
- This pattern exists deliberately as "junk-UTxO cleanup": it prevents accidentally-deposited funds from being permanently locked.

**How To Fix:**

If the hyperstructure cleanup is the intended semantic, document it inline (e.g. `// hyperstructure: any non-protocol UTxO at this address is sweepable`) and ideally require a proof-of-misdeposit — e.g., assert that the datum specifically does NOT decode to `EncryptionDatum` and that the value does NOT contain a protocol NFT, eliminating false positives. If the cleanup is not intended, change `True` to `False` (or `fail`).

**Knowledge References:**

- `attacks/datum.md` — Arbitrary / Missing Datum
- `dead_ends.md` — "Hyperstructure escape hatches must be entered only by datum-shape failure, not by a redeemer flag"
- prior audits HIGH-1; both audits classify this as Intentional.

**Tests-To-Add:**

- Negative test (post-fix, if cleanup is removed): build a UTxO at the encryption script address with `NoDatum` and assert spend fails.

**Additional Notes:**

Carried from prior audits. Developer responses on file accept this as intentional. Recorded here at the requested severity for taxonomy completeness.

---

### H-03 Missing-NFT unconditional True on `Remove*` (carried HIGH-2)

**Severity:** High

**Confidence:** Confirmed

**Status:** Intentional Hyperstructure Behavior

**CWC ID:** CWC-019 / CWC-009

**Root Cause:** `hyperstructure-junk-cleanup`

**Component:** encryption.spend (RemoveEncryption), bidding.spend (RemoveBid)

**Location:**

- [`validators/encryption.ak:124-143`](../../contracts/peace-protocol/validators/encryption.ak#L124-L143)
- [`validators/bidding.ak:118-144`](../../contracts/peace-protocol/validators/bidding.ak#L118-L144)

**Quoted Code ([`encryption.ak:139-142`](../../contracts/peace-protocol/validators/encryption.ak#L139-L142)):**

```aiken
              } else {
                // invalid start
                True
              }
```

**What It Is:**

In `RemoveEncryption` / `RemoveBid`, if the spent UTxO has a valid datum shape but does NOT hold the protocol NFT (`assets.has_nft(this_input.output.value, this_script, token)` returns False), the validator returns `True` regardless of signers, mints, or burns. Combined with H-02, this means every "non-protocol" UTxO at these addresses (no NFT) is freely spendable.

**Why It Is Bad — Cardano Semantic Cited:**

Same principle as H-02: returning `True` from a non-protocol path lets any third party drain funds.

**Mitigating Factors / How To Fix:**

Same as H-02. Developer-accepted hyperstructure design.

**Knowledge References:**

- `attacks/datum.md` — Arbitrary / Missing Datum (NFT-absence is the same hyperstructure-escape family)
- `dead_ends.md` — "Hyperstructure escape hatches must be entered only by datum-shape failure, not by a redeemer flag"
- prior audit HIGH-2 (Intentional)

**Additional Notes:**

Carried from prior audits.

---

### H-04 No lovelace preservation on continuing encryption UTxOs (carried HIGH-3)

**Severity:** High

**Confidence:** Confirmed

**Status:** Design Tradeoff

**CWC ID:** CWC-004 (Value Not Preserved)

**Root Cause:** `lovelace-not-preserved`

**Component:** encryption.spend (UseEncryption, UseSnark, CancelEncryption)

**Location:**

- [`validators/encryption.ak:201-241`](../../contracts/peace-protocol/validators/encryption.ak#L201-L241) (UseEncryption)
- [`validators/encryption.ak:283-298`](../../contracts/peace-protocol/validators/encryption.ak#L283-L298) (UseSnark)
- [`validators/encryption.ak:323-335`](../../contracts/peace-protocol/validators/encryption.ak#L323-L335) (CancelEncryption)

**Quoted Code ([`encryption.ak:323-335`](../../contracts/peace-protocol/validators/encryption.ak#L323-L335)):**

```aiken
              and {
                expired_or_cancel,
                output_datum_data == expected_output_datum_data,
                Script(this_script) == payment_credential,
                reference_script == None,
                assets.has_nft(this_input.output.value, this_script, token),
              }
```

**What It Is:**

Continuing-output checks across `UseEncryption`, `UseSnark`, and `CancelEncryption` verify the NFT is preserved but never `assets.lovelace_of(input) == assets.lovelace_of(output)` (or `>=`). On the permissionless TTL-expired `CancelEncryption` branch, any third party can produce an output with only min-ADA and pocket the difference.

**Why It Is Bad — Cardano Semantic Cited:**

Cardano's ledger does not enforce value preservation across script boundaries; the validator must do so explicitly. On the permissionless TTL-expired branch of `CancelEncryption`, anyone may submit the cancel and pocket the difference between input and min-ADA output.

**Mitigating Factors / How To Fix:**

Per prior audit (HIGH-3); developer-accepted as a "penalty mechanism" — the seller incurs a cost if they let a Pending state expire. The carried-over rationale is preserved. If the policy were to be reversed, add `assets.lovelace_of(input.value) <= assets.lovelace_of(output.value)` to all three paths.

**Knowledge References:**

- `attacks/value.md` — value preservation
- `taxonomy.md` CWC-004
- prior audit HIGH-3 (Intentional / penalty mechanism)

**Additional Notes:**

Carried from prior audits. The `UseBid` flow does not preserve lovelace either, but the bid UTxO is being burned, not continued; that is correct. Tracked here only for the encryption side.

---

### M-01 Off-chain-only enforcement of reference-validator trust anchor

**Severity:** Medium

**Confidence:** Suspected

**Status:** Needs Verification

**CWC ID:** CWC-005 (Missing UTxO Authentication / forged-config-utxo)

**Root Cause:** `lifecycle-off-chain-only`

**Component:** genesis.mint, lifecycle (deployment)

**Location:** [`validators/genesis.ak:34-43`](../../contracts/peace-protocol/validators/genesis.ak#L34-L43)

**Quoted Code ([`genesis.ak:34-43`](../../contracts/peace-protocol/validators/genesis.ak#L34-L43)):**

```aiken
    // construct the address of the reference contract
    expect ReferenceDatum { reference, .. }: ReferenceDatum = output_datum_data
    let reference_datum_address: Address = address.from_script(reference)
    //
    and {
      // a single token should be minted in this transaction
      assets.has_nft_strict(mint, policy_id, token_name),
      // must be sent to the reference address
      output_address == reference_datum_address,
      // script output can not have a reference script
      reference_script == None,
    }
```

**What It Is:**

The genesis policy enforces that the bootstrap output is sent to `address.from_script(reference)` where `reference: ScriptHash` is supplied as a field of the chosen `ReferenceDatum`. There is **no on-chain check** that this `reference` script hash matches the actual `validators/reference.ak` script (which is `else(_) { fail }` / always-fail). The "reference UTxO is immutable" property of the protocol depends entirely on the operator setting `reference = hash(reference.ak)` correctly at deploy time.

**Why It Is Bad — Cardano Semantic Cited:**

Validators do not run on UTxO creation, only on spend (per `attacks/state.md` lifecycle). The genesis policy can only constrain the creation tx; it cannot constrain that the *script the chosen address points to* is a deny-everything contract. If `reference` were set to a script the deployer (or a malicious supply-chain actor) controls, the reference UTxO becomes spendable under that script's terms — and once spendable, the entire `ReferenceDatum` (including `snark_vk` and all four script hashes for downstream validators) becomes mutable. Every "immutable reference datum" property cited as P8 in the prior audits collapses.

**Attack Scenario (against a mis-deployed system):**

1. Adversary controls the deployment pipeline (or convinces the operator to set `reference = hash(adversary_script)` where `adversary_script` is `else(_) { True }` or a key-controlled spend).
2. Genesis mint passes — the validator only checks the address derives from `reference`, not what code lives there.
3. Post-bootstrap, downstream validators continue to trust the genesis NFT for authentication but the reference UTxO can be moved/edited at will via `adversary_script`.
4. Adversary changes `snark_vk` (forging proofs becomes possible), or `bid` / `encryption` / `groth` script hashes (redirecting cross-validator trust), or any combination.

**Mitigating Factors:**

- The protocol deployment is one-shot; once the operator points the genesis NFT at the actual `reference.ak` script hash, the system is correct forever (no on-chain way to migrate). So the attack window is "the moment of deployment" only.
- `compile.sh` invokes `cardano-cli conway transaction policyid --script-file contracts/reference_contract.plutus > hashes/reference.hash` — the operator would naturally use the just-built hash. Off-chain operator discipline is the mitigation.
- The fixed `reference.ak` validator's `_genesis_pid` and `_genesis_tkn` are unused (`_`-prefixed) but parameterise the script hash, so the actual reference-script hash varies per (genesis_pid, genesis_tkn). That makes the "correct" hash deterministic from bootstrap.

**How To Fix:**

Two on-chain options:

1. **Eliminate the `reference` field entirely.** Pin the reference UTxO at the `groth` script hash (or any of the always-fail downstream validators) instead — anywhere where the protocol can prove on-chain that the script body is `else(_) { fail }`. Less elegant but trust-minimised.
2. **Replace the genesis policy with a tx_level_minter / parameter_validation pattern (`patterns/parameter_validation.md`)** that takes the reference-script's hash as a hardcoded parameter, eliminating the operator-supplied datum field. The parameterisation already exists for downstream validators (genesis_pid + genesis_tkn); extending it to include the reference hash closes the loophole.

Off-chain mitigation (interim):

- Add a `compile.sh` post-deploy assertion: build the reference contract first, derive its hash, then verify the bootstrap `ReferenceDatum.reference == reference_hash` before submitting the genesis mint. Keep this in a runbook.

**Tests-To-Add:**

- Negative test: build a reference UTxO at a non-fail script, confirm it can be spent / edited.
- Positive test: bootstrap with `reference = hash(reference.ak)`, confirm spend attempts on the reference UTxO fail.

**Knowledge References:**

- `attacks/state.md` — Lifecycle (validators don't run on UTxO creation) + Misconfigured config UTxO as trust anchor
- `ctf/bank_04_lifecycle.md` (analogue: lifecycle UTxO not enforced at creation)
- `ctf/bank_05_misconfiguration.md` (analogue: forged config UTxO)
- `taxonomy.md` CWC-005

**Additional Notes:**

The Phase 5d auto-finding rule asks whether to downgrade to Informational + "Not Exploitable As Written" because `genesis` *is* a one-shot policy in the target. The exception applies only when the one-shot mint **enforces** the invariant at bootstrap. Here the mint enforces consistency between the chosen `reference` and the output address, but does NOT enforce that `reference == hash(reference.ak)`. So the exception does not apply — Medium / Suspected / Needs Verification stands. Downgrade to Low (or close as Not Exploitable) only if a future revision either parameterises the reference hash or assertively tests the operator runbook.

---

### M-02 Pending TTL upper bound is 2 × expected_ttl (carried MED-1)

**Severity:** Medium

**Confidence:** Confirmed

**Status:** Design Tradeoff

**CWC ID:** CWC-006 (Time Lock Bypass — wrong-bound flavour, but here it's a *deliberately loose* upper bound)

**Root Cause:** `pending-ttl-2x-cap`

**Component:** encryption.spend (UseSnark)

**Location:** [`validators/encryption.ak:285-286`](../../contracts/peace-protocol/validators/encryption.ak#L285-L286)

**Quoted Code ([`validators/encryption.ak:285-286`](../../contracts/peace-protocol/validators/encryption.ak#L285-L286)):**

```aiken
                expected_ttl <= ttl,
                ttl <= 2 * expected_ttl,
```

**What It Is:**

The Pending-state TTL is bounded above by `2 × expected_ttl` where `expected_ttl = ub + pending_ttl (6h)`. With a maximum 1h validity window, the effective TTL range is roughly `now + 6h` to `now + 14h`.

**Why It Is Bad — Cardano Semantic Cited:**

`validity_range` is attacker-set (the ledger only enforces inclusion); a loose upper bound on `ttl` lets an owner set Pending up to 14h, blocking third-party `CancelEncryption` for that long. Owner-self-block only.

**How To Fix:**

Tighten to `ttl <= expected_ttl + slot_drift_margin` (e.g. `1.5 × expected_ttl`) if liveness is a priority; document the 2× rationale otherwise.

**Knowledge References:**

- `attacks/time.md` — wrong / loose bound
- `taxonomy.md` CWC-006
- prior audits MED-1 (Intentional)

**Additional Notes:**

Carried from prior audits.

---

### M-03 Groth16 public-input length silently truncates (carried MED-2)

**Severity:** Medium

**Confidence:** Likely

**Status:** Open

**CWC ID:** CWC-009 (Redeemer Validation Failure) — cryptographic-context sub-class

**Root Cause:** `fs-context-public-len-unbound`

**Component:** lib/types/groth.ak

**Location:** [`lib/types/groth.ak:78-116`](../../contracts/peace-protocol/lib/types/groth.ak#L78-L116) (`derive_vk_x_combined`), called from [`lib/types/groth.ak:159-207`](../../contracts/peace-protocol/lib/types/groth.ak#L159-L207) (`verify_groth16`).

**Quoted Code ([`lib/types/groth.ak:78-116`](../../contracts/peace-protocol/lib/types/groth.ak#L78-L116)):**

```aiken
fn derive_vk_x_combined(
  ic_tail: List<ByteArray>,
  public: List<Int>,
  wires: List<Int>,
  n: Int,
  acc: G1Element,
) -> G1Element {
  when ic_tail is {
    [] -> acc
    [ic_i, ..rest_ic] -> {
      let pt = bls12_381_g1_uncompress(ic_i)
      if n > 0 {
        when public is {
          [] -> fail @"public shorter than vkIC"
          [s, ..rest_pub] ->
            derive_vk_x_combined(
              rest_ic,
              rest_pub,
              wires,
              n - 1,
              bls12_381_g1_add(acc, bls12_381_g1_scalar_mul(s, pt)),
            )
        }
      } else { ... }
    }
  }
}
```

**What It Is:**

`derive_vk_x_combined` consumes `vk.nPublic - 1` IC entries against `public`, then switches to `wires`. If `public` has more elements than `n_raw_public`, the recursion terminates when `ic_tail` runs out and the extras are silently ignored. If shorter, the function fails with `"public shorter than vkIC"`. The asymmetry is the bug.

**Why It Is Bad — Cardano Semantic Cited:**

In a Fiat-Shamir / SNARK-public-input context, silent truncation is an under-constrained verifier: a future change that exposes `groth_public` to user influence (e.g. multi-statement verification, batched proofs, or any redeemer extension) becomes silently unsafe. Today the binding is anchored elsewhere (`verify_limb_compression` requires exactly 36 ints arranged into 3 G1 points), so over-provision still fails the limb-compression check. But that pinning is not co-located with the SNARK verifier — it lives in a different module and depends on a downstream caller's discipline.

**How To Fix:**

In `verify_groth16`, immediately after computing `n_raw_public`:

```aiken
let n_raw_public = vk.nPublic - 1
expect n_raw_public == list.length(public)
```

…or have `derive_vk_x_combined` return `(G1Element, List<Int>)` and at the top level `expect [] = leftover_public`.

**Mitigating Factors:**

- `verify_limb_compression` (called from `encryption.UseEncryption`) requires `groth_public` to compress to exactly 3 G1 points (36 u64 limbs). Extra elements past 36 are also dropped by `take6 ; take6 ; ...` in limb_compression.ak, but a mismatch between the compressed-points count and the SNARK's expected `n_raw_public` would surface as a pairing-check failure.
- The VK is immutable in the reference datum (subject to M-01). Without M-01 risk, the SNARK statement is fixed at deploy time.

**Tests-To-Add:**

- Negative test: call `verify_groth16` with `public` of length `n_raw_public + 1`. Expected (post-fix): fail with a length-check error. Today: unexpectedly passes the truncation, may still fail on the pairing check.

**Knowledge References:**

- `attacks/replay.md` — payload-binding rules
- `taxonomy.md` CWC-009
- prior audits MED-2 (still open per developer's interest)

**Additional Notes:**

Carried.

---

### L-01 No protocol-specific min-ADA constraints (carried LOW-1)

**Severity:** Low

**Confidence:** Confirmed

**Status:** Design Tradeoff

**CWC ID:** CWC-028 (Missing Protocol Enforcement)

**Root Cause:** `min-ada-not-enforced`

**Component:** encryption.mint, bidding.mint, genesis.mint

**Location:** all mint handlers ([`encryption.ak:28-87`](../../contracts/peace-protocol/validators/encryption.ak#L28-L87), [`bidding.ak:24-89`](../../contracts/peace-protocol/validators/bidding.ak#L24-L89), [`genesis.ak:14-50`](../../contracts/peace-protocol/validators/genesis.ak#L14-L50)).

**Quoted Code:** N/A — feature absence (no `assets.lovelace_of(o.value) >= protocol_min` check anywhere).

**What It Is:**

The mint handlers verify datum, NFT, and address but do not enforce a protocol-specific minimum ADA on outputs. The Cardano ledger enforces a per-UTxO min-ADA based on the value's serialized size, which scales with datum + value complexity.

**Why It Is Bad — Cardano Semantic Cited:**

The ledger already enforces a minimum, so this is not an exploit; the only protocol-design implication is that the validator cannot reject a UTxO that is exactly at min-ADA but the protocol wants more (e.g. a deposit floor).

**How To Fix:**

If a deposit floor is desired, add `assets.lovelace_of(output.value) >= protocol_min` in the mint output check.

**Knowledge References:**

- `optimizations/ledger_invariants.md` — min-ADA already enforced
- `taxonomy.md` CWC-028
- prior audits LOW-1 (Intentional)

**Additional Notes:**

Carried from prior audits.

---

### L-02 `aiken/collection/list.{has, filter}` import in bidding (carried LOW-2)

**Severity:** Low

**Confidence:** Confirmed

**Status:** Design Tradeoff

**CWC ID:** CWC-030 (Code Quality / size)

**Root Cause:** `stdlib-redflag-list-filter`

**Component:** bidding.spend, bidding.mint

**Location:** [`validators/bidding.ak:5`](../../contracts/peace-protocol/validators/bidding.ak#L5), [`validators/bidding.ak:162-168`](../../contracts/peace-protocol/validators/bidding.ak#L162-L168), [`validators/bidding.ak:175-181`](../../contracts/peace-protocol/validators/bidding.ak#L175-L181).

**Quoted Code ([`validators/bidding.ak:5`](../../contracts/peace-protocol/validators/bidding.ak#L5)):**

```aiken
use aiken/collection/list.{has}
```

**What It Is:**

The bidding validator imports `aiken/collection/list` (`has` and `filter`); the encryption validator inlines its own `has` and avoids the import. Per the project's optimization history, similar inlines have shaved 20–32 % off other validators' compiled sizes.

**Why It Is Bad — Cardano Semantic Cited:**

`list.filter` allocates a new list; `list.has` traverses the full input. Both add UPLC bytecode that contributes to script size and per-tx CPU/mem. Not a security concern.

**How To Fix:**

Inline `has` (1-line tail-recursion) and replace `list.filter(input_pred)` with bespoke recursion that early-exits at exactly-one (since both call sites are bound by `expect [_]`).

**Knowledge References:**

- `optimizations/stdlib_red_flags.md` — `list.filter` red-flag table
- `taxonomy.md` CWC-030
- prior audits LOW-2 (skipped — fits on-chain)

**Additional Notes:**

If size budgets become tight, inline `has` and replace `list.filter(input_pred)` with bespoke recursion (`fn count_inputs_at(...)`). See `optimizations/aiken_optimization_guide.md`.

---

### L-03 Owner self-drain of lovelace on `Update*Price` (carried LOW-3)

**Severity:** Low

**Confidence:** Confirmed

**Status:** Design Tradeoff

**CWC ID:** CWC-004 (narrow)

**Root Cause:** `lovelace-not-preserved` (same family as H-04)

**Component:** encryption.spend (UpdateEncryptionPrice), bidding.spend (UpdateBidPrice)

**Location:** [`validators/encryption.ak:338-373`](../../contracts/peace-protocol/validators/encryption.ak#L338-L373), [`validators/bidding.ak:196-228`](../../contracts/peace-protocol/validators/bidding.ak#L196-L228).

**Quoted Code ([`validators/bidding.ak:208-228`](../../contracts/peace-protocol/validators/bidding.ak#L208-L228)):**

```aiken
              // ensure non-ADA tokens are preserved
              let input_tokens =
                this_input.output.value |> assets.without_lovelace
              let output_tokens = output_value |> assets.without_lovelace
              //
              and {
                price >= 0,
                output_datum_data == expected_output_datum_data,
                input_tokens == output_tokens,
                has(extra_signatories, owner_vkh),
                Script(this_script) == payment_credential,
                reference_script == None,
                assets.has_nft(this_input.output.value, this_script, pointer),
              }
```

**What It Is:**

`UpdateBidPrice` / `UpdateEncryptionPrice` enforce non-ADA token equality (`without_lovelace` of input == output) but do not constrain lovelace. The owner — required to sign — may decrease lovelace down to ledger-level min-ADA on the continuing UTxO.

**Why It Is Bad — Cardano Semantic Cited:**

Same as H-04: the ledger does not impose value preservation; if the validator does not, ADA can be diverted at output construction. Here, only the owner can do so on themselves (signed path), which is the same policy as H-04.

**How To Fix:**

If the H-04 penalty-mechanism policy is to be retained, no action. Otherwise add `assets.lovelace_of(input.value) <= assets.lovelace_of(output.value)` to both Update paths.

**Knowledge References:**

- `attacks/value.md` — value preservation
- `taxonomy.md` CWC-004
- prior audit LOW-3 (new in 2026-04-20)

**Additional Notes:**

Carried from the 2026-04-20 audit. Owner-only self-drain; if accepted under H-04 policy no action.

---

### I-01 Build artifact stale: `aiken.toml` v0.5.3 vs `plutus.json` preamble v0.4.3

**Severity:** Informational

**Confidence:** Confirmed

**Status:** Open

**CWC ID:** CWC-030

**Root Cause:** `build-artifact-stale`

**Component:** repo metadata

**Location:** [`aiken.toml:2`](../../contracts/peace-protocol/aiken.toml#L2), [`plutus.json:5`](../../contracts/peace-protocol/plutus.json#L5).

**Quoted Code:**

```toml
# aiken.toml
version = "0.5.3"
```

```json
// plutus.json
"version": "0.4.3",
```

**What It Is:**

`plutus.json` preamble version `0.4.3` lags `aiken.toml` `0.5.3`. Re-run `aiken build` and re-commit `plutus.json`. The compiler hash (`v1.1.21+42babe5`) is consistent.

**How To Fix:**

`aiken build` with the current source, re-commit `plutus.json` and `hashes/*.hash`.

**Knowledge References:**

`audit.prompt.improved` Phase 0 build-artifact freshness rule; `audit_checklist.md` build hygiene.

---

### I-02 Test fixtures cannot construct adversarial Address / Output variants

**Severity:** Informational

**Confidence:** Confirmed

**Status:** Open

**CWC ID:** CWC-030

**Root Cause:** `fixture-stuck-at-default`

**Component:** lib/tests/util.ak, lib/tests/search.ak

**Location:** [`lib/tests/util.ak:17-28`](../../contracts/peace-protocol/lib/tests/util.ak#L17-L28), [`lib/tests/search.ak:29-40`](../../contracts/peace-protocol/lib/tests/search.ak#L29-L40).

**Quoted Code ([`lib/tests/util.ak:17-28`](../../contracts/peace-protocol/lib/tests/util.ak#L17-L28)):**

```aiken
fn mk_addr() -> Address {
  address.from_script(dummy_pid)
}

fn mk_output() -> Output {
  Output {
    address: mk_addr(),
    value: assets.from_lovelace(2),
    datum: NoDatum,
    reference_script: None,
  }
}
```

**What It Is:**

`mk_addr` calls `address.from_script(pid)`, which yields an Address with `stake_credential = None`. No fixture in the suite ever constructs `stake_credential = Some(Inline(Script(_)))` or `Some(Inline(VerificationKey(_)))`. Likewise, no fixture ever attaches a `reference_script: Some(_)` to an output. Therefore no test in the suite can detect bugs that surface only when the field varies (notably H-01 stake-credential hijack, but also any future reference-script-bloat concern). Compounded by the fact that the suite has no validator-level integration tests at all (no `Transaction { ... }` fixtures) — only library-level helpers — so even if the helpers had variance, nothing would exercise the validators end-to-end.

**Why It Is Bad — Cardano Semantic Cited:**

A test suite is only as adversarial as its fixtures allow. `address.from_script(pid)` produces the canonical "no-stake" address; production builders may produce any `stake_credential` and the validator must constrain that explicitly. Without fixtures that vary the field, any future bug at this level escapes detection.

**How To Fix:**

Add fixture variants for `stake_credential ∈ {None, Some(Inline(Script(_))), Some(Inline(VerificationKey(_))), Some(Pointer(_))}` and `reference_script ∈ {None, Some(_)}`. Use them in validator-level integration tests for every output-emitting redeemer.

**Knowledge References:**

`audit.prompt.improved` Phase 7c variance audit.

**Additional Notes:**

Cross-link: this is the missing test that would have caught H-01.

---

### I-03 Insufficient `bench` coverage for hot-path redeemers

**Severity:** Informational

**Confidence:** Confirmed

**Status:** Open

**CWC ID:** CWC-030

**Root Cause:** `bench-coverage-missing`

**Component:** all validators

**Location:** target tree contains zero `bench` blocks (`grep -nE '^bench\s+'` returns 0 hits) and no `bench/` directory.

**Quoted Code:** n/a — feature absence.

**What It Is:**

No baseline benchmarks exist for any redeemer. The Aiken optimization guide (`aiken_optimization_guide.md` #1) requires baseline benchmarks before any optimization claim, and the audit prompt requires them before any optimization finding.

**How To Fix:**

Add at least one `bench` block per redeemer with a realistic context. The §17 per-redeemer-constructor table is the source of truth — every "No" in `Bench?` must appear as a checkbox below.

**Tests-To-Add:**

- Benchmark
  - [ ] `bench encryption__EntryEncryptionMint__schnorr_plus_binding_plus_first_level` (low-N realistic context)
  - [ ] `bench encryption__EntryEncryptionMint__worst_case_datum_size`
  - [ ] `bench encryption__RemoveEncryption__nft_present`
  - [ ] `bench encryption__UseEncryption__limb_compression_plus_r5_plus_add_new_half_level` (low-N realistic context)
  - [ ] `bench encryption__UseEncryption__worst_case_datum_size`
  - [ ] `bench encryption__UseSnark__pending_write` (low-N)
  - [ ] `bench encryption__CancelEncryption__owner_signed`
  - [ ] `bench encryption__CancelEncryption__ttl_expired_permissionless`
  - [ ] `bench encryption__UpdateEncryptionPrice__price_change`
  - [ ] `bench encryption__LeaveEncryptionBurn__burn_check`
  - [ ] `bench bidding__EntryBidMint__schnorr_plus_lock` (low-N)
  - [ ] `bench bidding__EntryBidMint__worst_case_datum_size`
  - [ ] `bench bidding__RemoveBid__lock_expired`
  - [ ] `bench bidding__UseBid__paired_with_use_encryption` (low-N)
  - [ ] `bench bidding__UpdateBidPrice__price_change`
  - [ ] `bench bidding__LeaveBidBurn__burn_check`
  - [ ] `bench groth__withdraw__verify_groth16_low_n`
  - [ ] `bench groth__withdraw__verify_groth16_high_n` (worst-case `nPublic`)
  - [ ] `bench groth__publish__register_credential`
  - [ ] `bench genesis__mint__one_shot_bootstrap`

**Knowledge References:**

`optimizations/aiken_optimization_guide.md` #1 (Benchmark First); `audit.prompt.improved` Phase 7b bench-coverage aggregation.

---

### I-04 Groth withdraw redeemer has no per-tx domain binding (binding deferred to `UseSnark` + `UseEncryption`)

**Severity:** Informational

**Confidence:** Suspected

**Status:** Design Tradeoff

**CWC ID:** CWC-009 (cryptographic-context sub-class)

**Root Cause:** `fs-context-deferred-binding`

**Component:** groth.withdraw, encryption.UseSnark / UseEncryption

**Location:** [`validators/groth.ak:15-34`](../../contracts/peace-protocol/validators/groth.ak#L15-L34), [`validators/encryption.ak:244-299`](../../contracts/peace-protocol/validators/encryption.ak#L244-L299) (UseSnark), [`validators/encryption.ak:201-241`](../../contracts/peace-protocol/validators/encryption.ak#L201-L241) (UseEncryption).

**Quoted Code ([`validators/groth.ak:15-34`](../../contracts/peace-protocol/validators/groth.ak#L15-L34)):**

```aiken
  withdraw(redeemer: GrothWitnessRedeemer, _credential, self: Transaction) {
    let GrothWitnessRedeemer { groth_proof, groth_commitment_wire, groth_public, .. } = redeemer
    let Transaction { reference_inputs, .. } = self
    let ReferenceDatum { snark_vk, .. }: ReferenceDatum =
      search.for_reference_datum(reference_inputs, genesis_pid, genesis_tkn)
    groth.verify_groth16(
      snark_vk,
      groth_proof,
      groth_public,
      [groth_commitment_wire |> scalar.from_bytes |> scalar.to_int],
    )
  }
```

**What It Is:**

The Groth withdraw verifies `verify_groth16(snark_vk, proof, public, [commitment_wire_scalar])`. Nothing in the FS preimage at this layer binds the proof to (a) a specific encryption UTxO, (b) any tx output, (c) the validity range, (d) the signer / owner_vkh, (e) any mint set. Binding to a specific encryption is established later by `UseSnark` (which stores the proof in a `Pending(proof, public, ttl)` datum on a specific encryption UTxO), and binding to the recipient is established at `UseEncryption` time by `verify_limb_compression(bid_owner_g1.public_value, witness, next_half_level.r2_g1b, groth_public)`.

**Why It Is Bad — Cardano Semantic Cited:**

The pattern is sound *as long as*:

1. The only spend redeemer that produces `Pending(proof, public, ttl)` is `UseSnark` (which co-fires with the withdraw).
2. The only consumer of `Pending` is `UseEncryption` (which re-binds via limb compression and `verify_commitments`).

Both are true today. But the pattern is fragile to future protocol extension: any new redeemer that emits `Pending` without going through `UseSnark`, or any new redeemer that consumes `Pending` without re-binding via limb compression, would silently allow proof reuse across encryption UTxOs. The Groth withdraw script alone has no domain tag / statement-ID / context bytes that would prevent the same proof from being applied to multiple encryption transitions in the same tx — only the per-encryption Pending storage prevents this.

**How To Fix (defense in depth, not currently exploitable):**

- Add a domain tag and a statement-ID to the Fiat-Shamir transcript inside the SNARK circuit (off-chain change, requires SRS re-generation).
- Document the invariant in code comments: "Only `UseSnark` may set `status = Pending(proof, public, ttl)`. Only `UseEncryption` may consume `Pending`. Both rely on the proof being verified at the same-tx Groth withdraw."

**Tests-To-Add:**

- Negative test: build a tx with two `UseSnark` calls on two different encryption UTxOs, both consuming the same Groth withdraw redeemer. Confirm both bind to their own encryption — actually OK, but the test documents the invariant.

**Knowledge References:**

`attacks/replay.md` — payload-binding rules; `taxonomy.md` CWC-009; `audit.prompt.improved` §5g.

**Additional Notes:**

This is a documentation / future-proofing concern, not a present exploit. Recorded so that any future cryptographic-context expansion (a second SNARK statement, batch verification, etc.) inherits the constraint.

---

### I-05 `new_price` is advisory, not payment-enforcing (carried INFO-1)

**Severity:** Informational

**Confidence:** Confirmed

**Status:** Design Tradeoff

**CWC ID:** CWC-028

**Root Cause:** `off-chain-only-pricing`

**Component:** encryption.spend, bidding.spend

**Location:** [`lib/types/encryption.ak:37`](../../contracts/peace-protocol/lib/types/encryption.ak#L37), [`lib/types/bidding.ak:19`](../../contracts/peace-protocol/lib/types/bidding.ak#L19), [`validators/bidding.ak:196-228`](../../contracts/peace-protocol/validators/bidding.ak#L196-L228), [`validators/encryption.ak:338-373`](../../contracts/peace-protocol/validators/encryption.ak#L338-L373).

**Quoted Code ([`lib/types/bidding.ak:13-20`](../../contracts/peace-protocol/lib/types/bidding.ak#L13-L20)):**

```aiken
pub type BidDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  pointer: AssetName,
  token: AssetName,
  locked_until: Int,
  new_price: Int,
}
```

**What It Is:**

`new_price` is a datum field but is not bound to the bid UTxO's lovelace. A buyer can declare any `new_price` while placing arbitrary lovelace.

**Why It Is Bad — Cardano Semantic Cited:**

The on-chain encryption flow only checks `bid_new_price == next_new_price`; it does not check `bid_new_price == lovelace_of(bid_input.value)`. Off-chain UIs must therefore present "bid amount" (lovelace) and "declared resale price" (`new_price`) separately.

**How To Fix:**

Either (a) bind `new_price` to lovelace at mint (`assets.lovelace_of(output.value) >= new_price`), or (b) document the off-chain semantics in the README and any external integrator docs.

**Knowledge References:**

- `attacks/value.md` — value enforcement
- `taxonomy.md` CWC-028
- prior audit INFO-1 (advisory)

**Additional Notes:**

Carried; UIs must distinguish "bid amount" (lovelace) from "declared resale price" (`new_price`).

---

### I-06 Bidder may self-lock for arbitrary duration (carried INFO-2)

**Severity:** Informational

**Confidence:** Confirmed

**Status:** Open

**CWC ID:** CWC-028

**Root Cause:** `lock-upper-bound-missing`

**Component:** bidding.mint

**Location:** [`validators/bidding.ak:62-66`](../../contracts/peace-protocol/validators/bidding.ak#L62-L66).

**Quoted Code ([`validators/bidding.ak:62-66`](../../contracts/peace-protocol/validators/bidding.ak#L62-L66)):**

```aiken
        let lock_is_valid: Bool =
          when validity_range.upper_bound.bound_type is {
            Finite(ub) -> locked_until >= ub + bidding.minimum_bid_lock
            _ -> False
          }
```

**What It Is:**

`EntryBidMint` enforces a *lower* bound on `locked_until` (must be at least `ub + 6h`) but no upper bound. A bidder may self-lock for years.

**Why It Is Bad — Cardano Semantic Cited:**

`RemoveBid` requires `lb > locked_until` strictly. With no upper bound on `locked_until`, an extreme value (e.g., `i64::MAX`) renders the bid permanently irremovable. Pure self-griefing — no third-party attack surface.

**How To Fix:**

Add a sanity bound, e.g. `locked_until <= ub + 30 * 24 * 60 * 60 * 1000` (30 days).

**Knowledge References:**

- `attacks/time.md` — bound usage
- `taxonomy.md` CWC-028
- prior audit INFO-2

**Additional Notes:**

Carried; only self-griefing.

---

### I-07 Bid time-lock partially mitigates the OBS-1 griefing window (carried INFO-3)

**Severity:** Informational

**Confidence:** Confirmed

**Status:** Design Tradeoff

**CWC ID:** CWC-006

**Root Cause:** `obs1-residual-window`

**Component:** encryption ↔ bidding interaction

**Location:** entire `UseSnark` → `UseEncryption` flow.

**Quoted Code ([`validators/bidding.ak:127-130`](../../contracts/peace-protocol/validators/bidding.ak#L127-L130)):**

```aiken
                let lock_expired: Bool =
                  when validity_range.lower_bound.bound_type is {
                    Finite(lb) -> lb > locked_until
                    _ -> False
                  }
```

**What It Is:**

The 6-hour `minimum_bid_lock` (matching `pending_ttl`) reduces, but does not eliminate, the OBS-1 griefing scenario where Bob removes his bid while Alice is still in Pending. There remains a residual window equal to the time elapsed between Bob's bid mint and Alice's `UseSnark` during which Bob's `locked_until` may have expired but Alice's `ttl` has not.

**Why It Is Bad — Cardano Semantic Cited:**

Cross-validator cooperation is voluntary; either party may stop participating. Alice retains the ability to self-`CancelEncryption` (signed path), so the worst-case cost is one extra transaction fee.

**How To Fix:**

If the residual griefing matters, parameterise `locked_until ≥ ub + max(minimum_bid_lock, 2 × pending_ttl)` so Bob's lock outlives Alice's worst-case Pending. Otherwise document the partial mitigation.

**Knowledge References:**

- `attacks/time.md` — bound usage
- `taxonomy.md` CWC-006
- prior audit OBS-1 / INFO-3

**Additional Notes:**

Carried; Bob can still `RemoveBid` during a small window after his `locked_until` expires while Alice is still Pending. Alice retains self-cancel ability.

---

### I-08 `compile.sh` token-name builder may diverge from `util.construct_token_name` for `tx_idx ≥ 24`

**Severity:** Informational

**Confidence:** Suspected

**Status:** Needs Verification

**CWC ID:** CWC-030

**Root Cause:** `off-chain-token-name-cbor-mismatch`

**Component:** compile.sh

**Location:** [`compile.sh:36-41`](../../contracts/peace-protocol/compile.sh#L36-L41).

**Quoted Code:**

```bash
genesis_tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${genesis_tx_idx});print(encoded.hex())")
genesis_token_name=$(python3 -c "tkn='${genesis_tx_idx_cbor}' + '${genesis_tx_id}';print(tkn[0:64])")
```

**What It Is:**

The off-chain builder concatenates the CBOR-encoded `tx_idx` with the raw `tx_id` hex (then truncates to 64 hex chars / 32 bytes) to derive `genesis_token_name`. The on-chain version (`util.construct_token_name(id, idx) = id |> bytearray.push(idx) |> bytearray.slice(0, 31)`) prepends a single byte for `idx`. These match only when CBOR encodes the integer as a single byte — i.e., for `tx_idx ∈ [0, 23]` (CBOR major-type-0 with `0x00`–`0x17`). For `tx_idx ∈ [24, 255]`, CBOR emits `0x18 NN` (two bytes), shifting the on-chain vs off-chain hex by one byte. The genesis policy checks `assets.has_nft_strict(mint, policy_id, token_name)` where `token_name` is derived on-chain via `util.construct_token_name` — so a mismatch causes the on-chain hash to disagree with the operator's pre-computed `genesis_token_name`, surfacing as a deploy-time hash mismatch (downstream parameterised hashes are wrong).

**How To Fix:**

Either:

1. Constrain `tx_idx ∈ [0, 23]` in the deploy runbook (low-cost, cheap to enforce).
2. Replace the Python one-liner with one that mirrors `bytearray.push`: `tkn = bytes([tx_idx]).hex() + tx_id_hex; tkn[:64]` (assumes `0 <= tx_idx <= 255`).

**Knowledge References:**

`audit.prompt.improved` Phase 8 builder review; this is an off-chain hygiene concern.

**Additional Notes:**

This is a deploy-time bug that fails loudly (no protocol UTxOs would mint), not a runtime exploit. Suspected because not actively reproduced.

---

### O-01 No baseline benchmarks for any redeemer

**Severity:** Optimization

**Confidence:** Confirmed

**Status:** Optimization Opportunity

**CWC ID:** CWC-030

**Root Cause:** `bench-coverage-missing` (same root as I-03)

**Component:** all validators

**Location:** target contains no `bench` blocks.

**Quoted Code:** n/a.

**What It Is:**

The aiken_optimization_guide pattern #1 ("Benchmark First") requires a baseline cost (`mem` and `cpu`) for every handler before optimizing. None exist. **No baseline; benchmark before/after required for any future optimization claim.**

**Expected Benefit:**

Visibility into per-redeemer cost; catches regressions; substantiates any future "list-import-removal saves N bytes" claim (carried L-02).

**Risk:**

None on its own — adding benchmarks is purely additive. Risk applies only to subsequent optimization work derived from these baselines.

**How To Fix:**

See I-03 Tests-To-Add checklist; the same set of bench blocks satisfies both.

**Knowledge References:**

`optimizations/aiken_optimization_guide.md` #1.

---

## 9. Hyperstructure Review

| Location | Pattern | 4-Criteria Check | Classification | Recommendation |
|---|---|---|---|---|
| [`reference.ak:12-14`](../../contracts/peace-protocol/validators/reference.ak#L12-L14) | `else(_) { fail @"I always fail :/" }` | (1) no admin yes, (2) immutable yes, (3) permissionless deposit yes (anyone can target the address), (4) open egress n/a (always-fail by design — irrelevant) | Safe and intentional (always-fail storage) | Document the role; add the M-01 trust-anchor guarantee. |
| [`encryption.ak:139-142`](../../contracts/peace-protocol/validators/encryption.ak#L139-L142) | `if is_holding_token { ... } else { True }` (RemoveEncryption) | (1) yes, (2) yes, (3) yes, (4) yes (open egress for non-NFT UTxOs) | Acceptable but under-documented (carried HIGH-2 / Intentional) | Add a code-comment "hyperstructure: any non-NFT UTxO at this address is sweepable." |
| [`bidding.ak:140-143`](../../contracts/peace-protocol/validators/bidding.ak#L140-L143) | same | same | same | same |
| [`encryption.ak:375-381`](../../contracts/peace-protocol/validators/encryption.ak#L375-L381) | `if this_datum is EncryptionDatum { ... } else { True }` + `None -> True` | (1) yes, (2) yes, (3) yes, (4) yes (open egress for bad-/no-datum UTxOs) | Acceptable but under-documented (carried HIGH-1 / Intentional) | Same. |
| [`bidding.ak:231-237`](../../contracts/peace-protocol/validators/bidding.ak#L231-L237) | same | same | same | same |
| [`genesis.ak:47-49`](../../contracts/peace-protocol/validators/genesis.ak#L47-L49), [`groth.ak:49-51`](../../contracts/peace-protocol/validators/groth.ak#L49-L51), [`encryption.ak:384-386`](../../contracts/peace-protocol/validators/encryption.ak#L384-L386), [`bidding.ak:240-242`](../../contracts/peace-protocol/validators/bidding.ak#L240-L242) | `else(_) { fail }` catch-all | n/a (deny-by-default) | Safe and intentional | DEAD-END — not a finding. |
| `_ -> False` deny-by-default in `when` arms ([`bidding.ak:65`](../../contracts/peace-protocol/validators/bidding.ak#L65), [`bidding.ak:129`](../../contracts/peace-protocol/validators/bidding.ak#L129), [`groth.ak:45`](../../contracts/peace-protocol/validators/groth.ak#L45), [`encryption.ak:319`](../../contracts/peace-protocol/validators/encryption.ak#L319)) | `_ -> False` | n/a (deny-by-default) | Safe and intentional | DEAD-END — not a finding. |

The five hyperstructure escapes (3 in encryption.ak + 2 in bidding.ak counted as a class) all satisfy the four `hyperstructure.md` criteria, modulo "permissionless deposit" being trivially true (anyone can mis-deposit at any script address). They are correctly classified as Acceptable but under-documented.

---

## 10. Singleton & Twin UTxO Analysis

| Singleton claim | Where assumed | Enforcement | Auth Anchor | Comments |
|---|---|---|---|---|
| Exactly one ReferenceDatum UTxO | every `search.for_reference_datum` call | first-match by `(genesis_pid, genesis_tkn)`; one-shot mint guarantees single existence | genesis NFT | Sound. |
| Exactly one encryption UTxO per token | `for_output_by_token` returning a unique match | NFT uniqueness via `assets.has_nft_strict(qty == 1)` + token-name from spent input | encryption NFT (per-token) | Sound. |
| Exactly one bid UTxO per token | `for_output_by_token` in bidding.spend | same | bidding NFT (per-bid) | Sound. |
| Exactly one encryption input in `UseBid` | `expect [_] = list.filter(...)` | strict-list assertion | payment_credential filter | The filter ignores `stake_credential` (§5f / H-01); NFT uniqueness still anchors per-token, so this is not a twin-bank hazard for the protocol itself. |
| Exactly one bid input in `UseBid` | same | same | same | same |

No twin-protocol-UTxO hazard is present (NFT uniqueness via `has_nft_strict` and deterministic token names from `OutputReference` is rock-solid). The §5f stake-credential perimeter is the only concern.

---

## 11. Lifecycle / UTxO-Creation Analysis

Spend validators don't run on UTxO creation. Per validator:

| Validator | Creation Path | Enforces Initial Invariant? | Enforcer (on-chain / off-chain / both) | Finding ID |
|---|---|---|---|---|
| Reference UTxO | one-shot via genesis mint | Partially. Genesis enforces output address derivation + datum shape + NFT mint, but does NOT enforce `reference == hash(reference.ak)`. | both — genesis mint + operator runbook | M-01 |
| Encryption UTxO | `EntryEncryptionMint` | Yes — datum, NFT, schnorr, binding, level-1, signer, address (payment_credential only) | on-chain | (none — except H-01 stake-cred) |
| Bid UTxO | `EntryBidMint` | Yes — datum, NFT, schnorr, register, encryption-existence ref-input, lock, signer | on-chain | (none — except H-01) |
| Groth Withdraw "UTxO" | n/a (stake script) | n/a — withdraw runs once per tx, no UTxO created | n/a | n/a |
| Genesis UTxO (the seed) | spent during bootstrap | n/a — destroyed at bootstrap | n/a | n/a |

The Phase 5d auto-finding rule's exception "if the off-chain enforcer is a one-shot mint policy that *is* in the target and runs once at bootstrap, downgrade to Informational" was considered for the Reference row: the genesis IS in target and IS one-shot, BUT it does not enforce the invariant we care about (reference-script-hash = always-fail). So M-01 stays Medium / Suspected / Needs Verification (not downgraded).

---

## 12. Mint ↔ Spend Coupling Matrix

| Policy | Asset | Action | Spend Validator | Redeemer | Coupling Enforcement |
|---|---|---|---|---|---|
| genesis | `(genesis_pid, genesis_tkn)` | mint (one-shot) | reference (always-fail; cannot be spent) | n/a | One-shot OutputReference consumption; no further mint. ✓ |
| encryption | encryption NFT (per-token) | mint (`EntryEncryptionMint`) | encryption.spend (state-machine) | n/a | NFT lands in continuing UTxO; spend later transitions/burns. ✓ |
| encryption | (existing) | burn (`LeaveEncryptionBurn`) | encryption.spend.RemoveEncryption | RemoveEncryption | spend asserts `no_output_holds_token`; burn-redeemer requires exact `[(p,t,-1)]`. ✓ |
| bidding | bid NFT (per-bid) | mint (`EntryBidMint`) | bidding.spend (lifecycle) | n/a | NFT lands in continuing UTxO + encryption-existence ref-input. ✓ |
| bidding | (existing) | burn (`LeaveBidBurn`) | bidding.spend.{RemoveBid, UseBid} | RemoveBid / UseBid | RemoveBid asserts `no_output_holds_token` + lock; UseBid asserts `no_output_holds_token` + cross-validator UseEncryption. ✓ |

No row has unenforced coupling.

---

## 13. Replay / Off-Chain Signature Analysis

Not applicable — no `verify_ed25519_signature` calls and no cheque pattern in target. Authorization is via standard Cardano `extra_signatories` plus BLS-side Schnorr proofs (covered in §5g and §17 of the prior baseline audit). The `nonce` field in `Capsule` is an AEAD nonce (off-chain crypto context), not a transaction-level nonce.

Phase 5e payload table is intentionally empty for this target.

---

## 14. Cross-Validator Coherence

| Dependency | Side that fires together | Side that creates UTxO | Side that terminates UTxO | Off-chain-only enforcement? | Finding |
|---|---|---|---|---|---|
| Genesis ↔ Reference | Genesis mint creates the Reference UTxO | Genesis (mint policy) | n/a (always-fail) | **YES — `reference` field is operator-supplied** | M-01 |
| Reference UTxO ↔ Encryption / Bidding / Groth | downstream validators read via `search.for_reference_datum(genesis_pid, genesis_tkn)` | Reference at bootstrap | n/a | none — once correctly bootstrapped | (none) |
| Encryption ⇆ Bidding (`UseEncryption ⇆ UseBid`) | both fire in same tx; each reads the other's spend redeemer | NFT mints | RemoveEncryption / RemoveBid burns | none | (none — bidirectional auth) |
| Encryption ⇆ Groth (`UseSnark ⇆ withdraw`) | UseSnark commits proof from withdraw redeemer to Pending datum | encryption is the consumer | groth doesn't terminate any UTxO | none | I-04 (defense-in-depth) |

---

## 15. Oracle Authentication & Freshness

The protocol has one config UTxO (the Reference) and no external oracles. Per Phase 0 / §3.7:

| Reference input | Authenticated by NFT? | One-shot policy? | Authenticated by parameter address? | Freshness checked? |
|---|---|---|---|---|
| Reference UTxO | yes — `(genesis_pid, genesis_tkn)` via `search.for_input_by_token` (strict NFT) | yes — genesis is one-shot | partially — downstream validators are parameterised by `(genesis_pid, genesis_tkn)`; the reference SCRIPT HASH itself is operator-supplied (M-01) | n/a — config is meant to be static |

**Freshness is not relevant** because the reference datum is meant to be immutable. M-01 is the conditional caveat.

---

## 16. Optimization Review

**Baseline benchmark presence: NO.** Zero `bench` blocks in the target tree. Every optimization observation here carries the "no baseline; benchmark before/after required" caveat.

| ID | Optimization | Component | Expected Benefit | Risk | File:Line |
|---|---|---|---|---|---|
| O-01 | Add baseline benchmarks for every redeemer | all validators | Visibility, prevents future regressions | None (additive) | (no bench blocks) |

The 21-rule guide and 12-helper red-flag list were applied:

- **Rule #1 Benchmark First** — fail (O-01).
- **Rule #2 `const`** — pass (`pending_ttl`, `snark_validity_window`, `minimum_bid_lock`, BLS Wang constants are all `const`).
- **Rule #3 Fail Fast** — pass (no `if-then-else` rescue patterns observed; `expect` used for shape assertions).
- **Rule #4 Use Simpler Structures** — pass (records used appropriately; no transient large structs).
- **Rule #5 Fast Recursion For Infallible Searches** — partial (`search.for_reference_datum` uses a Fortuna-style `expect Some(...) = for_input_by_token(...)`; the `for_input_by_token` itself returns `Option<Input>` — could be made fail-fast for the reference-datum path, but the current shape is intentional to allow Option-returning at the underlying helper).
- **Rule #20 Don't Compute, Verify** — pass on the SNARK (witness verified, never recomputed); pass on the Wang–Cao levels (pairings verify a redeemer-supplied tuple).
- **`stdlib_red_flags.md` 12-helper table** — `assets.flatten` (×2 in mint burn-shape check, bounded; acceptable). `list.has` and `list.filter` (×3 in bidding.ak — carried L-02). No `dict.*`, no `list.sort`, no `list.count`, no `list.flat_map`, no `list.zip`, no `list.reverse`, no `list.length`+`list.filter` combo.
- **`ledger_invariants.md`** — no flags (the protocol does not duplicate any of the 12 already-enforced ledger invariants).

No optimization findings beyond O-01 (which is the precondition for any further optimization claim).

---

## 17. Test Coverage Review

**Total tests:** 86 (per prior audit re-confirmed at audit time; structure unchanged). All library-level. Zero validator-level integration tests. Zero benchmarks.

### 16-Row Matrix

| Test Area | Present? | Notes |
|---|---|---|
| Happy-path for each redeemer | **No** | Library tests exercise crypto helpers, not validators. |
| Negative tests per critical check | **Partial** | 30 `fail` tests at library level (Schnorr forgery, R5 swap, register validity, `for_reference_datum` failure modes, etc.). No validator-level negative tests. |
| Property/fuzz tests over Value / Datum | **No** | No `via fuzz.` usage. |
| Double-satisfaction tx shapes | **No** | No multi-input tx fixtures. |
| Datum mutation | **No** | n/a (no validator-level tests). |
| Redeemer mutation | **No** | n/a. |
| Wrong-signer | **No** | n/a. |
| Duplicate inputs / outputs | **No** | n/a. |
| Wrong-asset / extra-mint | **Partial** | `for_output_by_token__strict_rejects_extra_tokens` covers `has_nft_strict` semantics. |
| Burn tests for terminal redeemers | **No** | No `LeaveEncryptionBurn` / `LeaveBidBurn` tests. |
| Validity-interval edge cases | **No** | No tests for `lb > locked_until`, `expected_ttl <= ttl`, finite-bound rejection. |
| Reference-input mutation | **No** | n/a. |
| Continuing-output stake-cred mutation | **No** | n/a — and §5f / I-02 explicitly note the fixture suite cannot construct adversarial stake_credential variants. |
| Continuing-output reference-script attached | **No** | n/a (same fixture limitation). |
| Benchmarks for hot paths | **No** | Zero. |
| Worst-case datum-size benchmark | **No** | Zero. |

### Per-Redeemer-Constructor Coverage

| Validator | Redeemer Constructor | Happy? | Negative? | Property? | Bench? |
|---|---|---|---|---|---|
| genesis.mint | `_redeemer: Data` | No | No | No | No |
| reference.else | n/a (always-fail) | (implicit) | n/a | n/a | n/a |
| encryption.mint | `EntryEncryptionMint` | No | No | No | No |
| encryption.mint | `LeaveEncryptionBurn` | No | No | No | No |
| encryption.spend | `RemoveEncryption` | No | No | No | No |
| encryption.spend | `UseEncryption` | No | No | No | No |
| encryption.spend | `UseSnark` | No | No | No | No |
| encryption.spend | `CancelEncryption` | No | No | No | No |
| encryption.spend | `UpdateEncryptionPrice` | No | No | No | No |
| bidding.mint | `EntryBidMint` | No | No | No | No |
| bidding.mint | `LeaveBidBurn` | No | No | No | No |
| bidding.spend | `RemoveBid` | No | No | No | No |
| bidding.spend | `UseBid` | No | No | No | No |
| bidding.spend | `UpdateBidPrice` | No | No | No | No |
| groth.withdraw | `GrothWitnessRedeemer` | No | No | No | No |
| groth.publish | `Register` | No | No | No | No |

Aggregate Informational finding I-03 covers the `Bench?` column (all No) — see its `Tests-To-Add` checkboxes.

### Test-Fixture Variance (Phase 7c)

| Fixture Field | Default | Variants Tested | Verdict |
|---|---|---|---|
| `Address.stake_credential` | `None` (via `address.from_script`) | None | **No variants — coverage gap (I-02). Cross-link to H-01.** |
| `Output.reference_script` | `None` | None | **No variants — coverage gap (I-02).** |
| `tx.mint` | n/a (no Transaction fixtures) | n/a | n/a |
| `tx.certificates` | n/a | n/a | n/a |
| `tx.validity_range` | n/a | n/a | n/a |
| `Output.value` shape | lovelace-only or `lovelace + single nft` | None | No multi-asset variants; `has_nft_strict` semantics partially covered. |

### Test Smells Found

- ✅ All 30 `fail__*` tests use the `fail` keyword (no silent false-pass).
- 🚫 **Only library-level tests** — no validator-level integration tests (carried from prior audits).
- 🚫 **No fuzz / property tests.**
- 🚫 **No benchmarks.**
- ✅ No `re-import production code` smell — tests treat library helpers as units, which is appropriate at the unit level (the missing layer is integration).

---

## 18. Off-Chain Builder Review

The target contains no TS/JS/Lucid/Mesh/Blaze code. The only off-chain artifact is `compile.sh` (Bash + Python `cbor2`). Per-row review (where applicable):

| Item | Status |
|---|---|
| PlutusData ↔ JSON / CBOR encoding | n/a (no TS builder) |
| Hex vs raw bytes for `PolicyId` / `AssetName` | `compile.sh` uses `bytes.fromhex(...)` → `cbor2.dumps(bytes)` for the genesis_pid / genesis_tkn parameters. ✓ |
| Asset-name encoding bugs (CIP-67 label prefix) | n/a — protocol does not use CIP-67. |
| Slot ↔ POSIXTime conversion | n/a — `compile.sh` does not produce transactions, only blueprint parameter bindings. |
| Network magic / network ID | `${NETWORK}` flag toggles `aiken build --trace-level silent` for mainnet vs `verbose` for everything else. ✓ |
| Fee + min-ADA estimation | n/a |
| Reference-script attachment cost | n/a |
| Collateral selection | n/a |
| Hardcoded input / output indexes | n/a |
| Change-output assumptions | n/a |
| Transaction-ordering assumptions | n/a |
| Assumptions not enforced on-chain | **Yes — M-01 (reference-script trust anchor) and H-01 (stake_credential pinning).** Both are off-chain-builder responsibilities the validator cannot enforce after the fact. |
| Error handling on builder failures | `set -e` + `aiken build` failure stops the pipeline. ✓ |
| Validator hash baked into builder matches `plutus.json` | Builder rebuilds `plutus.json` and re-computes hashes via `cardano-cli`. ✓ |
| Off-chain token-name builder ↔ on-chain | **I-08 — CBOR encoding of `tx_idx ≥ 24` would diverge from `bytearray.push`.** |

**§3.8 / Builder-Bypass Question (re-stated for §18):** Partially. See §3.8 above; H-01 is the principal exposure to a hand-crafted or hostile builder.

---

## 19. Dead Ends / Non-Issues / False Positives

Active checks per `dead_ends.md`:

| Item Checked | Result | Reason | Evidence (grep / file:line) |
|---|---|---|---|
| `assets.flatten` on bounded values | Not an issue | Used only on `mint` in burn checks (`[(p,t,-1)] == flatten(mint)`); mint is single-policy single-token by construction, so cardinality is 1. | [`encryption.ak:86`](../../contracts/peace-protocol/validators/encryption.ak#L86), [`bidding.ak:88`](../../contracts/peace-protocol/validators/bidding.ak#L88) |
| `list.head` on `tx.inputs` (always non-empty for Spend) | n/a | No `list.head` in target. | grep: 0 matches in validators (only one `builtin.head_list` in `util.generate_token_name`, which is the documented "fails on empty" case). |
| Permissive branch gated by cross-validator constraint | n/a | No `IncreaseBalance`-style branch. The hyperstructure escapes (HIGH-1/HIGH-2) are gated by datum-shape failure / NFT absence, not by cross-validator. | n/a |
| Missing signer where ownership is by NFT | n/a | All paths combine NFT presence with `owner_vkh` signature (except the permissionless TTL-cancel; intentional). | (multiple) |
| Catch-all `_ -> fail` (deny-by-default) | Not a bug | Every validator carries `else(_) { fail }`; `_ -> False` deny in every `when` arm. | `genesis.ak:48`, `reference.ak:13`, `groth.ak:50`, `encryption.ak:385`, `bidding.ak:241` |
| `find_script_outputs` returning multiple | n/a | The protocol uses NFT-anchored `for_output_by_token` (first-match by strict NFT) and `expect [_] = list.filter(...)` for input-side singleton. NFT uniqueness anchors the first-match. | [`bidding.ak:155`](../../contracts/peace-protocol/validators/bidding.ak#L155), [`bidding.ak:173`](../../contracts/peace-protocol/validators/bidding.ak#L173) |
| Missing validity range where deadline lives in partner | n/a | Each time-sensitive path checks its own bound. | `encryption.ak:270-287, 317-322`; `bidding.ak:63-66, 127-130` |
| Absent ADA min-check | Not an issue | Ledger enforces min-ADA. (LOW-1 carried.) | n/a |
| Absent `lovelace_of(self.mint) == 0` | Not an issue | Ledger forbids ADA in mint. | n/a |
| Absent `quantity_of(o.value, p, n) >= 0` check | Not an issue | Ledger forbids negative output quantities. | n/a |
| Absent duplicate-key checks on `tx.datums` / `tx.redeemers` | Not an issue | Ledger enforces unique keys. | n/a |
| Genesis output stake-credential pinning | Not an issue | `output_address == reference_datum_address` is full-Address equality on `address.from_script(reference)` (which produces stake_cred = None). The full-equality form is the safe pattern. | [`genesis.ak:35-41`](../../contracts/peace-protocol/validators/genesis.ak#L35-L41) |
| `_ -> False` deny-by-default in `when` arms | Not a bug | Used for time-bound rejections and certificate-type rejections. Intentional deny. | `bidding.ak:65, 129`, `groth.ak:45`, `encryption.ak:319` |
| Tautological comparison (`x == x`) | None found | `grep -nE '\b(\w+)\s*==\s*\1\b'` empty. | n/a |
| Hardcoded address / magic numbers | Documented constants only | `pending_ttl=6h`, `snark_validity_window=1h`, `minimum_bid_lock=6h`; BLS Wang h0–h3 from `base_seed = mainnet block-0 hash` + domain tags. | `lib/types/encryption.ak:13,16`, `lib/types/bidding.ak:11`, `lib/types/level.ak:43-56` |
| `_ -> True` accidental bypass | Intentional, not accidental | All True fallthroughs are `else { True }` inside `if/else`, not `_ -> True` in `when` arms. Hyperstructure-classified. | encryption.ak:141, 377, 380; bidding.ak:142, 233, 236 |

### 19.1 Grep Inventory (REQUIRED)

| # | Phase | Pattern | Hit Count (whole tree / validators+lib) | Sample File:Line | Notes |
|---|---|---|---|---|---|
| 1 | 3 | `InlineDatum\|expect Some\|from_data\|datum_hash\|NoDatum\|Option<.*Datum` | 59 / 17 | `encryption.ak:38`, `bidding.ak:41` | Datum shape asserted via `expect EncryptionDatum`/`BidDatum`. |
| 2 | 3 | `extra_signatories\|payment_credential\|stake_credential\|signed_by` | 37 / 33 | `encryption.ak:62-66` | `stake_credential` literally never appears in the validator tree → §5f. |
| 3 | 3 | `withdraw\(\|withdraw_zero\|validate_withdraw` | 1 | `groth.ak:15` | Single withdraw handler. |
| 4 | 3 | `publish\(\|propose\(\|vote\(\|certificate` | 4 | `groth.ak:36-46` | Publish handler restricts to own script_hash. |
| 5 | 3 | `verify_ed25519_signature\|cheque\|nonce` | 3 / 0 | (only `nonce: ByteArray` inside Capsule type) | No Ed25519 cheque pattern. §5e empty. |
| 6 | 3 | `validity_range\|lower_bound\|upper_bound\|Finite` | 14 | `encryption.ak:270-272`, `bidding.ak:63-64, 127-128` | Tight bounds where time-sensitive. |
| 7 | 3 | `reference_inputs\|find_input\|find_script_outputs` | 15 | `encryption.ak:103,167,257; bidding.ak:28,150` | Reference datum read consistently via `search.for_reference_datum`. |
| 8 | 3 | `list\.find\|list\.filter` | 0 / 2 | `bidding.ak:162, 175` | Two `list.filter` in `UseBid`. |
| 9 | 3 | `_ -> True\|_ -> False\|True\s*\}\|fail\s*\}\|_ -> fail` | 4 | `bidding.ak:65, 129; groth.ak:45; encryption.ak:319` | All `_ -> False` (deny-by-default) in `when` arms. |
| 10 | 3 | `fn mint\|mint\(\|Mint\|PolicyId\|tokens\(` | 39 | (multiple) | Mint handlers in genesis/encryption/bidding. |
| 11 | 3 | `OutputReference\|seed\|one_shot` | 21 | `genesis.ak:14-23; util.ak` | Genesis is one-shot. |
| 12 | 3 | `assets\.flatten\|without_lovelace\|lovelace_of\|quantity_of` | 18 | `encryption.ak:86, 354-355; bidding.ak:88, 210-211; search.ak:105` | `assets.flatten` only on mint (size 1). |
| 13 | 3 | `>=.*value\|value.*>=\|match\s*\(` | 2 | comments only | No `match (>=)` value comparisons. |
| 14 | 3 | stdlib red flags | 2 | `encryption.ak:86; bidding.ak:88` | `assets.flatten` bounded use only. |
| 15 | 3 | arithmetic (`/\|divide\|mod\|negate`) | (mostly imports/paths) | n/a | No on-chain arithmetic division. |
| 16 | 3 | `Pair\(\|Pairs<\|dict\.get\|dict\.to_pairs` | 25 | `search.ak:14` | One bespoke `get_first` helper. |
| 17 | 3 | `^test\s+\|^bench\s+` | 86 / 0 | `lib/tests/*` | 86 tests, **0 benchmarks**. |
| 18 | 3 | stdlib import style (`use cardano/transaction\|use aiken/transaction`) | 21 | (multiple) | Modern V3 stdlib only. |
| 19 | 5b | mint handlers | (validators) | `genesis.ak:15; encryption.ak:28; bidding.ak:24` | See §12. |
| 20 | 5c | singleton patterns (`expect \[`) | 2 | `bidding.ak:155, 173` | Strict singleton input filters. |
| 21 | 5d | cross-validator coupling | n/a | n/a | See §14. |
| 22 | 5e | `verify_ed25519_signature` | 0 | n/a | Phase 5e empty. |
| 23 | 5f | address-perimeter callsites | 17 lines (validators) | (multiple — see §5f / §8 H-01) | All payment-credential-only matches. |
| 24 | 5g | crypto verifier sites | 9 (validators) | `groth.ak:28; encryption.ak:68,72,75,203,210,226,228; bidding.ak:78` | See §5g / §8 I-04. |
| 25 | 6 | hyperstructure candidates (`_ -> True\|True\s*\}`) | 6 (validators) | `encryption.ak:141,377,380; bidding.ak:142,233,236` | All inside `if/else` (intentional). |
| 26 | 7b | redeemer types | 6 | `types/groth.ak:15,22; types/encryption.ak:40,45; types/bidding.ak:22,27` | See §17 per-redeemer table. |
| 27 | 7b | `^test\s+fail__` | 30 | (multiple) | All use `fail` keyword. |
| 28 | 7b | `^bench\s+` | 0 | n/a | I-03 / O-01. |
| 29 | 7c | `stake_credential\s*:\s*[A-Z]` | 0 | n/a | Fixtures default to `None`. |
| 29b | 7c | `reference_script\s*:` | 2 | `tests/util.ak:26, tests/search.ak:39` | Both `None`. |
| 30 | 9 | hot-path stdlib red flags | 0 | n/a | None outside the bounded `assets.flatten` cases. |

---

## 20. Final Recommendations

### 20.0 Coordinated Fixes

| Root Cause Slug | Findings | Proposed Single Fix | Effort | Risk |
|---|---|---|---|---|
| `address-perimeter-incomplete` | H-01 | Introduce one helper `is_protocol_output(o, h) = and { o.address.payment_credential == Script(h), o.address.stake_credential == None, o.reference_script == None }` (and a sibling for inputs). Replace all 9 continuing-output `Script(this_script) == payment_credential, ..., reference_script == None` clusters with `is_protocol_output(o, this_script)` and the input-filter pairs in `UseBid` with `is_protocol_input(i, h)`. | one helper + ~11 call-site replacements | Low (refactor; pair with the negative tests from H-01). |
| `hyperstructure-junk-cleanup` | H-02, H-03 | Add code comments documenting the hyperstructure escape semantics at each of the 5 sites. Carry over the developer-accepted Intentional status. Optionally add a debug-only `expect not_a_protocol_utxo` precondition. | 5 comments + optional precondition | Trivial. |
| `lovelace-not-preserved` | H-04, L-03 | If the penalty-mechanism semantics are kept (carried developer position), add a `// HIGH-3 carried: lovelace not preserved by design` comment at each callsite. Otherwise add `assets.lovelace_of(input.value) <= assets.lovelace_of(output.value)` to the four affected paths. | 4 comments OR 4 conditional checks | Low. |
| `bench-coverage-missing` | I-03, O-01 | Add a `bench/` directory and one bench block per redeemer per the I-03 checklist. | ~20 bench blocks | Low (additive). |
| `fixture-stuck-at-default` | I-02 | Extend `lib/tests/util.ak` and `lib/tests/search.ak` with `mk_addr_with_stake(stake)` / `mk_output_with_ref_script(refs)` helpers; introduce validator-level integration tests that fix the H-01 and reference-script perimeter. | helper additions + integration test scaffolding | Low. |

`fs-context-public-len-unbound` (M-03), `lifecycle-off-chain-only` (M-01), `obs1-residual-window` (I-07), `lock-upper-bound-missing` (I-06), `off-chain-only-pricing` (I-05), `build-artifact-stale` (I-01), `off-chain-token-name-cbor-mismatch` (I-08), `pending-ttl-2x-cap` (M-02), `min-ada-not-enforced` (L-01), `stdlib-redflag-list-filter` (L-02), `fs-context-deferred-binding` (I-04) each have a single finding — no coordinated fix beyond the per-finding How-To-Fix.

### Must Fix Before Mainnet

- **H-01** (stake-credential hijack) — pin `stake_credential == None` (or full-Address equality) on every continuing protocol output, plus the two `UseBid` input filters.
- **M-01** (reference-validator trust anchor) — either (a) parameterise the genesis policy with the reference-script hash so it can be on-chain-verified, or (b) document the operator runbook + add a deploy-time post-condition that the reference UTxO is at the actual `reference.ak` script hash.

### Should Fix Before Mainnet

- **M-03** (Groth16 public-input length) — add the explicit length check; defense-in-depth that prevents future silent under-constraint.
- **I-02 + I-03** (test-fixture variance + bench coverage) — add validator-level integration tests with adversarial Address / reference_script fixtures, and the per-redeemer bench scaffolding. Both are needed to reach a "Production-ready" rubric.
- **I-08** (compile.sh CBOR token-name) — pin `tx_idx < 24` in the deploy runbook OR rewrite the Python builder to mirror `bytearray.push`.

### Nice To Have

- **I-04** (Groth withdraw context binding) — add domain tag / statement-ID inside the SNARK circuit (off-chain, requires SRS regen). Not needed today; useful if cryptographic surface ever extends.
- **I-06** (`locked_until` upper bound) — add `locked_until ≤ ub + 30 days` for UX robustness.
- **L-02** (`list` import in bidding) — inline `has` and replace `list.filter` with bespoke recursion if size pressure emerges.

### Optimization Backlog

- **O-01** — commit baseline benchmarks per the I-03 checklist.

### Documentation Backlog

- **I-01** — re-run `aiken build` to refresh `plutus.json`.
- **H-02 / H-03** — add code comments documenting the hyperstructure-escape semantics at each of the 5 sites.
- **H-04 / L-03** — code comments referencing the carried penalty-mechanism rationale.
- **I-05** — clarify `new_price` semantics in the README and any external integrator docs (advisory price, not bid amount).
- **M-01** — write the reference-script-hash deploy-time runbook.

---

## 21. Appendix: Files Inspected

| File | Lines | Purpose | What Was Checked |
|---|---|---|---|
| [`aiken.toml`](../../contracts/peace-protocol/aiken.toml) | 22 | Package metadata, deps | Version, compiler, plutus version, deps lock |
| [`aiken.lock`](../../contracts/peace-protocol/aiken.lock) | (~10) | Dep lockfile | Stdlib pin |
| [`plutus.json`](../../contracts/peace-protocol/plutus.json) | (large) | Compiled blueprint | Preamble version, plutus version, compiler hash, parameter shapes |
| [`compile.sh`](../../contracts/peace-protocol/compile.sh) | 71 | Build pipeline | Deploy-time parameter wiring, network flag, token-name builder (I-08) |
| [`README.md`](../../contracts/peace-protocol/README.md) | 19 | High-level intent | Stated semantics, license |
| [`groth-optimization.md`](../../contracts/peace-protocol/groth-optimization.md) | (n/a) | Project optimization notes | Background |
| [`validators/genesis.ak`](../../contracts/peace-protocol/validators/genesis.ak) | 50 | Genesis mint policy (one-shot) | Read in full; M-01, full address equality on output |
| [`validators/reference.ak`](../../contracts/peace-protocol/validators/reference.ak) | 15 | Always-fail reference UTxO | Read in full; correctly always-fail |
| [`validators/encryption.ak`](../../contracts/peace-protocol/validators/encryption.ak) | 387 | Encryption mint + spend | Read in full; H-01 + carried HIGH-1/2/3 + L-03 |
| [`validators/bidding.ak`](../../contracts/peace-protocol/validators/bidding.ak) | 243 | Bidding mint + spend | Read in full; H-01 + carried L-02/L-03 |
| [`validators/groth.ak`](../../contracts/peace-protocol/validators/groth.ak) | 52 | Groth withdraw + publish | Read in full; I-04 binding analysis |
| [`lib/digest.ak`](../../contracts/peace-protocol/lib/digest.ak) | 14 | Hash function (Blake2b-224) | Read in full |
| [`lib/limb_compression.ak`](../../contracts/peace-protocol/lib/limb_compression.ak) | 92 | G1 compression from u64 limbs | Read in full; sound |
| [`lib/search.ak`](../../contracts/peace-protocol/lib/search.ak) | 135 | Reference / output / redeemer lookup helpers | Read in full; sound |
| [`lib/util.ak`](../../contracts/peace-protocol/lib/util.ak) | 31 | Token-name construction (`bytearray.push`) | Read in full; correct |
| [`lib/types/bidding.ak`](../../contracts/peace-protocol/lib/types/bidding.ak) | 31 | BidDatum + redeemer types | Read in full |
| [`lib/types/encryption.ak`](../../contracts/peace-protocol/lib/types/encryption.ak) | 53 | EncryptionDatum + redeemers, ttl/window constants | Read in full |
| [`lib/types/groth.ak`](../../contracts/peace-protocol/lib/types/groth.ak) | 260 | SNARK VK / proof types, verifier, commitment PoK | Read in full; M-03 carried |
| [`lib/types/level.ak`](../../contracts/peace-protocol/lib/types/level.ak) | 215 | Wang-Cao level pairings + R5 | Read in full; sound |
| [`lib/types/reference.ak`](../../contracts/peace-protocol/lib/types/reference.ak) | 14 | ReferenceDatum type | Read in full |
| [`lib/types/register.ak`](../../contracts/peace-protocol/lib/types/register.ak) | 33 | Register validity predicate | Read in full; sound |
| [`lib/types/schnorr.ak`](../../contracts/peace-protocol/lib/types/schnorr.ak) | 145 | Schnorr + binding sigma proofs | Read in full; sound |
| [`lib/tests/digest.ak`](../../contracts/peace-protocol/lib/tests/digest.ak) | 23 | Hash tests | Read |
| [`lib/tests/limb_compression.ak`](../../contracts/peace-protocol/lib/tests/limb_compression.ak) | 145 | Compression tests | Read |
| [`lib/tests/groth.ak`](../../contracts/peace-protocol/lib/tests/groth.ak) | 498 | Groth16 tests | Read |
| [`lib/tests/level.ak`](../../contracts/peace-protocol/lib/tests/level.ak) | 177 | Level pairing tests | Read |
| [`lib/tests/register.ak`](../../contracts/peace-protocol/lib/tests/register.ak) | 107 | Register predicate tests | Read |
| [`lib/tests/schnorr.ak`](../../contracts/peace-protocol/lib/tests/schnorr.ak) | 266 | Sigma protocol tests | Read |
| [`lib/tests/search.ak`](../../contracts/peace-protocol/lib/tests/search.ak) | 321 | Search-helper tests | Read; I-02 fixture-variance evidence |
| [`lib/tests/util.ak`](../../contracts/peace-protocol/lib/tests/util.ak) | 130 | Token-name tests | Read; I-02 fixture-variance evidence |
| [`audits/2026-02-09-claude.md`](../../contracts/peace-protocol/audits/2026-02-09-claude.md) | 650 | Prior baseline audit | Read in full; carried findings |
| [`audits/2026-04-20-claude-opus-4-7.md`](../../contracts/peace-protocol/audits/2026-04-20-claude-opus-4-7.md) | 395 | Prior incremental audit | Read in full; carried findings |
| [`audits/README.md`](../../contracts/peace-protocol/audits/README.md) | 24 | Audit-folder index | Read |
| [`hashes/*.hash`](../../contracts/peace-protocol/hashes/) | 5 files | Per-validator script hashes | Inspected for completeness |

### Validator Coverage

| Validator | Lines Read | Redeemers Found | Redeemers Audited | Tests Found |
|---|---|---|---|---|
| Genesis | 50 | 1 (untyped Data) | 1 | 0 |
| Reference | 15 | 0 (else-only) | 0 | 0 |
| Encryption | 387 | 7 (2 mint + 5 spend) | 7 | 0 (no validator-level tests) |
| Bidding | 243 | 5 (2 mint + 3 spend) | 5 | 0 (no validator-level tests) |
| Groth | 52 | 2 (1 withdraw + 1 publish) | 2 | 0 (no validator-level tests) |

---

*End of audit report.*
