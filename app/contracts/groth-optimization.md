# Groth16 Verifier Optimization Plan

## Contract Folder Layout

```
app/contracts/
├── aiken.toml                      # Aiken v1.1.21, Plutus v3, stdlib v3.0.0
├── plutus.json                     # Compiled output (~317 KB)
├── groth-optimization.md           # This file
│
├── contracts/                       # Individual .plutus files (extracted from plutus.json)
│   ├── groth_contract.plutus
│   ├── encryption_contract.plutus
│   ├── bidding_contract.plutus
│   ├── genesis_contract.plutus
│   └── reference_contract.plutus
│
├── validators/
│   ├── groth.ak                    # Groth16 witness validator (withdraw + publish + else)
│   ├── encryption.ak               # Encryption validator (uses verify_commitments)
│   ├── bidding.ak                  # Bidding validator (no groth dependency)
│   ├── genesis.ak                  # Genesis validator (no groth dependency)
│   └── reference.ak                # Reference validator (no groth dependency)
│
├── lib/
│   ├── types/
│   │   ├── groth.ak                # Groth16 types, VK constant, verification logic
│   │   ├── encryption.ak           # Encryption types
│   │   ├── bidding.ak              # Bidding types
│   │   ├── level.ak                # Level types (uses scalar)
│   │   ├── reference.ak            # Reference types
│   │   ├── register.ak             # Register types
│   │   └── schnorr.ak              # Schnorr types (uses scalar)
│   │
│   ├── tests/
│   │   ├── groth.ak                # Groth16 verification tests (proofs + commitment tests)
│   │   ├── digest.ak
│   │   ├── level.ak
│   │   ├── limb_compression.ak
│   │   ├── register.ak
│   │   ├── schnorr.ak
│   │   ├── search.ak
│   │   └── util.ak
│   │
│   ├── digest.ak
│   ├── limb_compression.ak
│   ├── search.ak
│   └── util.ak
│
└── build/
    └── packages/
        └── aiken-lang-stdlib/      # stdlib v3.0.0
```

## Current State

### Compiled Script Sizes

Sizes from `plutus.json`. The `compiledCode` field is hex-encoded CBOR, so byte size
is half the hex character count.

| Validator                        | Hex Chars | Bytes (actual) |
| -------------------------------- | --------- | -------------- |
| **groth.groth_witness.withdraw** | 48,036    | **24,018**     |
| groth.groth_witness.publish      | 48,036    | 24,018         |
| groth.groth_witness.else         | 48,036    | 24,018         |
| encryption.contract.spend        | 29,504    | 14,752         |
| encryption.contract.mint         | 29,504    | 14,752         |
| encryption.contract.else         | 29,504    | 14,752         |
| bidding.contract.mint            | 13,200    | 6,600          |
| bidding.contract.spend           | 13,200    | 6,600          |
| bidding.contract.else            | 13,200    | 6,600          |
| genesis.contract.mint            | 3,500     | 1,750          |
| genesis.contract.else            | 3,500     | 1,750          |
| reference.contract.spend         | 418       | 209            |
| reference.contract.else          | 418       | 209            |

**Why all endpoints of a validator share the same size:** Aiken compiles all endpoints
(withdraw, publish, else) of a multi-handler validator into a single UPLC script with a
purpose selector. The simple `publish` handler (just a certificate check) carries the
full weight of the Groth16 verifier code because it shares the same compiled script.

### Cross-Validator Dependencies

The groth module is used by **two** validators:

- **`validators/groth.ak`** imports: `GrothWitnessRedeemer`, `Register`, `RegisterRedeemer`
  - Calls `groth.verify_groth16(global_snark_vk, ...)` in the `withdraw` handler
  - Converts commitment wire: `groth_commitment_wire |> scalar.from_bytes |> scalar.to_int`
  - The `withdraw` handler currently ignores its third parameter (`_self: Transaction`)
  - The `publish` handler only does a certificate credential check (no groth logic)
- **`validators/encryption.ak`** imports: `GrothWitnessRedeemer`, `global_snark_vk`, `verify_commitments`
  - Calls `verify_commitments(global_snark_vk, groth_proof)` in the `UseSnark` spend handler (line 289)
  - Already has `reference_inputs` destructured from `self: Transaction` (line 104)
  - The `global_snark_vk` constant is embedded in this validator too, contributing
    to its 14.7 KB size

### Function Dependency Graph (lib/types/groth.ak)

```
verify_groth16 (pub fn, line 220)
├── derive_vk_x          (pub fn, line 136 — recursive, processes IC × public scalars)
├── split_at              (fn, line 349 — recursive, splits IC list into public/wire segments)
├── add_commitments       (pub fn, line 188 — recursive, sums commitment G1 points into vk_x)
└── ml_one                (pub fn, line 201 — creates GT identity via e(0*g1, g2))

verify_commitments (pub fn, line 305)
└── sum_commitments_acc   (pub fn, line 172 — recursive, sums commitment G1 points)

sum_commitments (pub fn, line 162) ← DEAD CODE, never called by any validator or test
└── sum_commitments_acc   (shared helper)
```

**Visibility note:** `derive_vk_x`, `add_commitments`, `sum_commitments`, and
`sum_commitments_acc` are all declared `pub fn` but have no external callers. Only
`verify_groth16` and `verify_commitments` are called from validators. The `pub`
visibility should not prevent removal — grep confirms zero external usage.

### BLS12-381 Builtin Calls in verify_groth16

| Builtin                            | Count | Notes                               |
| ---------------------------------- | ----- | ----------------------------------- |
| `bls12_381_g1_uncompress`          | 3 + N | piA, piC, alpha + IC[0..N] in loops |
| `bls12_381_g2_uncompress`          | 4     | piB, beta, gamma, delta             |
| `bls12_381_g2_neg`                 | 3     | gamma, delta, beta                  |
| `bls12_381_g1_scalar_mul`          | N + 1 | IC scalars + 0*alpha in ml_one      |
| `bls12_381_g1_add`                 | N     | accumulator in derive_vk_x          |
| `bls12_381_miller_loop`            | 5     | 4 pairings + 1 in ml_one            |
| `bls12_381_mul_miller_loop_result` | 3     | combining 4 pairings                |
| `bls12_381_final_verify`           | 1     |                                     |

Where N = nPublic - 1 + n_commitments + n_commitment_points = 36 + 1 + 1 = 38

### Embedded Constant Data in global_snark_vk

| Field          | Count | Bytes Each | Total Bytes |
| -------------- | ----- | ---------- | ----------- |
| vkAlpha (G1)   | 1     | 48         | 48          |
| vkBeta (G2)    | 1     | 96         | 96          |
| vkGamma (G2)   | 1     | 96         | 96          |
| vkDelta (G2)   | 1     | 96         | 96          |
| vkIC (G1 list) | 38    | 48         | 1,824       |
| commitmentKeys | 1     | 2 × 96     | 192         |
| **Total**      |       |            | **2,352**   |

This constant data is embedded directly in the compiled UPLC script for every validator
endpoint that references it, plus UPLC overhead for list construction (cons nodes).

---

## Phase 0: Remove Dead Code (Trivial, Free Size Reduction)

### Goal

Remove `sum_commitments` which is declared `pub fn` but never called anywhere.

### Evidence

Grep for `sum_commitments` across all `.ak` files shows:
- **Definition:** `lib/types/groth.ak:162` — `pub fn sum_commitments(...)`
- **Internal call:** `lib/types/groth.ak:168` — calls `sum_commitments_acc` (its helper)
- **No external callers.** `verify_commitments` calls `sum_commitments_acc` directly
  (line 330), bypassing `sum_commitments` entirely.

### Files to Modify

- **`lib/types/groth.ak`**: Delete `sum_commitments` (lines 162-170)

### Note

`sum_commitments_acc` (lines 172-184) must be kept — it IS called by
`verify_commitments` at line 330.

### Verification

Run `aiken check` — all tests must pass. `aiken build` to confirm size reduction.

---

## Phase 1: Restructure Pairing Equation (Low Effort, ~5-8% Reduction)

### Goal

Eliminate the `ml_one` function and save 1 Miller loop, 1 `mul_miller_loop_result`,
1 `g2_neg`, and 1 `g1_scalar_mul`.

### Mathematical Basis

The current verification checks:

```
e(A, B) × e(vk_x, -γ) × e(C, -δ) × e(α, -β) == e(0·α, β)
```

This is 5 Miller loops (4 on the LHS + 1 for `ml_one` on the RHS).

By moving `e(α, β)` to the RHS of `bls12_381_final_verify`:

```
e(A, B) × e(vk_x, -γ) × e(C, -δ) == e(α, β)
```

This is 4 Miller loops (3 on the LHS + 1 on the RHS), which saves an entire Miller loop
and eliminates the `ml_one` helper.

### Files to Modify

- **`lib/types/groth.ak`**: Modify `verify_groth16`, remove `ml_one` function

### Implementation

In `verify_groth16` (currently lines 272-285), replace:

```aiken
// BEFORE (5 Miller loops)
let prod =
  bls12_381_mul_miller_loop_result(
    bls12_381_mul_miller_loop_result(
      bls12_381_mul_miller_loop_result(
        bls12_381_miller_loop(a, b),
        bls12_381_miller_loop(vk_x, bls12_381_g2_neg(gamma)),
      ),
      bls12_381_miller_loop(c, bls12_381_g2_neg(delta)),
    ),
    bls12_381_miller_loop(alpha, bls12_381_g2_neg(beta)),
  )
bls12_381_final_verify(prod, ml_one(alpha, beta))
```

```aiken
// AFTER (4 Miller loops)
let lhs =
  bls12_381_mul_miller_loop_result(
    bls12_381_mul_miller_loop_result(
      bls12_381_miller_loop(a, b),
      bls12_381_miller_loop(vk_x, bls12_381_g2_neg(gamma)),
    ),
    bls12_381_miller_loop(c, bls12_381_g2_neg(delta)),
  )
let rhs = bls12_381_miller_loop(alpha, beta)
bls12_381_final_verify(lhs, rhs)
```

Then delete the `ml_one` function (lines 199-203). Also remove `bls12_381_g2_neg` from
the `beta` path — `beta` is no longer negated, it's used directly on the RHS.

### Cleanup

- Remove `ml_one` function definition (lines 199-203)
- Remove `bls12_381_g2_neg` from imports if no longer used elsewhere (it is still used
  for gamma and delta, so keep it)
- Update the `ml_one_is_identity` test in `lib/tests/groth.ak` (line 238) — either
  delete it or repurpose it

### Net Savings

- -1 `bls12_381_miller_loop` call
- -1 `bls12_381_mul_miller_loop_result` call
- -1 `bls12_381_g2_neg` call (beta no longer negated)
- -1 `bls12_381_g1_scalar_mul` call (no more `0 * alpha`)
- -1 function definition (`ml_one`)

### Verification

Run `aiken check` — the existing `valid_groth_proof1` and `valid_groth_proof2` tests in
`lib/tests/groth.ak` must still pass. Then `aiken build` and compare the
`groth.groth_witness.withdraw` size in `plutus.json`.

---

## Phase 2: Pre-Negate G2 Points in the VK (Low Effort, ~2-3% Reduction)

### Goal

Store `-gamma` and `-delta` as pre-computed compressed bytes in the VK, eliminating 2
on-chain `bls12_381_g2_neg` calls.

### Mathematical Basis

BLS12-381 G2 point negation in compressed form is deterministic — it can be computed
off-chain once. Storing the negated points avoids paying for the negation builtin on
every verification.

### Files to Modify

- **`lib/types/groth.ak`**: Modify `SnarkVerificationKey` type, update
  `global_snark_vk` constant, update `verify_groth16` and `verify_commitments`
- **`lib/tests/groth.ak`**: Update all test VK instances

### Implementation

#### Step 1: Modify the Type

```aiken
// BEFORE
pub type SnarkVerificationKey {
  nPublic: Int,
  vkAlpha: ByteArray,
  vkBeta: ByteArray,
  vkGamma: ByteArray,
  vkDelta: ByteArray,
  vkIC: List<ByteArray>,
  commitmentKeys: List<CommitmentKey>,
}

// AFTER
pub type SnarkVerificationKey {
  nPublic: Int,
  vkAlpha: ByteArray,
  vkBeta: ByteArray,
  vkGammaNeg: ByteArray,   // pre-negated -gamma (G2 compressed)
  vkDeltaNeg: ByteArray,   // pre-negated -delta (G2 compressed)
  vkIC: List<ByteArray>,
  commitmentKeys: List<CommitmentKey>,
}
```

#### Step 2: Compute Negated Points Off-Chain

Write a helper script (Go/Python/JS) that:
1. Reads the current `vkGamma` and `vkDelta` compressed G2 bytes
2. Uncompresses, negates, re-compresses
3. Outputs the negated compressed hex

For BLS12-381 G2 compressed format, negation flips the "sign" bit. The simplest
approach is to use the gnark or blst library to uncompress → negate → compress.

Alternatively, use an Aiken test to compute them:

```aiken
test compute_negated_gamma() {
  let gamma = bls12_381_g2_uncompress(#"<current vkGamma hex>")
  let neg_gamma = bls12_381_g2_neg(gamma)
  let neg_gamma_bytes = bls12_381_g2_compress(neg_gamma)
  // Trace or assert to extract the bytes
  trace @"neg_gamma": neg_gamma_bytes
  True
}
```

#### Step 3: Update global_snark_vk

Replace `vkGamma` and `vkDelta` with their negated values. Update the field names.

#### Step 4: Update verify_groth16

```aiken
// BEFORE
let gamma = bls12_381_g2_uncompress(vk.vkGamma)
let delta = bls12_381_g2_uncompress(vk.vkDelta)
// ... later:
bls12_381_miller_loop(vk_x, bls12_381_g2_neg(gamma))
bls12_381_miller_loop(c, bls12_381_g2_neg(delta))

// AFTER
let gamma_neg = bls12_381_g2_uncompress(vk.vkGammaNeg)
let delta_neg = bls12_381_g2_uncompress(vk.vkDeltaNeg)
// ... later (no negation needed):
bls12_381_miller_loop(vk_x, gamma_neg)
bls12_381_miller_loop(c, delta_neg)
```

#### Step 5: Update verify_commitments (if applicable)

`verify_commitments` does not use gamma or delta, so no changes needed there.

#### Step 6: Update all test VK instances

All tests in `lib/tests/groth.ak` that construct `SnarkVerificationKey` must use the
new field names and negated values. There are 4 test VK instances:
- `valid_groth_proof1` (line 15)
- `valid_groth_proof2` (line 111)
- `verify_commitments_valid_proof1` (line 317)
- `verify_commitments_valid_proof2` (line 388)
- `verify_commitments_empty_commitments` (line 459)
- `verify_commitments_invalid_pok` (line 484)

### Cleanup

- Remove `bls12_381_g2_neg` from imports if it is no longer used anywhere in the file
  (check `verify_commitments` — it does NOT use `g2_neg`, so after Phase 1 + Phase 2,
  `g2_neg` can be removed from imports entirely)

### Net Savings

- -2 `bls12_381_g2_neg` calls (after Phase 1 removed the beta negation, these are the
  last two)
- -1 import (`bls12_381_g2_neg` can be dropped)

### Verification

Run `aiken check` — all groth tests must pass. Then `aiken build` and compare sizes.

---

## Phase 3: Eliminate split_at with Counted Traversal (Medium Effort, ~3-5% Reduction)

### Goal

Replace the `split_at` function + two separate `derive_vk_x` calls with a single
pass that processes public inputs then commitment wires without allocating intermediate
lists.

### Current Code Flow

```aiken
let Pair(ic_public, ic_wires) = split_at(tail, n_raw_public)  // allocates 2 new lists
let vk_x_base = derive_vk_x(ic_public, public, ...)           // traverses ic_public
let vk_x_with_wires = derive_vk_x(ic_wires, commitment_wires, vk_x_base)  // traverses ic_wires
let vk_x = add_commitments(proof.commitments, vk_x_with_wires)
```

This traverses the IC tail **twice**: once in `split_at` to build two sub-lists, then
once in each `derive_vk_x` call.

### Files to Modify

- **`lib/types/groth.ak`**: Add `derive_vk_x_combined`, remove `split_at`, simplify
  `verify_groth16`

### Implementation

#### Step 1: Add Combined Function

```aiken
// Single-pass: processes first n elements with `public`, rest with `wires`
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
      } else {
        when wires is {
          [] -> fail @"wires shorter than vkIC"
          [w, ..rest_w] ->
            derive_vk_x_combined(
              rest_ic,
              public,
              rest_w,
              0,
              bls12_381_g1_add(acc, bls12_381_g1_scalar_mul(w, pt)),
            )
        }
      }
    }
  }
}
```

#### Step 2: Update verify_groth16

```aiken
// BEFORE
let vk_x =
  when vk.vkIC is {
    [] -> fail @"empty vkIC"
    [head, ..tail] -> {
      let Pair(ic_public, ic_wires) = split_at(tail, n_raw_public)
      let vk_x_base = derive_vk_x(ic_public, public, bls12_381_g1_uncompress(head))
      let vk_x_with_wires = derive_vk_x(ic_wires, commitment_wires, vk_x_base)
      add_commitments(proof.commitments, vk_x_with_wires)
    }
  }

// AFTER
let vk_x =
  when vk.vkIC is {
    [] -> fail @"empty vkIC"
    [head, ..tail] -> {
      let base = derive_vk_x_combined(
        tail, public, commitment_wires, n_raw_public,
        bls12_381_g1_uncompress(head),
      )
      add_commitments(proof.commitments, base)
    }
  }
```

#### Step 3: Remove Dead Code

- Delete `split_at` (lines 348-361)
- Delete `derive_vk_x` (lines 136-157) — replaced by `derive_vk_x_combined`

Note: `add_commitments` (lines 188-197) is still needed for adding raw commitment
points D to vk_x. Keep it.

### Considerations

- `derive_vk_x` is `pub fn` but has zero external callers (grep confirmed — only
  called within `verify_groth16` and by its own recursion), so it's safe to remove
- `split_at` is private (`fn` not `pub fn`), only used in `verify_groth16`
- The `when vk.vkIC is { [] -> fail ... [head, ..tail] -> ... }` pattern can be
  simplified to `expect [head, ..tail] = vk.vkIC` for slightly smaller UPLC output

### Net Savings

- -2 function definitions (`split_at`, `derive_vk_x`)
- -1 intermediate list allocation (the two sub-lists from `split_at`)
- Fewer UPLC lambda/fix nodes

### Verification

Run `aiken check` — `valid_groth_proof1` and `valid_groth_proof2` must pass. Then
`aiken build` and compare sizes.

---

## Phase 4: Remove Redundant Length Checks (Low Effort, ~1-2% Reduction)

### Goal

Remove the 3 `list.length` calls that guard invariants already enforced by the
recursive traversal functions.

### Current Checks (verify_groth16, lines 234-238)

```aiken
let n_commitments = list.length(commitment_wires)   // O(n)
let n_raw_public = vk.nPublic - 1
expect vk.nPublic > 0                                // always 37
expect list.length(public) == n_raw_public            // O(36)
expect list.length(vk.vkIC) == vk.nPublic + n_commitments  // O(38)
```

### Why They're Redundant

1. `vk.nPublic > 0` — The VK is a hardcoded constant with `nPublic: 37`. Always true.
2. `list.length(public) == n_raw_public` — If `public` has the wrong length, the
   `derive_vk_x` / `derive_vk_x_combined` function will fail at runtime with
   `"public shorter than vkIC"` or will leave unconsumed IC elements (which means the
   pairing check will fail with a wrong vk_x).
3. `list.length(vk.vkIC) == vk.nPublic + n_commitments` — Same reasoning. If IC has the
   wrong length, the traversal fails or produces a wrong vk_x.

### Files to Modify

- **`lib/types/groth.ak`**: Remove the length checks in `verify_groth16`

### Implementation

```aiken
// BEFORE
let n_commitments = list.length(commitment_wires)
let n_raw_public = vk.nPublic - 1
expect vk.nPublic > 0
expect list.length(public) == n_raw_public
expect list.length(vk.vkIC) == vk.nPublic + n_commitments

// AFTER
let n_raw_public = vk.nPublic - 1
```

After Phase 3, `n_raw_public` is still needed as the counter for
`derive_vk_x_combined`. But `n_commitments` is no longer needed at all.

### Cleanup

- If `list.length` is no longer used anywhere in the file, remove the
  `use aiken/collection/list` import. Check `verify_commitments` first — it uses
  `list.length(proof.commitments)` (line 307) and `list.length(vk.commitmentKeys)`
  (line 311). So the import must stay unless those checks are also removed.
- Consider whether the `verify_commitments` length checks are also redundant. The check
  `list.length(proof.commitments) == 0` is a branch condition (not just a guard) — it
  can be replaced with a pattern match on the list head. The check
  `list.length(vk.commitmentKeys) == 1` can also be replaced with a direct pattern match:

```aiken
// BEFORE (verify_commitments, lines 307-317)
if list.length(proof.commitments) == 0 {
  True
} else {
  expect list.length(vk.commitmentKeys) == 1
  let ck = when vk.commitmentKeys is {
    [] -> fail @"missing commitmentKeys"
    [x, ..] -> x
  }

// AFTER (pattern match replaces both length checks)
when proof.commitments is {
  [] -> True
  _ -> {
    expect [ck] = vk.commitmentKeys
```

This eliminates both `list.length` calls in `verify_commitments`, which may allow
removing the `use aiken/collection/list` import from `lib/types/groth.ak` entirely.

### Net Savings

- -3 `list.length` traversals (O(38) + O(36) + O(1))
- -1 variable binding (`n_commitments`)
- Potential removal of some `list` module usage

### Verification

Run `aiken check` — all tests must pass. Then `aiken build` and compare sizes.

---

## Phase 5: Move VK to Reference Input (High Effort, ~40-50% Reduction)

### Goal

Remove the ~2.3 KB `global_snark_vk` constant from the compiled script by storing
the VK in an on-chain UTxO datum and reading it via a reference input.


### Architectural Change

Currently the VK is a hardcoded constant in `lib/types/groth.ak`. This means every
validator endpoint that references it embeds the full VK data (~2,352 bytes of raw
curve points + UPLC list construction overhead) in its compiled script.

Instead:
1. Store the VK as an inline datum on a UTxO (a "VK reference UTxO")
2. Hardcode only a **hash** of the VK (32 bytes) in the script
3. At validation time, read the VK from a reference input and verify the hash


### Files to Modify

- **`lib/types/groth.ak`**: Remove `global_snark_vk`, add VK hash constant, add
  VK lookup/validation helper
- **`validators/groth.ak`**: Read VK from reference input, pass to `verify_groth16`
- **`validators/encryption.ak`**: Read VK from reference input, pass to
  `verify_commitments`
- **Off-chain code**: Create the VK reference UTxO transaction

### Implementation

#### Step 1: Define VK Hash Constant

```aiken
// Replace the full VK constant with just its hash (32 bytes vs ~2,352 bytes)
pub const global_snark_vk_hash: ByteArray = #"<blake2b_256 of serialised VK>"
```

To compute the hash, use an Aiken test:

```aiken
test compute_vk_hash() {
  let vk_data: Data = global_snark_vk
  let hash = blake2b_256(builtin.serialise_data(vk_data))
  trace @"vk_hash": hash
  True
}
```

#### Step 2: Add VK Extraction Helper

```aiken
use aiken/crypto.{blake2b_256}
use aiken/builtin.{serialise_data}

pub fn extract_vk(
  reference_inputs: List<Input>,
  vk_hash: ByteArray,
) -> SnarkVerificationKey {
  // Find the reference input containing the VK datum
  // The caller must ensure exactly one reference input has the VK
  expect Some(ref_input) =
    list.find(reference_inputs, fn(input) {
      when input.output.datum is {
        InlineDatum(raw) -> {
          let hash = blake2b_256(serialise_data(raw))
          hash == vk_hash
        }
        _ -> False
      }
    })
  expect InlineDatum(raw) = ref_input.output.datum
  expect vk: SnarkVerificationKey = raw
  vk
}
```

#### Step 3: Update validators/groth.ak

The `withdraw` handler currently ignores the transaction context (`_self`). It must
be changed to `self` to access reference inputs:

```aiken
// BEFORE: _self is unused
withdraw(redeemer: GrothWitnessRedeemer, _credential, _self) {

// AFTER: self is needed for reference_inputs
withdraw(redeemer: GrothWitnessRedeemer, _credential, self) {
  let GrothWitnessRedeemer { groth_proof, groth_commitment_wire, groth_public, .. } =
    redeemer
  let Transaction { reference_inputs, .. } = self
  let vk = groth.extract_vk(reference_inputs, groth.global_snark_vk_hash)
  groth.verify_groth16(
    vk,
    groth_proof,
    groth_public,
    [groth_commitment_wire |> scalar.from_bytes |> scalar.to_int],
  )
}
```

This requires adding `use cardano/transaction.{Transaction}` to the groth validator
imports (it already imports `Transaction` but currently only for the `publish` handler).

#### Step 4: Update validators/encryption.ak

The encryption validator already destructures `reference_inputs` from `self` at
line 104. The change is minimal — replace the direct VK reference:

```aiken
// BEFORE (line 289)
verify_commitments(global_snark_vk, groth_proof)?,

// AFTER
let vk = groth.extract_vk(reference_inputs, groth.global_snark_vk_hash)
verify_commitments(vk, groth_proof)?,
```

Update the import line 21 from:
```aiken
use types/groth.{GrothWitnessRedeemer, global_snark_vk, verify_commitments}
```
to:
```aiken
use types/groth.{GrothWitnessRedeemer, global_snark_vk_hash, verify_commitments}
```

#### Step 5: Off-Chain — Create VK Reference UTxO

The off-chain transaction builder must:
1. Create a UTxO with the VK as an inline datum at a known address
2. Include this UTxO as a reference input in every Groth16 verification transaction
3. The UTxO can be locked at any address (even a simple pubkey address), since it's
   only read as a reference input, never spent

### Considerations

- **Transaction size**: The VK datum UTxO must exist on-chain. Creating it requires a
  transaction that includes the full VK datum (~2.3 KB). This is a one-time cost.
- **Reference input availability**: Every verification transaction must include the VK
  UTxO as a reference input. This adds ~40 bytes (the UTxO reference) to each tx.
- **Migration**: Changing the VK (e.g., for a circuit upgrade) requires creating a new
  VK UTxO and updating the hardcoded hash in the script (which means redeploying).
- **Hash verification cost**: `blake2b_256(serialise_data(vk))` adds some on-chain cost,
  but it's much cheaper than the saved constant embedding.
- **Backward compatibility**: This changes the validator's compiled hash, requiring
  re-registration of the stake credential and updating all off-chain references.

### Net Savings

- ~2,352 bytes of raw constant data removed from each validator endpoint
- UPLC list construction overhead for 38-element IC list removed
- Estimated 40-50% reduction in compiled script size

### Verification

1. Compute VK hash with a test, embed it
2. `aiken build` and verify dramatically smaller script sizes
3. Integration test: build a transaction with the VK reference input and verify on
   testnet/emulator

---

## Recommended Execution Order

| Order | Phase | Effort  | Est. Reduction | Cumulative |
| ----- | ----- | ------- | -------------- | ---------- |
| 1     | Phase 0: Remove Dead Code     | Trivial | minimal | ~0%      |
| 2     | Phase 1: Restructure Pairing  | Low     | ~5-8%   | ~5-8%    |
| 3     | Phase 4: Remove Length Checks  | Low     | ~1-2%   | ~6-10%   |
| 4     | Phase 2: Pre-Negate G2 Points  | Low     | ~2-3%   | ~8-13%   |
| 5     | Phase 3: Eliminate split_at    | Medium  | ~3-5%   | ~11-18%  |
| 6     | Phase 5: VK Reference Input    | High    | ~40-50% | ~50-60%  |

Phases 0, 1, 2, and 4 are independent and can be done in any order or combined into a
single change. Phase 3 depends on understanding the final shape of `verify_groth16`
after Phases 1 and 4. Phase 5 is a standalone architectural change that can be done
at any time but requires off-chain coordination.

After each phase, run `aiken check && aiken build` and record the new script sizes
in the table above to track progress.

---

## Future Considerations

### Separate `publish` from `withdraw` (Potential Phase 6)

Because Aiken compiles all handlers of a multi-handler validator into a single UPLC
script, the trivial `publish` handler (just a certificate credential check) is bloated
to 24 KB. Splitting `groth_witness` into two separate validators — one for `withdraw`
(Groth16 verification) and one for `publish` (certificate registration) — would give
`publish` its own tiny script.

**Trade-off:** Two separate validator script hashes to manage, two separate stake
credential registrations. But the `publish` script could shrink from 24 KB to under
1 KB.

### Precomputed `e(alpha, beta)` (Not Currently Possible)

After Phase 1, the RHS of the pairing check is `e(alpha, beta)`, which is a constant
(alpha and beta are part of the VK). In principle this could be precomputed off-chain.
However, Plutus V3 does not support serialization of `MillerLoopResult` values, so
this cannot be stored as a datum or script constant. If a future Plutus version adds
`MillerLoopResult` serialization, this would save one on-chain Miller loop.

### Reducing Uncompression Calls

The dominant on-chain cost is the 38+ `bls12_381_g1_uncompress` calls in the IC
scalar multiplication loop. These cannot be avoided without fundamentally changing the
verification approach (e.g., moving the vk_x computation off-chain and passing the
result, which would require a separate commitment scheme to ensure correctness).

---

## Appendix: Useful Commands

```bash
# Run all tests
aiken check

# Build and generate plutus.json
aiken build

# Show compiled sizes (bytes) from plutus.json
python3 -c "
import json
with open('plutus.json') as f:
    data = json.load(f)
for v in data.get('validators', []):
    title = v.get('title', 'unknown')
    size = len(v.get('compiledCode', ''))
    print(f'{title}: {size} hex chars = {size // 2} bytes')
"

# Compute negated G2 points for Phase 2 (add as temp test, run, then remove)
# Add to lib/tests/groth.ak:
#   test compute_neg_gamma() {
#     let g = bls12_381_g2_uncompress(#"<vkGamma hex>")
#     trace bls12_381_g2_compress(bls12_381_g2_neg(g))
#     True
#   }
# Then: aiken check -m compute_neg_gamma
```
